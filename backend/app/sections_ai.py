"""Song sections (intro / verse / chorus / instrumental / outro) from a trained structure model.

Uses the open-source "all-in-one" music structure analyzer (all-in-one-infer, MIT; trained on the Harmonix Set).
It separates the song into stems with Demucs and classifies each section from the stems, so it can tell a
verse from a chorus and hear when the singing stops (an instrumental break) - things a model-free approach
cannot do. CPU only, and heavy: minutes of CPU and a few GB of memory per song (almost all of it Demucs).

So the player never waits for it. The chord analysis finishes first and ships with the model-free sections
(structure.py); only then does this model run, in the background, one song at a time, in a child process under a
time budget, and its sections replace the quick ones when ready. It never runs next to the chord analysis (their
memory would add up and could take the whole server down), it is the first process the kernel kills if memory does
run out, and it does not start at all when too little memory is free. If the model is not installed, is too slow for
the machine, runs out of memory or fails for any reason, the quick sections simply stay.

SECTION_ENGINE=auto (default) uses the model when installed; "classic" skips it; "model" also forces it on a
machine with only one or two CPUs, where "auto" skips it as too slow.
SECTION_BUDGET is the most seconds the model may run once it starts (default 600).
SECTION_MIN_MEMORY_MB is the free memory it needs to start (default 3500); the tighter of the container limit and
what the machine has free counts.
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
import threading
import time
from typing import Optional

log = logging.getLogger("thechordify.sections")

Section = tuple[float, float, str]  # (start s, end s, label such as "verse")

_ENGINE = os.environ.get("SECTION_ENGINE", "auto").lower()
_MODEL = os.environ.get("SECTION_MODEL", "harmonix-all")
# Demucs chunk overlap: 0.25 is its default; 0.05 is ~20% faster with the same sections on our test song.
_OVERLAP = float(os.environ.get("SECTION_OVERLAP", "0.05"))
_BUDGET = float(os.environ.get("SECTION_BUDGET", "600"))
_MIN_MEMORY_MB = float(os.environ.get("SECTION_MIN_MEMORY_MB", "3500"))
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


def status() -> dict:
    """Whether the structure model can run on this machine, and if not, why. For the admin page and the start-up log: when
    the model is skipped the player falls back to the quick sections, which never name an instrumental break or an outro."""
    cpus = os.cpu_count() or 1
    installed = importlib.util.find_spec("allin1_infer") is not None
    free = available_memory_mb()
    if _ENGINE == "classic":
        reason = "SECTION_ENGINE=classic turns the model off"
    elif _ENGINE != "model" and cpus < _MIN_CPUS:
        reason = f"only {cpus} CPU(s); the model needs {_MIN_CPUS} (or set SECTION_ENGINE=model to force it)"
    elif not installed:
        reason = "all-in-one-infer is not installed (check the build log for 'structure model not installed')"
    elif free is not None and free < _MIN_MEMORY_MB:
        reason = f"only {free:.0f} MB of memory free right now; it needs {_MIN_MEMORY_MB:.0f} MB (SECTION_MIN_MEMORY_MB)"
    else:
        reason = "ready"
    return {
        "engine": _ENGINE, "installed": installed, "cpus": cpus, "minCpus": _MIN_CPUS,
        "freeMemoryMB": None if free is None else round(free), "minMemoryMB": _MIN_MEMORY_MB,
        "budgetSeconds": _BUDGET, "willRun": reason == "ready", "reason": reason,
    }


_slot = threading.Semaphore(1)  # one model at a time: it is heavy, and a queue of songs would exhaust memory


def available_memory_mb() -> Optional[float]:
    """Memory this process can still use: the tighter of the container's limit and what the machine has free.
    None where neither can be read (e.g. on Windows)."""
    values: list[float] = []
    try:
        with open("/proc/meminfo", "r", encoding="ascii") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    values.append(int(line.split()[1]) / 1024)
                    break
    except (OSError, ValueError):
        pass
    for limit_file, used_file in (
        ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"),  # cgroup v2
        ("/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.usage_in_bytes"),  # v1
    ):
        try:
            with open(limit_file, "r", encoding="ascii") as f:
                limit = f.read().strip()
            with open(used_file, "r", encoding="ascii") as f:
                used = int(f.read().strip())
            if limit.isdigit() and int(limit) < (1 << 50):  # "max" or a huge number means no limit
                values.append((int(limit) - used) / (1024 * 1024))
        except (OSError, ValueError):
            continue
    return min(values) if values else None


class SectionsJob:
    """The model for `audio_path`. `enabled` says whether it can run here; result() runs it (waiting its turn) and
    returns its sections. Call result() only once the chord analysis is finished."""

    def __init__(self, audio_path: str) -> None:
        self.enabled = False
        self._audio = audio_path
        if _ENGINE == "classic":
            return
        if _ENGINE != "model" and (os.cpu_count() or 1) < _MIN_CPUS:
            log.info("Only %s CPU(s): skipping the structure model (SECTION_ENGINE=model forces it)", os.cpu_count())
            return
        if importlib.util.find_spec("allin1_infer") is None:
            log.info("all-in-one-infer is not installed; using the model-free section analysis")
            return
        self.enabled = True

    def result(self) -> Optional[list[Section]]:
        """The model's sections, or None (off, too little memory, failed or out of time)."""
        if not self.enabled:
            return None
        with _slot:
            free = available_memory_mb()
            if free is not None and free < _MIN_MEMORY_MB:
                log.warning("Only %.0f MB of memory free (need %.0f): keeping the quick sections", free, _MIN_MEMORY_MB)
                return None
            return self._run_child(self._audio)

    @staticmethod
    def _run_child(audio_path: str) -> Optional[list[Section]]:
        work = tempfile.mkdtemp(prefix="sections-")
        try:
            error_log = os.path.join(work, "error.log")
            with open(error_log, "wb") as err:
                proc = subprocess.Popen(
                    [sys.executable, "-m", "app.sections_ai", audio_path, work],
                    cwd=_BACKEND_DIR,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=err,
                )
                try:
                    proc.wait(timeout=_BUDGET)
                except subprocess.TimeoutExpired:
                    log.warning("Structure model used its %.0f s budget; keeping the quick sections", _BUDGET)
                    proc.kill()
                    proc.wait()
                    return None
            out = os.path.join(work, "sections.json")
            if proc.returncode != 0 or not os.path.isfile(out):
                with open(error_log, "rb") as f:
                    tail = f.read()[-600:].decode("utf-8", "replace").strip()
                log.warning("Structure model failed (exit %s): %s", proc.returncode, tail)
                return None
            with open(out, "r", encoding="utf-8") as f:
                return [(float(a), float(b), str(c)) for a, b, c in json.load(f)] or None
        except Exception as exc:  # any failure here must not cost the user their chords
            log.warning("Structure model unusable: %s", exc)
            return None
        finally:
            shutil.rmtree(work, ignore_errors=True)


def _main(audio_path: str, work: str) -> int:
    try:
        # If the machine runs out of memory the kernel should kill this child, not the API server.
        with open("/proc/self/oom_score_adj", "w", encoding="ascii") as f:
            f.write("1000")
    except OSError:
        pass  # not Linux, or not allowed: nothing to do
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
