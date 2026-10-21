"""Download the BTC large-vocabulary chord model weights (MIT licence, jayg996/BTC-ISMIR19)."""

import os
import urllib.request

URL = "https://github.com/jayg996/BTC-ISMIR19/raw/master/test/btc_model_large_voca.pt"
DEST = os.path.join(os.path.dirname(__file__), "..", "models", "btc_model_large_voca.pt")


def main() -> None:
    dest = os.path.abspath(DEST)
    if os.path.isfile(dest):
        print(f"Already present: {dest}")
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print(f"Downloading {URL}")
    urllib.request.urlretrieve(URL, dest)
    print(f"Saved {dest} ({os.path.getsize(dest) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
