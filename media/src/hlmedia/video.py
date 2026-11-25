"""ffmpeg assembly: library clip + overlay + narration → one shot; shots → one MP4. Clip audio is dropped."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

from hlmedia.timing import FPS

AUDIO_RATE = 24_000


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise FileNotFoundError("ffmpeg is not on PATH (apt install ffmpeg)")
    return exe


def _run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed (exit {proc.returncode}): {proc.stderr[-1500:]}\ncmd: {' '.join(cmd)}")


def probe_seconds(clip: Path) -> float:
    """Duration of a video file in seconds (ffprobe)."""
    exe = shutil.which("ffprobe")
    if exe is None:
        raise FileNotFoundError("ffprobe is not on PATH (apt install ffmpeg)")
    proc = subprocess.run([exe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(clip)],
                          capture_output=True, text=True, check=False)
    if proc.returncode != 0 or proc.stdout.strip() == "":
        raise RuntimeError(f"ffprobe could not read {clip}: {proc.stderr[-500:]}")
    return float(proc.stdout.strip())


def compose_shot(clip: Path, size: tuple[int, int], overlay: Path, narration: np.ndarray | None, slowdown: float,
                 duration: float, out: Path) -> None:
    """Scales/crops the clip to `size`, stretches it, holds the last frame if needed, adds overlay and voice."""
    w, h = size
    wav = out.with_suffix(".wav")
    samples = int(duration * AUDIO_RATE)
    audio = np.zeros(samples, dtype=np.float32)
    if narration is not None:
        start = int(0.2 * AUDIO_RATE)
        n = min(len(narration), samples - start)
        audio[start:start + n] = narration[:n]
    sf.write(wav, audio, AUDIO_RATE)
    _run([
        _ffmpeg(), "-y", "-loglevel", "error",
        "-i", str(clip), "-i", str(overlay), "-i", str(wav),
        "-filter_complex",
        f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1,setpts={slowdown:.4f}*PTS,"
        f"fps={FPS},tpad=stop_mode=clone:stop_duration={duration:.3f}[v];[v][1:v]overlay=0:0,format=yuv420p[out]",
        "-map", "[out]", "-map", "2:a", "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-ar", str(AUDIO_RATE),
        str(out),
    ])


def compose_slide(size: tuple[int, int], overlay: Path, narration: np.ndarray | None, duration: float, out: Path) -> None:
    """A shot with no matching library clip: brand-cream background + overlay + voice."""
    w, h = size
    background = out.with_name(out.stem + "_bg.mp4")
    _run([_ffmpeg(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=0xFFF8E1:s={w}x{h}:r={FPS}:d={duration:.3f}",
          "-c:v", "libx264", "-pix_fmt", "yuv420p", str(background)])
    compose_shot(background, size, overlay, narration, 1.0, duration, out)


def concat(shots: list[Path], out: Path) -> None:
    listing = out.with_suffix(".txt")
    listing.write_text("".join(f"file '{p.resolve()}'\n" for p in shots), encoding="utf-8")
    _run([_ffmpeg(), "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
          "-c", "copy", "-movflags", "+faststart", str(out)])
