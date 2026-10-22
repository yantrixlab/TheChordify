"""Song sections (intro / verse / chorus / instrumental / outro) from a trained structure model.

Uses the open-source "all-in-one" music structure analyzer (all-in-one-infer, MIT; trained on the Harmonix Set).
It separates the song into stems with Demucs and classifies each section from the stems, so it can tell a
verse from a chorus and hear when the singing stops (an instrumental break) - things a model-free approach
cannot do. CPU only, and heavy: minutes of CPU and a few GB of memory per song.

So it runs in a child process, next to the chord analysis, under a time budget. If the model is not installed,
is too slow for the machine, runs out of memory or fails for any reason, the child is stopped and the song gets
the model-free structure analysis instead (structure.py): a slow or broken model must never hold up the chords.

SECTION_ENGINE=auto (default) uses the model when installed; "classic" skips it.
SECTION_BUDGET is the most seconds, counted from the start of the analysis, to wait for it (default 300).
SECTION_ENGINE=model uses it even on a machine with only one or two CPUs, where "auto" skips it as too slow.
Only the model's section boundaries and names are used: the beat grid, bars and chords stay ours (structure.py
snaps the boundaries to our bars).
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Callable, Optional

log = logging.getLogger("thechordify.sections")

Section = tuple[float, float, str]  # (start s, end s, label such as "verse")

_ENGINE = os.environ.get("SECTION_ENGINE", "auto").lower()
_MODEL = os.environ.get("SECTION_MODEL", "harmonix-all")
# Demucs chunk overlap: 0.25 is its default; 0.05 is ~20% faster with the same sections on our test song.
_OVERLAP = float(os.environ.get("SECTION_OVERLAP", "0.05"))
_BUDGET = float(os.environ.get("SECTION_BUDGET", "300"))
_MIN_CPUS = 3  # below this the model takes far longer than the budget, so "auto" does not even start it
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _analyze(audio_path: str, work: str) -> list[Section]:
    """Runs the model (in the child process). Raises on any failure."""
    import allin1_infer
    import librosa
    import soundfile as sf
    import torch

    # Demucs wants 44.1 kHz stereo; decoding here also avoids torchaudio's separate mp3 decoder.
    torch.manual_seed(0)  # Demucs shifts its chunks at random; fixing the seed makes a song always give the same sections
    wav = os.path.join(work, "song.wav")
    y, sr = librosa.load(audio_path, sr=44100, mono=False)
    sf.write(wav, y.T if y.ndim > 1 else y, sr)

    result = allin1_infer.analyze(
        wav,
        model=_MODEL,
        device="cpu",
        demix_dir=os.path.join(work, "demix"),
        spec_dir=os.path.join(work, "spec"),
        multiprocess=False,
        demucs_overlap=_OVERLAP,
    )
    return [(float(s.start), float(s.end), str(s.label)) for s in result.segments]


class SectionsJob:
    """Starts the model on `audio_path` right away; result() waits for it within the time budget."""

    def __init__(self, audio_path: str) -> None:
        self._started = time.monotonic()
        self._proc: Optional[subprocess.Popen] = None
        self._work = ""
        if _ENGINE == "classic":
            return
        if _ENGINE != "model" and (os.cpu_count() or 1) < _MIN_CPUS:
            log.info("Only %s CPU(s): skipping the structure model (SECTION_ENGINE=model forces it)", os.cpu_count())
            return
        if importlib.util.find_spec("allin1_infer") is None:
            log.info("all-in-one-infer is not installed; using the model-free section analysis")
            return
        self._work = tempfile.mkdtemp(prefix="sections-")
        try:
            self._proc = subprocess.Popen(
                [sys.executable, "-m", "app.sections_ai", audio_path, self._work],
                cwd=_BACKEND_DIR,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=open(os.path.join(self._work, "error.log"), "wb"),
            )
        except OSError as exc:
            log.warning("Could not start the structure model: %s", exc)
            self._cleanup()

    def result(self, on_wait: Optional[Callable[[float], None]] = None) -> Optional[list[Section]]:
        """The model's sections, or None (off, not installed, failed or out of time). `on_wait` is called about once
        a second with the share of the time budget used, so a caller can show progress."""
        proc = self._proc
        if proc is None:
            return None
        try:
            while proc.poll() is None:
                used = time.monotonic() - self._started
                if used >= _BUDGET:
                    log.warning("Structure model used its %.0f s budget; using the model-free section analysis", _BUDGET)
                    proc.kill()
                    proc.wait()
                    return None
                if on_wait:
                    on_wait(used / _BUDGET)
                time.sleep(1.0)
            out = os.path.join(self._work, "sections.json")
            if proc.returncode != 0 or not os.path.isfile(out):
                log.warning("Structure model failed (exit %s): %s", proc.returncode, self._error_tail())
                return None
            with open(out, "r", encoding="utf-8") as f:
                sections = [(float(a), float(b), str(c)) for a, b, c in json.load(f)]
            return sections or None
        except Exception as exc:  # any failure here must not cost the user their chords
            log.warning("Structure model result unusable: %s", exc)
            return None
        finally:
            self._cleanup()

    def _error_tail(self) -> str:
        try:
            with open(os.path.join(self._work, "error.log"), "rb") as f:
                return f.read()[-600:].decode("utf-8", "replace").strip()
        except OSError:
            return ""

    def _cleanup(self) -> None:
        if self._proc is not None and self._proc.poll() is None:
            self._proc.kill()
        if self._work:
            shutil.rmtree(self._work, ignore_errors=True)
        self._proc = None


def _main(audio_path: str, work: str) -> int:
    try:
        sections = _analyze(audio_path, work)
        with open(os.path.join(work, "sections.json.tmp"), "w", encoding="utf-8") as f:
            json.dump(sections, f)
        os.replace(os.path.join(work, "sections.json.tmp"), os.path.join(work, "sections.json"))
        return 0
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1], sys.argv[2]))
