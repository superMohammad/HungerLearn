"""Transparent overlay per shot: HungerLearn logo pinned top-right + on-screen text.

Text and logos are never generated inside the visuals; they are drawn here (Pillow + libraqm
for Arabic shaping) and composited over the clip. On-screen text is plain: no tashkeel.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, features

# HungerStation identity (hungerstation.com logo SVG + theme-color)
YELLOW = (0xFF, 0xD7, 0x00, 255)
DEEP_BROWN = (0x47, 0x1C, 0x09, 255)
CREAM = (0xFF, 0xF8, 0xE1, 238)
EMBER = (0xB2, 0x3C, 0x0B, 255)

FONT_ARABIC_BOLD = Path("/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf")
FONT_SYMBOLS = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
DO_MARKS = ("✅", "✔", "✓")
DONT_MARKS = ("❌", "✖", "✗", "×")


def _font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    if not path.exists():
        raise FileNotFoundError(f"Font not found: {path} (install fonts-noto-core / fonts-dejavu-core)")
    return ImageFont.truetype(str(path), size, layout_engine=ImageFont.Layout.RAQM)


def split_mark(text: str) -> tuple[str | None, str]:
    """('do' | 'dont' | None, text without the leading emoji mark)."""
    t = text.strip()
    for marks, kind in ((DO_MARKS, "do"), (DONT_MARKS, "dont")):
        for m in marks:
            if t.startswith(m):
                return kind, t[len(m):].strip()
    return None, t


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int, rtl: bool) -> list[str]:
    lines: list[str] = []
    cur = ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if not cur or draw.textlength(trial, font=font, direction="rtl" if rtl else "ltr") <= width:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    return [*lines, cur] if cur else lines


def render_overlay(size: tuple[int, int], logo: Path, on_screen_text: str, language: str, out: Path) -> Path:
    if not features.check("raqm"):
        raise RuntimeError("Pillow was built without libraqm; Arabic text would render unshaped")
    w, h = size
    unit = min(w, h)
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Logo, always top-right, on a cream plate so it reads over any footage.
    logo_img = Image.open(logo).convert("RGBA")
    logo_w = int(unit * 0.26)
    logo_img = logo_img.resize((logo_w, int(logo_img.height * logo_w / logo_img.width)), Image.Resampling.LANCZOS)
    pad, margin = int(unit * 0.02), int(unit * 0.035)
    plate = (w - margin - logo_w - 2 * pad, margin, w - margin, margin + logo_img.height + 2 * pad)
    draw.rounded_rectangle(plate, radius=pad * 2, fill=CREAM)
    img.alpha_composite(logo_img, (plate[0] + pad, plate[1] + pad))

    # On-screen text, bottom, large.
    kind, text = split_mark(on_screen_text)
    rtl = language == "ar"
    font = _font(FONT_ARABIC_BOLD, int(unit * 0.062))
    badge = int(unit * 0.085)
    max_text_w = int(w * 0.84) - (badge + pad if kind else 0)
    lines = _wrap(draw, text, font, max_text_w, rtl)[:3]
    line_h = int(font.size * 1.45)
    box_h = line_h * len(lines) + 2 * pad + pad
    box_w = max(draw.textlength(l, font=font, direction="rtl" if rtl else "ltr") for l in lines) + 3 * pad + (badge + pad if kind else 0)
    x0, y1 = (w - box_w) / 2, h - int(unit * 0.07)
    y0 = y1 - box_h
    draw.rounded_rectangle((x0, y0, x0 + box_w, y1), radius=pad * 2, fill=CREAM,
                           outline=EMBER if kind == "dont" else YELLOW, width=max(3, pad // 3))
    if kind:
        bx = x0 + box_w - pad - badge if rtl else x0 + pad
        by = y0 + (box_h - badge) / 2
        draw.ellipse((bx, by, bx + badge, by + badge), fill=EMBER if kind == "dont" else YELLOW)
        draw.text((bx + badge / 2, by + badge / 2), "✗" if kind == "dont" else "✓",
                  font=_font(FONT_SYMBOLS, int(badge * 0.62)), fill=(255, 255, 255, 255) if kind == "dont" else DEEP_BROWN, anchor="mm")
    text_right = x0 + box_w - 1.5 * pad - (badge + pad if kind and rtl else 0)
    text_left = x0 + 1.5 * pad + (badge + pad if kind and not rtl else 0)
    for i, line in enumerate(lines):
        y = y0 + 1.5 * pad + i * line_h
        if rtl:
            draw.text((text_right, y), line, font=font, fill=DEEP_BROWN, anchor="ra", direction="rtl", language="ar")
        else:
            draw.text((text_left, y), line, font=font, fill=DEEP_BROWN, anchor="la")
    img.save(out)
    return out
