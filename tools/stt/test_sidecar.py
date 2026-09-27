"""End-to-end check of a running sidecar: generated speech in, key words out, latency reported.

    npm run stt            # in another terminal (or the systemd unit)
    cd tools/stt && uv run test_sidecar.py [--url http://127.0.0.1:3190] [--budget-ms 500]

Exits non-zero if a key word is missing or the median HTTP round trip exceeds the budget.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from samples import PHRASES, have_tools, synthesize


def post(url: str, audio: bytes, mime: str) -> tuple[dict, float]:
    request = urllib.request.Request(f"{url}/transcribe", data=audio, method="POST", headers={"Content-Type": mime})
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.load(response)
    return data, (time.perf_counter() - started) * 1000


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:3190")
    parser.add_argument("--budget-ms", type=float, default=500)
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()
    if not have_tools():
        print("SKIP: needs espeak-ng and ffmpeg")
        return 0
    health = json.load(urllib.request.urlopen(f"{args.url}/health", timeout=5))
    print(f"sidecar: {health}")
    tmp = Path(tempfile.mkdtemp(prefix="coi-stt-test-"))
    failures, rounds = 0, []
    for i, (text, keys) in enumerate(PHRASES):
        files = synthesize(text, tmp, f"p{i}")
        for kind, mime in (("webm", "audio/webm;codecs=opus"), ("mp4", "audio/mp4")):
            audio = files[kind].read_bytes()
            for _ in range(args.runs):
                result, ms = post(args.url, audio, mime)
                rounds.append(ms)
            missing = [k for k in keys if k not in result["text"].lower()]
            status = "ok" if not missing else f"MISSING {missing}"
            failures += bool(missing)
            print(f"{kind:4} {result['audioSeconds']:5.2f}s  server {result['ms']:4d} ms  round trip {ms:5.0f} ms  "
                  f"RTF {result['rtf']:.4f}  {status}: {result['text']}")
    median = statistics.median(rounds)
    print(f"median HTTP round trip {median:.0f} ms over {len(rounds)} requests (budget {args.budget_ms:.0f} ms)")
    if median > args.budget_ms:
        failures += 1
        print("FAIL: over latency budget")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
