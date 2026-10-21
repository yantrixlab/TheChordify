"""Chord engine selection: neural BTC model when available, classic DSP matcher otherwise.

CHORD_ENGINE=auto (default) uses BTC and falls back to the classic matcher if PyTorch or
the weights are missing; "btc" fails loudly instead; "classic" skips the model entirely.
CHORD_WORKERS caps how many songs are analysed at once so a small VPS isn't swamped.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Callable, Optional

from .chord_detection import detect_chords

ProgressFn = Callable[[int, str], None]

log = logging.getLogger("thechordify.engine")

_ENGINE = os.environ.get("CHORD_ENGINE", "auto").lower()
_slots = threading.Semaphore(int(os.environ.get("CHORD_WORKERS", "2")))


def analyze(audio_path: str, on_progress: Optional[ProgressFn] = None) -> dict:
    """Return the chord analysis dict, with an extra "engine" key naming what produced it."""
    progress = on_progress or (lambda _p, _s: None)

    if not _slots.acquire(blocking=False):
        progress(1, "Waiting for a free analysis slot")
        _slots.acquire()
    try:
        if _ENGINE != "classic":
            try:
                from .ai_chords import ModelUnavailableError, detect_chords_ai

                return {**detect_chords_ai(audio_path, on_progress=progress), "engine": "btc"}
            except ModelUnavailableError as exc:
                if _ENGINE == "btc":
                    raise
                log.warning("BTC model unavailable, using classic detector: %s", exc)
        return {**detect_chords(audio_path, on_progress=progress), "engine": "classic"}
    finally:
        _slots.release()
