"""Download a balanced sample of GuitarSet for the real-song benchmark.

GuitarSet (Xi et al., ISMIR 2018; CC BY 4.0; https://zenodo.org/records/3371780) is 360
recordings of an acoustic guitar with chord annotations. It is not part of BTC's training
data, so it is a fair held-out test. We only fetch what we need: the 39 MB annotation zip,
then individual audio files out of the 657 MB mono-mic zip via HTTP range requests.

Each song becomes eval/songs/guitarset/NAME.wav plus two reference files:
  NAME.lab            the "instructed" chord chart (lead-sheet level: major, minor, 7,
                      half-diminished), one chord per bar
  NAME.performed.lab  the chords actually played (semi-automatically transcribed, manually
                      verified), reduced to our 14 chord types: maj6, maj7, sus2, 9ths -> 7 ...
                      Dyads / bare interval sets have no chord symbol and become X (ignored).

    python eval/prepare_guitarset.py [--per-combo 2]
"""

from __future__ import annotations

import argparse
import io
import json
import os
import random
import re
import urllib.request
import zipfile

BASE = "https://zenodo.org/records/3371780/files"
OUT = os.path.join(os.path.dirname(__file__), "songs", "guitarset")
ANNOTATION_MD5 = "b39b78e63d3446f2e54ddb7a54df9b10"

OUR_QUALITIES = {"maj", "min", "7", "maj7", "min7", "hdim7", "maj6", "min6", "sus2", "sus4", "aug", "dim", "dim7", "minmaj7"}
EXTENDED = {"9": "7", "11": "7", "13": "7", "min9": "min7", "min11": "min7", "min13": "min7",
            "maj9": "maj7", "maj11": "maj7", "maj13": "maj7"}


def simplify(label: str) -> str:
    """Harte label with extensions/omissions (maj7(*5), maj(#11), 9(13)) -> one of our 14 types, or X."""
    if label in ("N", "X"):
        return label
    chord, _, _bass = label.partition("/")
    root, _, rest = chord.partition(":")
    quality = rest.split("(")[0]
    quality = EXTENDED.get(quality, quality)
    return f"{root}:{quality}" if quality in OUR_QUALITIES else "X"


class RangeFile(io.RawIOBase):
    """Read-only seekable view of a remote file, fetched in blocks with Range requests."""

    BLOCK = 1 << 20

    def __init__(self, url: str):
        self.url = url
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req) as r:
            self.size = int(r.headers["Content-Length"])
        self.pos = 0
        self._cache: dict[int, bytes] = {}

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = 0) -> int:
        self.pos = {0: offset, 1: self.pos + offset, 2: self.size + offset}[whence]
        return self.pos

    def _block(self, index: int) -> bytes:
        if index not in self._cache:
            start = index * self.BLOCK
            end = min(start + self.BLOCK, self.size) - 1
            req = urllib.request.Request(self.url, headers={"Range": f"bytes={start}-{end}"})
            with urllib.request.urlopen(req) as r:
                self._cache[index] = r.read()
        return self._cache[index]

    def read(self, n: int = -1) -> bytes:
        if n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        out = bytearray()
        while n > 0:
            index, offset = divmod(self.pos, self.BLOCK)
            chunk = self._block(index)[offset : offset + n]
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-combo", type=int, default=2, help="excerpts per style/progression (default 2)")
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    annotation_path = os.path.join(OUT, "_annotation.zip")
    if not os.path.exists(annotation_path):
        print("Downloading annotation.zip (39 MB)")
        urllib.request.urlretrieve(f"{BASE}/annotation.zip", annotation_path)
    annotations = zipfile.ZipFile(annotation_path)

    # style + progression (e.g. "Jazz2") -> comp excerpts
    combos: dict[str, list[str]] = {}
    for name in sorted(annotations.namelist()):
        m = re.match(r"(?:annotation/)?(\d+_([A-Za-z]+\d)-.*_comp)\.jams$", name)
        if m:
            combos.setdefault(m.group(2), []).append(m.group(1))

    rng = random.Random(args.seed)
    chosen = [s for names in combos.values() for s in rng.sample(names, min(args.per_combo, len(names)))]

    audio = zipfile.ZipFile(RangeFile(f"{BASE}/audio_mono-mic.zip"))
    audio_names = {os.path.basename(n): n for n in audio.namelist()}
    for stem in sorted(chosen):
        wav = f"{stem}_mic.wav"
        jams_name = next(n for n in annotations.namelist() if n.endswith(f"{stem}.jams"))
        chords = json.loads(annotations.read(jams_name))["annotations"]
        chord_annotations = [a for a in chords if a["namespace"] == "chord"]
        instructed, performed = chord_annotations[0]["data"], chord_annotations[1]["data"]

        wav_path = os.path.join(OUT, f"{stem}.wav")
        if not os.path.exists(wav_path):
            with open(wav_path, "wb") as f:
                f.write(audio.read(audio_names[wav]))
        with open(os.path.join(OUT, f"{stem}.lab"), "w", encoding="utf-8") as f:
            for c in instructed:
                f.write(f"{c['time']:.3f} {c['time'] + c['duration']:.3f} {c['value']}\n")
        with open(os.path.join(OUT, f"{stem}.performed.lab"), "w", encoding="utf-8") as f:
            for c in performed:
                f.write(f"{c['time']:.3f} {c['time'] + c['duration']:.3f} {simplify(c['value'])}\n")
        print(f"  {stem}")
    print(f"{len(chosen)} songs in {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
