"""Download model weights at image build time, so the first song does not wait on them.

- BTC large-vocabulary chord model (MIT licence, jayg996/BTC-ISMIR19).
- Song-structure model and Demucs (all-in-one-infer, MIT), if installed. Optional: without it the app falls back to the
  model-free section analysis.
"""

import os
import urllib.request

URL = "https://github.com/jayg996/BTC-ISMIR19/raw/master/test/btc_model_large_voca.pt"
DEST = os.path.join(os.path.dirname(__file__), "..", "models", "btc_model_large_voca.pt")


def fetch_chord_model() -> None:
    dest = os.path.abspath(DEST)
    if os.path.isfile(dest):
        print(f"Already present: {dest}")
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print(f"Downloading {URL}")
    urllib.request.urlretrieve(URL, dest)
    print(f"Saved {dest} ({os.path.getsize(dest) / 1e6:.1f} MB)")


def fetch_structure_models() -> None:
    try:
        from allin1_infer.models import load_pretrained_model
        from demucs_infer.pretrained import get_model
    except ImportError:
        print("all-in-one-infer is not installed; skipping the structure model")
        return
    try:
        load_pretrained_model(os.environ.get("SECTION_MODEL", "harmonix-all"), device="cpu")
        get_model("htdemucs")
        print("Structure model and Demucs weights are cached")
    except Exception as exc:  # the app still works without them (model-free sections)
        print(f"Could not cache the structure model: {exc}")


def main() -> None:
    fetch_chord_model()
    fetch_structure_models()


if __name__ == "__main__":
    main()
