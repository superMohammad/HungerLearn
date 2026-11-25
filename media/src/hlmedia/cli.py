"""`hlmedia render --spec spec.json --out-dir DIR --result result.json`

Per lesson: (1) Najdi narration for every shot with NAMAA-Saudi-TTS-V2 (tashkeel is added
inside the TTS step only); (2) per shot, the library clip is fitted to the shot length, the
HungerLearn logo (top-right) and the on-screen text are overlaid, and the narration is laid
over it; (3) shots are concatenated into one MP4.
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path

from hlmedia import tts
from hlmedia.overlay import render_overlay
from hlmedia.spec import RenderResult, RenderSpec
from hlmedia.timing import SIZES, shot_duration, slowdown
from hlmedia.video import compose_shot, compose_slide, concat, probe_seconds

log = logging.getLogger("hlmedia")


def render(spec: RenderSpec, out_dir: Path) -> RenderResult:
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    missing = [s.clip_file for s in spec.shots if s.clip_file is not None and not Path(s.clip_file).is_file()]
    if missing:
        raise FileNotFoundError(f"library clips not found: {missing} (see media/clips/CLIP-REQUESTS.md)")
    narrated = [s.narration for s in spec.shots if s.narration]
    if narrated and spec.language != "ar":
        raise ValueError("NAMAA-Saudi-TTS-V2 speaks Najdi Arabic only; English shots must have narration=null")

    voices = iter(tts.synthesize(narrated)) if narrated else iter(())
    audio = [next(voices) if s.narration else None for s in spec.shots]
    tts.release()
    log.info("narration ready", extra={"seconds": round(time.time() - started, 1)})

    size = SIZES[spec.orientation]
    shot_files: list[Path] = []
    total = 0.0
    for i, (shot, voice) in enumerate(zip(spec.shots, audio)):
        duration = shot_duration(shot.seconds, None if voice is None else len(voice) / tts.SAMPLE_RATE)
        overlay = render_overlay(size, Path(spec.brand_logo), shot.on_screen_text, spec.language, out_dir / f"overlay_{i}.png")
        shot_file = out_dir / f"shot_{i}.mp4"
        if shot.clip_file is None:
            compose_slide(size, overlay, voice, duration, shot_file)
        else:
            clip = Path(shot.clip_file)
            compose_shot(clip, size, overlay, voice, slowdown(probe_seconds(clip), duration), duration, shot_file)
        shot_files.append(shot_file)
        total += duration
    video = out_dir / "lesson.mp4"
    concat(shot_files, video)
    log.info("lesson rendered", extra={"seconds": round(time.time() - started, 1), "duration_s": round(total, 2)})
    return RenderResult(video=str(video.resolve()), duration_s=round(total, 2))


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(prog="hlmedia")
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("render", help="render a lesson video from library clips")
    r.add_argument("--spec", type=Path, required=True)
    r.add_argument("--out-dir", type=Path, required=True)
    r.add_argument("--result", type=Path, required=True)
    args = parser.parse_args()
    spec = RenderSpec.model_validate(json.loads(args.spec.read_text(encoding="utf-8")))
    result = render(spec, args.out_dir)
    args.result.write_text(result.model_dump_json(indent=2), encoding="utf-8")
    print(result.model_dump_json())


if __name__ == "__main__":
    main()
