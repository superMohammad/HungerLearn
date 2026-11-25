"""Arabic diacritization (tashkeel) for TTS input, using CATT (encoder-decoder, ONNX, CPU)."""
from __future__ import annotations

import re
from functools import lru_cache

from catt_tashkeel import CATTEncoderDecoder

PUNCT = "،.؟!:؛\n"
_SPLIT = re.compile(f"([{PUNCT}])")
# Short vowels / tanween / sukun on a word's last letter (an optional shadda may follow).
_FINAL_HARAKAT = re.compile(r"[ً-ِْ]+(?=ّ?(?:\s|$))")
_ANY_TASHKEEL = re.compile(r"[ً-ْٰ]")


@lru_cache(maxsize=1)
def _model() -> CATTEncoderDecoder:
    return CATTEncoderDecoder()


def pausal(text: str) -> str:
    """Drop case endings: Najdi speech pauses on every word end (sukun), unlike MSA i'rab."""
    return _FINAL_HARAKAT.sub("", text)


def strip_tashkeel(text: str) -> str:
    return _ANY_TASHKEEL.sub("", text)


def diacritize(text: str) -> str:
    """Adds tashkeel phrase by phrase, keeping the punctuation CATT would drop (TTS uses it for pauses)."""
    pieces = _SPLIT.split(strip_tashkeel(text))
    phrases = [p.strip() for p in pieces if p.strip() and p not in PUNCT]
    voweled = iter(_model().do_tashkeel_batch(phrases, verbose=False)) if phrases else iter(())
    out: list[str] = []
    for p in pieces:
        if p in PUNCT:
            out.append(p)
        elif p.strip():
            out.append(f" {pausal(next(voweled))} ")
    return re.sub(r"\s+([" + PUNCT.replace("\n", "") + r"])", r"\1", re.sub(r"[ \t]+", " ", "".join(out))).strip()
