"""Najdi narration with NAMAA-Saudi-TTS-V2 (F5-TTS / Habibi fine-tune on Najdi speech, 24 kHz).

The model clones the voice of a reference clip. The reference is Habibi-TTS's bundled Najdi
sample (SADA benchmark), whose exact transcript is below. Input text is diacritized first:
the model's vocabulary contains every haraka, so tashkeel steers pronunciation. Tashkeel
lives only inside this step; it is never stored or shown.
"""
from __future__ import annotations

import gc
from functools import lru_cache
from importlib import resources
from pathlib import Path

import numpy as np
import torch
from f5_tts.infer.utils_infer import load_model, load_vocoder, preprocess_ref_audio_text
from f5_tts.model import DiT
from habibi_tts.infer.utils_infer import infer_process
from huggingface_hub import hf_hub_download

from hlmedia.tashkeel import diacritize

MODEL_REPO = "NAMAA-Space/NAMAA-Saudi-TTS-V2"
SAMPLE_RATE = 24_000
# F5-TTS v1 Base, as stated on the NAMAA model card.
V1_BASE_CFG = dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4)
REF_AUDIO = "assets/Najdi.wav"
REF_TEXT = "تكفى طمني انا اليوم ماني بنايم ولا هو بداخل عيني النوم الين اتطمن عليه."
NFE_STEPS = 32  # model card: 16 fast, 32 default, 64 marginally better at 2x time


class _Voice:
    def __init__(self) -> None:
        if not torch.cuda.is_available():
            raise RuntimeError("NAMAA-Saudi-TTS-V2 inference here expects a CUDA GPU; none was found")
        ckpt = hf_hub_download(MODEL_REPO, "model_last.pt")
        vocab = hf_hub_download(MODEL_REPO, "vocab.txt")
        self.model = load_model(DiT, V1_BASE_CFG, ckpt, vocab_file=vocab, device="cuda").to(torch.float32).eval()
        self.vocoder = load_vocoder(device="cuda")
        ref_path = Path(str(resources.files("habibi_tts").joinpath(REF_AUDIO)))
        if not ref_path.exists():
            raise FileNotFoundError(f"Habibi reference clip missing: {ref_path}")
        self.ref_audio, self.ref_text = preprocess_ref_audio_text(str(ref_path), REF_TEXT)


@lru_cache(maxsize=1)
def _voice() -> _Voice:
    return _Voice()


def synthesize(narrations: list[str]) -> list[np.ndarray]:
    """One mono float32 waveform (24 kHz) per plain-Arabic narration, all in the reference voice."""
    if not narrations:
        raise ValueError("synthesize() needs at least one narration")
    voice = _voice()
    out: list[np.ndarray] = []
    for text in narrations:
        wave, sr, _ = infer_process(voice.ref_audio, voice.ref_text, diacritize(text), voice.model, voice.vocoder,
                                    nfe_step=NFE_STEPS, speed=1.0)
        if sr != SAMPLE_RATE:
            raise RuntimeError(f"NAMAA returned {sr} Hz audio, expected {SAMPLE_RATE}")
        out.append(np.asarray(wave, dtype=np.float32))
    return out


def release() -> None:
    """Frees the TTS model's GPU memory before the video model loads."""
    _voice.cache_clear()
    gc.collect()
    torch.cuda.empty_cache()
