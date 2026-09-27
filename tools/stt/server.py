"""Optional local GPU speech-to-text sidecar for Council of Iron chat.

Dev/self-host only. The game runs fine without it. Binds to 127.0.0.1; the game
server proxies authenticated players' audio here (see docs/OPERATIONS.md).

Privacy: audio and transcripts are never written to disk or logged. Logs carry
sizes and timings only.

    GET  /health      -> {"ok": true, "model": ..., "device": ...}
    POST /transcribe  (raw audio body: webm/ogg/mp4/wav; optional ?prompt=...)
                      -> {"text", "language", "audioSeconds", "ms", "rtf"}
"""
from __future__ import annotations

import ctypes
import glob
import io
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
MAX_BODY = int(os.environ.get("STT_MAX_BYTES", 4 * 1024 * 1024))
MAX_SECONDS = 35.0


def preload_cuda_libraries() -> None:
    """ctranslate2 dlopens cuBLAS/cuDNN by soname; load the pip wheels' copies first."""
    try:
        import nvidia  # namespace package from nvidia-cublas-cu12 / nvidia-cudnn-cu12
    except ImportError:
        return
    for base in nvidia.__path__:
        for pattern in ("cublas/lib/libcublasLt.so*", "cublas/lib/libcublas.so*", "cudnn/lib/libcudnn*.so*"):
            for lib in sorted(glob.glob(os.path.join(base, pattern))):
                try:
                    ctypes.CDLL(lib, mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass


def game_vocabulary(map_path: Path) -> str:
    """Country/province names plus diplomacy terms, as Whisper hotwords (a biasing prompt)."""
    terms = ["alliance", "coalition", "declare war", "peace", "ceasefire", "truce", "betray",
             "garrison", "troops", "industry", "factory", "Prestige", "Council of Iron"]
    try:
        data = json.loads(map_path.read_text(encoding="utf-8"))
        terms += [c["name"] for c in data.get("countries", [])]
        terms += [p["name"] for p in data.get("provinces", [])]
    except (OSError, ValueError, KeyError):
        pass
    return ", ".join(dict.fromkeys(terms))


class Transcriber:
    def __init__(self) -> None:
        preload_cuda_libraries()
        from faster_whisper import WhisperModel

        self.model_name = os.environ.get("STT_MODEL", "large-v3-turbo")
        self.device = os.environ.get("STT_DEVICE", "cuda")
        compute = os.environ.get("STT_COMPUTE", "float16" if self.device == "cuda" else "int8")
        self.language = os.environ.get("STT_LANGUAGE", "en")  # "auto" = detect (slower)
        self.beam_size = int(os.environ.get("STT_BEAM", "5"))
        map_path = Path(os.environ.get("STT_VOCAB_MAP", HERE.parent.parent / "public" / "imperial-map.json"))
        self.hotwords = game_vocabulary(map_path)
        started = time.perf_counter()
        self.model = WhisperModel(self.model_name, device=self.device, compute_type=compute)
        self.lock = threading.Lock()  # one GPU decode at a time; requests queue briefly
        self._warm()
        print(f"[stt] model={self.model_name} device={self.device} compute={compute} "
              f"ready in {time.perf_counter() - started:.1f}s", flush=True)

    def _warm(self) -> None:
        import numpy as np

        rng = np.random.default_rng(0)
        noise = (rng.standard_normal(16000 * 2) * 0.01).astype("float32")
        for _ in range(2):
            segments, _info = self.model.transcribe(noise, language="en", beam_size=self.beam_size, vad_filter=False)
            list(segments)

    def transcribe(self, audio: bytes, prompt: str | None = None) -> dict:
        from faster_whisper.audio import decode_audio

        started = time.perf_counter()
        samples = decode_audio(io.BytesIO(audio), sampling_rate=16000)
        seconds = len(samples) / 16000
        if seconds > MAX_SECONDS:
            raise ValueError("Audio is too long.")
        hotwords = self.hotwords if not prompt else f"{prompt}, {self.hotwords}"
        with self.lock:
            segments, info = self.model.transcribe(
                samples,
                language=None if self.language == "auto" else self.language,
                beam_size=self.beam_size,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 200},
                hotwords=hotwords,
                condition_on_previous_text=False,
                without_timestamps=True,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
        elapsed = time.perf_counter() - started
        return {"text": re.sub(r"\s+", " ", text), "language": info.language,
                "audioSeconds": round(seconds, 2), "ms": round(elapsed * 1000),
                "rtf": round(elapsed / seconds, 4) if seconds else None}


def make_handler(engine: Transcriber):
    class Handler(BaseHTTPRequestHandler):
        server_version = "council-stt"

        def log_message(self, fmt, *args):  # no request lines (they could carry ?prompt=)
            pass

        def _json(self, status: int, data: dict) -> None:
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if urlparse(self.path).path == "/health":
                return self._json(200, {"ok": True, "model": engine.model_name, "device": engine.device})
            self._json(404, {"error": "Not found."})

        def do_POST(self):
            url = urlparse(self.path)
            if url.path != "/transcribe":
                return self._json(404, {"error": "Not found."})
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return self._json(400, {"error": "Empty audio."})
            if length > MAX_BODY:
                return self._json(413, {"error": "Audio too large."})
            audio = self.rfile.read(length)
            prompt = (parse_qs(url.query).get("prompt") or [None])[0]
            try:
                result = engine.transcribe(audio, prompt[:300] if prompt else None)
            except ValueError as error:
                return self._json(422, {"error": str(error)})
            except Exception as error:  # undecodable audio etc.; never echo audio or text
                print(f"[stt] failed: {type(error).__name__}", file=sys.stderr, flush=True)
                return self._json(422, {"error": "Could not decode or transcribe that audio."})
            print(f"[stt] {len(audio)}B {result['audioSeconds']}s -> {result['ms']}ms rtf={result['rtf']}", flush=True)
            self._json(200, result)

    return Handler


def main() -> None:
    host = os.environ.get("STT_HOST", "127.0.0.1")
    port = int(os.environ.get("STT_PORT", "3190"))
    engine = Transcriber()
    server = ThreadingHTTPServer((host, port), make_handler(engine))
    print(f"[stt] listening on http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
