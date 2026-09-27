"""Compare Whisper models on this GPU: latency, real-time factor and keyword accuracy.

    cd tools/stt && uv run bench.py [--models large-v3-turbo,large-v3,distil-large-v3.5] [--runs 5]

Downloads any model not already in ~/.cache/huggingface on first use.
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys
import tempfile
from pathlib import Path

from samples import PHRASES, have_tools, synthesize


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", default="large-v3-turbo,large-v3,distil-large-v3.5")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--beams", default="5,1")
    args = parser.parse_args()
    if not have_tools():
        sys.exit("bench needs espeak-ng and ffmpeg")
    tmp = Path(tempfile.mkdtemp(prefix="coi-stt-bench-"))
    clips = [(synthesize(text, tmp, f"p{i}"), keys) for i, (text, keys) in enumerate(PHRASES)]
    import server  # noqa: E402  (reuses the sidecar's CUDA preload and vocabulary)

    for model in args.models.split(","):
        for beam in [int(b) for b in args.beams.split(",")]:
            os.environ["STT_MODEL"], os.environ["STT_BEAM"] = model, str(beam)
            engine = server.Transcriber()
            times, rtfs, hits, total = [], [], 0, 0
            for files, keys in clips:
                audio = files["webm"].read_bytes()
                for _ in range(args.runs):
                    result = engine.transcribe(audio)
                    times.append(result["ms"])
                    rtfs.append(result["rtf"])
                said = result["text"].lower()
                hits += sum(k in said for k in keys)
                total += len(keys)
                print(f"   {model} beam={beam}: {result['audioSeconds']}s -> {result['text']!r}")
            print(f"== {model} beam={beam}: median {statistics.median(times):.0f} ms, p95 {sorted(times)[int(len(times) * .95) - 1]:.0f} ms, "
                  f"RTF {statistics.median(rtfs):.4f}, keywords {hits}/{total}", flush=True)
            del engine
            import gc
            gc.collect()


if __name__ == "__main__":
    main()
