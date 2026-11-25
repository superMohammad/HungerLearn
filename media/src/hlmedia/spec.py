"""Input and output contracts of `hlmedia render` (mirrored in web/src/lib/media.ts)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Shot(BaseModel):
    seconds: float = Field(ge=2, le=8, description="Planned on-screen time (the generator plans 3-7 s)")
    clip_file: str | None = Field(description="Library clip (media/clips/*.mp4), or null for a branded slide")
    on_screen_text: str = Field(min_length=1, description="Overlay caption, 8 words or fewer, plain letters")
    narration: str | None = Field(description="Najdi Arabic line for TTS, or null for a silent shot")


class RenderSpec(BaseModel):
    orientation: Literal["portrait", "landscape"]  # courier = phone (portrait), partner = tablet (landscape)
    language: Literal["ar", "en"]
    brand_logo: str
    shots: list[Shot] = Field(min_length=1, max_length=4)


class RenderResult(BaseModel):
    video: str
    duration_s: float
