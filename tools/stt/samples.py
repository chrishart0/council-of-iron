"""Synthetic spoken test clips (espeak-ng -> ffmpeg), so no recordings are bundled."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

# (text, words that must appear in the transcript, case-insensitive)
PHRASES = [
    ("The French Republic proposes an alliance against the German Empire. Hold Belgium and Rhineland.",
     ["french", "alliance", "german", "belgium", "rhineland"]),
    ("Russia will declare war on the Ottoman Empire unless you leave Serbia and Bulgaria by noon.",
     ["declare war", "ottoman", "serbia", "bulgaria"]),
    ("Our coalition needs Manchuria and Korea. Japan, move your troops out of Mongolia.",
     ["coalition", "manchuria", "korea", "mongolia"]),
]


def have_tools() -> bool:
    return bool(shutil.which("espeak-ng") and shutil.which("ffmpeg"))


def synthesize(text: str, out_dir: Path, stem: str) -> dict[str, Path]:
    """Return {'wav': ..., 'webm': ..., 'mp4': ...} for one phrase (mono, 48 kHz like a browser mic)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = out_dir / f"{stem}-raw.wav"
    subprocess.run(["espeak-ng", "-v", "en-us", "-s", "165", "-w", str(raw), text], check=True)
    files = {"wav": out_dir / f"{stem}.wav", "webm": out_dir / f"{stem}.webm", "mp4": out_dir / f"{stem}.m4a"}
    # A little leading/trailing silence, like a real push-to-talk clip.
    pad = ["-af", "adelay=300,apad=pad_dur=0.6", "-ar", "48000", "-ac", "1"]
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), *pad, str(files["wav"])], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(files["wav"]), "-c:a", "libopus", "-b:a", "32k", str(files["webm"])], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(files["wav"]), "-c:a", "aac", "-b:a", "64k", str(files["mp4"])], check=True)
    return files
