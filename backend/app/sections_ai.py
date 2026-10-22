"""Song sections (intro / verse / chorus / instrumental / outro) from a trained structure model.

Uses the open-source "all-in-one" music structure analyzer (all-in-one-infer, MIT; trained on the Harmonix Set).
It separates the song into stems with Demucs and classifies each section from the stems, so it can tell a
verse from a chorus and hear when the singing stops (an instrumental break) - things a model-free approach
cannot do. CPU only; the cost is a few minutes per song, so it runs next to the chord analysis.

SECTION_ENGINE=auto (default) uses it when installed and falls back to the model-free structure analysis
otherwise; "classic" skips it. Only the model's section boundaries and names are used: the beat grid, bars and
chords stay ours (see structure.py, which snaps the boundaries to our bars).
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from typing import Optional

log = logging.getLogger("thechordify.sections")

Section = tuple[float, float, str]  # (start s, end s, label such as "verse")

_ENGINE = os.environ.get("SECTION_ENGINE", "auto").lower()
_MODEL = os.environ.get("SECTION_MODEL", "harmonix-all")
# Demucs chunk overlap: 0.25 is its default; 0.05 is ~20% faster with the same sections on our test song.
_OVERLAP = float(os.environ.get("SECTION_OVERLAP", "0.05"))


def sections_from_model(audio_path: str) -> Optional[list[Section]]:
    """The model's sections, or None when it is switched off, not installed or fails (callers fall back)."""
    if _ENGINE == "classic":
        return None
    work = tempfile.mkdtemp(prefix="sections-")
    try:
        import librosa
        import torch
        import soundfile as sf

        try:
            import allin1_infer
        except ImportError:
            log.info("all-in-one-infer is not installed; using the model-free section analysis")
            return None

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
        sections = [(float(s.start), float(s.end), str(s.label)) for s in result.segments]
        return sections or None
    except Exception as exc:  # any failure here must not cost the user their chords
        log.warning("Structure model failed, using the model-free section analysis: %s", exc)
        return None
    finally:
        shutil.rmtree(work, ignore_errors=True)
