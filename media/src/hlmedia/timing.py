"""Pure timing helpers for fitting library clips to narration."""
from __future__ import annotations

FPS = 24
NARRATION_PAD_S = 0.4
MAX_SLOWDOWN = 1.5  # beyond this motion looks unnatural; the last frame is held instead
SIZES = {"portrait": (720, 1280), "landscape": (1280, 720)}


def shot_duration(planned_s: float, narration_s: float | None) -> float:
    """A shot lasts its planned time, or longer if the narration needs it."""
    return max(planned_s, (narration_s or 0.0) + NARRATION_PAD_S)


def slowdown(clip_s: float, target_s: float) -> float:
    """PTS factor (1.0–1.5) that stretches a short clip toward the shot length; any rest is a held frame."""
    if clip_s <= 0:
        raise ValueError(f"clip duration must be positive, got {clip_s}")
    return min(MAX_SLOWDOWN, max(1.0, target_s / clip_s))
