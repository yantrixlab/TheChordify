"""Download audio from a YouTube/SoundCloud URL using yt-dlp.

Note: downloading audio from YouTube server-side sits in a legal gray area
under YouTube's Terms of Service. This is fine for personal/learning use;
revisit before running this as a public commercial product.

YouTube often refuses downloads from a server's IP address ("Sign in to confirm you're not a bot"). Cookies from a
logged-in browser get past it, but one account used for everything gets flagged. So there is a pool of accounts
(cookies.txt files pasted on the /admin page, plus YTDLP_COOKIES / YTDLP_COOKIES_FILE): downloads rotate through them,
each is capped per hour, and one that YouTube blocks rests for a while (longer each time it fails) while the others
carry on. With no accounts, or when all of them are resting, an anonymous attempt is made. YTDLP_PROXY routes
everything through a proxy (a residential one gets past address blocks).
"""

from __future__ import annotations

import glob
import hashlib
import json
import os
import random
import re
import shutil
import tempfile
import threading
import time
import uuid
from collections import deque
from typing import Optional

import yt_dlp

ALLOWED_HOSTS = (
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "soundcloud.com",
    "www.soundcloud.com",
)


class InvalidUrlError(ValueError):
    pass


class YouTubeBlocked(RuntimeError):
    """YouTube is refusing this server (and its accounts): the bot check, or an address block. Not about one video."""


class VideoNotDownloadable(RuntimeError):
    """YouTube answers this server fine, but this particular video cannot be fetched (region, age, format...)."""


def validate_url(url: str) -> None:
    if not re.match(r"^https?://", url):
        raise InvalidUrlError("URL must start with http:// or https://")
    host_match = re.match(r"^https?://([^/]+)/?", url)
    host = (host_match.group(1) if host_match else "").lower().replace("www.", "www.")
    if not any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS):
        raise InvalidUrlError("Only YouTube and SoundCloud URLs are supported")


_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_video_id(url: str) -> Optional[str]:
    """The 11-character YouTube video id in a watch / youtu.be / shorts / embed link, or None."""
    match = re.search(r"(?:[?&]v=|youtu\.be/|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])", url)
    return match.group(1) if match else None


def is_video_id(value: str) -> bool:
    return bool(_VIDEO_ID.match(value))


def session_id_for_url(url: str) -> str:
    """One id per song: yt_<video id> for YouTube (so the same song is found again whichever link it came from),
    a hash of the link for anything else."""
    video_id = extract_video_id(url)
    return f"yt_{video_id}" if video_id else cache_key_for_url(url)


def cache_key_for_url(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]


_CLIENTS: list[Optional[list[str]]] = [None, ["tv"], ["mweb"], ["android_vr"], ["web_safari"]]  # None = yt-dlp's default
_ACCOUNT_CLIENTS: list[Optional[list[str]]] = [None, ["mweb"]]  # with cookies, two ways of asking are enough
_NO_POINT_RETRYING = ("private video", "has been removed", "account associated", "terminated", "members-only", "unsupported url", "not a valid url", "copyright")
_BLOCKED = ("sign in to confirm", "not a bot", "http error 403", "http error 429", "po token", "requested format is not available", "page needs to be reloaded")
ANSI = re.compile(r"\x1b\[[0-9;]*m")  # colour codes in yt-dlp messages
_TEST_VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"  # a very widely available public video

HOURLY_CAP = int(os.environ.get("YTDLP_ACCOUNT_HOURLY", "40"))  # downloads per account per hour, then it rests
_COOLDOWN_BASE = 15 * 60  # first block: rest 15 minutes, doubling each time, up to 6 hours
_COOLDOWN_MAX = 6 * 3600

# The last few failed downloads, for the admin page: what failed, with which account, and whether it looks like a block.
recent_failures: deque = deque(maxlen=25)

_download_slot = threading.Semaphore(1)  # one download at a time, spaced out: bursts are what get an account flagged

# ---- the pool of accounts --------------------------------------------------------------------------------------------
_accounts_dir: Optional[str] = None
_state_path: Optional[str] = None
_lock = threading.RLock()
_state: dict = {"labels": {}, "health": {}}  # health[id] = {"failures", "cooldownUntil", "lastError", "lastOkAt"}
_uses: dict[str, deque] = {}  # timestamps of each account's recent downloads
_temp_copies: dict[str, tuple[str, str]] = {}  # id -> (digest of the cookies text, private temp copy yt-dlp may rewrite)


def configure(data_dir: str) -> None:
    """Where the accounts live (DATA_DIR/youtube-cookies/<id>.txt) and their health (youtube-accounts.json)."""
    global _accounts_dir, _state_path
    _accounts_dir = os.path.join(data_dir, "youtube-cookies")
    _state_path = os.path.join(data_dir, "youtube-accounts.json")
    os.makedirs(_accounts_dir, exist_ok=True)
    legacy = os.path.join(data_dir, "youtube-cookies.txt")  # the single cookies file of the first version becomes "main"
    if os.path.isfile(legacy) and not glob.glob(os.path.join(_accounts_dir, "*.txt")):
        os.replace(legacy, os.path.join(_accounts_dir, "main.txt"))
        _state["labels"].setdefault("main", "Main account")
    if os.path.isfile(_state_path):
        try:
            with open(_state_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            _state["labels"].update(loaded.get("labels", {}))
            _state["health"].update(loaded.get("health", {}))
        except (OSError, ValueError):
            pass
    _save_state()


def _save_state() -> None:
    if not _state_path:
        return
    with _lock:
        tmp = _state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_state, f)
        os.replace(tmp, _state_path)


def _read_accounts() -> dict[str, tuple[str, str]]:
    """{id: (cookies text, where it came from)} for every account that exists right now."""
    found: dict[str, tuple[str, str]] = {}
    if _accounts_dir:
        for path in sorted(glob.glob(os.path.join(_accounts_dir, "*.txt"))):
            account_id = os.path.splitext(os.path.basename(path))[0]
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                found[account_id] = (f.read(), "admin page")
    text = os.environ.get("YTDLP_COOKIES", "").strip()
    if text:
        found["env"] = (text, "YTDLP_COOKIES")
    path = os.environ.get("YTDLP_COOKIES_FILE", "").strip()
    if path and os.path.isfile(path):
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            found["envfile"] = (f.read(), "YTDLP_COOKIES_FILE")
    return found


def parse_cookies(text: str) -> list[dict]:
    """The cookies in a Netscape cookies.txt (the format browser extensions export); lines that are not cookies are skipped."""
    cookies = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]
        elif not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 7:
            continue
        domain, _flag, _path, _secure, expires, name, _value = parts
        cookies.append({"domain": domain, "name": name, "expires": int(expires) if expires.isdigit() else 0})
    return cookies


_LOGIN_COOKIES = ("SAPISID", "__Secure-3PSID", "__Secure-1PSID", "LOGIN_INFO")


def _describe(account_id: str, text: str, source: str) -> dict:
    cookies = [c for c in parse_cookies(text) if "youtube.com" in c["domain"] or "google.com" in c["domain"]]
    names = {c["name"] for c in cookies}
    expiries = [c["expires"] for c in cookies if c["expires"] > 0]
    now = time.time()
    health = _state["health"].get(account_id, {})
    recent = [t for t in _uses.get(account_id, ()) if now - t < 3600]
    cooling = health.get("cooldownUntil", 0) > now
    return {
        "id": account_id,
        "label": _state["labels"].get(account_id) or ("Account from " + source if source != "admin page" else account_id),
        "source": source,
        "cookies": len(cookies),
        "loggedIn": any(n in names for n in _LOGIN_COOKIES),
        "expiresSoonest": min(expiries) if expiries else None,
        "status": "resting" if cooling else ("full" if len(recent) >= HOURLY_CAP else "ready"),
        "restingUntil": health.get("cooldownUntil") if cooling else None,
        "usedLastHour": len(recent),
        "hourlyCap": HOURLY_CAP,
        "failures": health.get("failures", 0),
        "lastError": health.get("lastError", ""),
        "removable": source == "admin page",
    }


def list_accounts() -> list[dict]:
    with _lock:
        return [_describe(account_id, text, source) for account_id, (text, source) in _read_accounts().items()]


def add_account(text: str, label: str = "") -> dict:
    """Adds a pasted cookies.txt to the pool. Raises ValueError if it is not a usable YouTube cookies file."""
    if not _accounts_dir:
        raise ValueError("Cookie storage is not configured")
    text = text.replace("\r\n", "\n").strip()
    if len(text) > 300_000:
        raise ValueError("That file is too large to be a cookies.txt")
    if not [c for c in parse_cookies(text) if "youtube.com" in c["domain"]]:
        raise ValueError("No YouTube cookies found. Paste the whole cookies.txt (Netscape format) exported while on youtube.com.")
    with _lock:
        if len(glob.glob(os.path.join(_accounts_dir, "*.txt"))) >= 20:
            raise ValueError("That is plenty of accounts already (20). Remove one first.")
        account_id = "acc" + uuid.uuid4().hex[:6]
        path = os.path.join(_accounts_dir, account_id + ".txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        os.chmod(path, 0o600)
        _state["labels"][account_id] = label.strip()[:60] or f"Account {len(glob.glob(os.path.join(_accounts_dir, '*.txt')))}"
        _save_state()
        return _describe(account_id, text, "admin page")


def remove_account(account_id: str) -> bool:
    if not _accounts_dir or not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", account_id):
        return False
    path = os.path.join(_accounts_dir, account_id + ".txt")
    with _lock:
        if not os.path.isfile(path):
            return False
        os.remove(path)
        _state["labels"].pop(account_id, None)
        _state["health"].pop(account_id, None)
        _uses.pop(account_id, None)
        _temp_copies.pop(account_id, None)
        _save_state()
    return True


def reset_account(account_id: str) -> None:
    """Lets an account that is resting try again now."""
    with _lock:
        _state["health"].pop(account_id, None)
        _save_state()


def _usable_accounts() -> list[str]:
    """Accounts that may be used now (not resting, not over their hourly cap), the least recently used first."""
    now = time.time()
    with _lock:
        ready = []
        for account_id in _read_accounts():
            if _state["health"].get(account_id, {}).get("cooldownUntil", 0) > now:
                continue
            recent = [t for t in _uses.get(account_id, ()) if now - t < 3600]
            if len(recent) >= HOURLY_CAP:
                continue
            ready.append((recent[-1] if recent else 0.0, account_id))
        return [account_id for _last, account_id in sorted(ready)]


def _note_use(account_id: str) -> None:
    with _lock:
        _uses.setdefault(account_id, deque(maxlen=500)).append(time.time())


def _mark_ok(account_id: str) -> None:
    with _lock:
        _state["health"][account_id] = {"failures": 0, "cooldownUntil": 0, "lastError": "", "lastOkAt": time.time()}
        _save_state()


def _mark_blocked(account_id: str, error: str) -> None:
    """YouTube refused this account: rest it (15 min, then 30, 1 h... up to 6 h) so the others carry on."""
    with _lock:
        failures = _state["health"].get(account_id, {}).get("failures", 0) + 1
        rest = min(_COOLDOWN_MAX, _COOLDOWN_BASE * 2 ** (failures - 1))
        _state["health"][account_id] = {
            "failures": failures,
            "cooldownUntil": time.time() + rest,
            "lastError": ANSI.sub("", error)[:200],
            "lastOkAt": _state["health"].get(account_id, {}).get("lastOkAt", 0),
        }
        _save_state()


def _cookie_file(account_id: str) -> Optional[str]:
    """A private, writable copy of the account's cookies (yt-dlp rewrites its cookie file); refreshed when they change."""
    with _lock:
        entry = _read_accounts().get(account_id)
        if not entry or not entry[0].strip():
            return None
        text = entry[0]
        digest = hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()
        known = _temp_copies.get(account_id)
        if known and known[0] == digest and os.path.isfile(known[1]):
            return known[1]
        fd, path = tempfile.mkstemp(prefix="ytcookies-", suffix=".txt")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text if text.endswith(chr(10)) else text + chr(10))
        os.chmod(path, 0o600)
        _temp_copies[account_id] = (digest, path)
        return path


# ---- downloading -----------------------------------------------------------------------------------------------------
def _options(client: Optional[list[str]], cookies: Optional[str] = None) -> dict:
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "retries": 3,
        "socket_timeout": 25,
        # YouTube's player scripts need a JavaScript runtime; use whichever of these is installed.
        "js_runtimes": {"deno": {}, "node": {}},
    }
    if os.environ.get("YTDLP_PROXY"):
        opts["proxy"] = os.environ["YTDLP_PROXY"]
    if cookies:
        opts["cookiefile"] = cookies
    if client:
        opts["extractor_args"] = {"youtube": {"player_client": client}}
    return opts


def video_info(url: str) -> dict:
    """Title and artist/uploader for the player header. A missing title is never fatal."""
    try:
        validate_url(url)
        usable = _usable_accounts()
        cookies = _cookie_file(usable[0]) if usable else None
        with yt_dlp.YoutubeDL({**_options(None, cookies), "skip_download": True}) as ydl:
            info = ydl.extract_info(url, download=False) or {}
        return {
            "title": info.get("track") or info.get("title") or "",
            "artist": info.get("artist") or info.get("creator") or info.get("uploader") or "",
        }
    except Exception:
        return {"title": "", "artist": ""}


def download_audio(url: str, out_dir: str) -> str:
    """Download the best audio stream for `url` into `out_dir` as a .wav file.

    Returns the path to the downloaded .wav file. Requires ffmpeg on PATH. Accounts are tried in rotation; for each, one
    or more ways of asking YouTube; an account YouTube refuses rests while the others (and finally no account) are tried.
    """
    validate_url(url)
    os.makedirs(out_dir, exist_ok=True)
    key = cache_key_for_url(url)
    out_template = os.path.join(out_dir, f"{key}.%(ext)s")
    final_path = os.path.join(out_dir, f"{key}.wav")

    if os.path.exists(final_path):
        return final_path

    with _download_slot:
        time.sleep(random.uniform(0.5, 2.0))  # a human-ish pause between downloads
        return _download_with_fallbacks(url, out_template, final_path, out_dir, key)


def _attempt(url: str, out_template: str, final_path: str, out_dir: str, key: str, client, cookies: Optional[str]) -> Optional[Exception]:
    """One try. None on success, else the error (raised straight away when no other way could help)."""
    ydl_opts = {
        **_options(client, cookies),
        "format": "bestaudio/best",
        "outtmpl": out_template,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav", "preferredquality": "192"}],
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        if os.path.exists(final_path):
            return None
        return RuntimeError("Audio download succeeded but expected output file was not found")
    except Exception as exc:
        if any(marker in str(exc).lower() for marker in _NO_POINT_RETRYING):
            raise  # another way of asking will not bring back a removed or private video
        return exc
    finally:
        for leftover in glob.glob(os.path.join(out_dir, f"{key}.*")):
            if not leftover.endswith(".wav"):
                try:
                    os.remove(leftover)
                except OSError:
                    pass


def _probe(cookies: Optional[str]) -> bool:
    """Does YouTube still talk to us (with these cookies, or none)? A quick metadata request for a public video."""
    try:
        with yt_dlp.YoutubeDL({**_options(None, cookies), "skip_download": True}) as ydl:
            ydl.extract_info(_TEST_VIDEO, download=False)
        return True
    except Exception:
        return False


def _note_failure(key: str, account: str, error: Exception, verdict: str) -> None:
    recent_failures.appendleft(
        {"at": time.time(), "song": key, "account": account, "error": ANSI.sub("", str(error))[:220], "verdict": verdict}
    )


def _download_with_fallbacks(url: str, out_template: str, final_path: str, out_dir: str, key: str) -> str:
    last_error: Optional[Exception] = None
    server_ok = False  # some request got a normal answer from YouTube: the server and its accounts are not blocked
    labels = {a["id"]: a["label"] for a in list_accounts()}
    for account_id in _usable_accounts():
        cookies = _cookie_file(account_id)
        _note_use(account_id)
        blocked: Optional[Exception] = None
        for client in _ACCOUNT_CLIENTS:
            error = _attempt(url, out_template, final_path, out_dir, key, client, cookies)
            if error is None:
                _mark_ok(account_id)
                return final_path
            last_error = error
            if any(marker in str(error).lower() for marker in _BLOCKED):
                blocked = error
        if blocked is not None:
            # One video that will not download must not take the account out: only rest it if it cannot even fetch a
            # public video's details, which is what a real block looks like.
            if _probe(cookies):
                server_ok = True
                _note_failure(key, labels.get(account_id, account_id), blocked, "this video only; the account is fine")
            else:
                _mark_blocked(account_id, str(blocked))  # rest it; the next account (or no account) takes over
                _note_failure(key, labels.get(account_id, account_id), blocked, "account blocked, resting")

    for client in _CLIENTS:  # no account worked, or none is set: ask anonymously, trying each way of asking
        error = _attempt(url, out_template, final_path, out_dir, key, client, None)
        if error is None:
            return final_path
        last_error = error
    if not server_ok:
        server_ok = _probe(None)
    _note_failure(key, "no account", last_error or RuntimeError("unknown"), "this video only" if server_ok else "blocked")
    if server_ok:
        raise VideoNotDownloadable(str(last_error))
    raise YouTubeBlocked(str(last_error))


def diagnose(test: bool = False) -> dict:
    """What this server has to work with for YouTube, and (with test=True) whether YouTube lets each account in right now."""
    import importlib.util

    info: dict = {
        "ytDlp": yt_dlp.version.__version__,
        "playerScriptSolver": importlib.util.find_spec("yt_dlp_ejs") is not None,
        "jsRuntime": {"node": bool(shutil.which("node")), "deno": bool(shutil.which("deno"))},
        "accounts": list_accounts(),
        "proxy": bool(os.environ.get("YTDLP_PROXY")),
        "hourlyCap": HOURLY_CAP,
        "recentFailures": list(recent_failures),
    }
    if test:
        results = []
        targets: list[tuple[Optional[str], str]] = [(a["id"], a["label"]) for a in info["accounts"]] + [(None, "No account")]
        for account_id, label in targets:
            cookies = _cookie_file(account_id) if account_id else None
            attempts = []
            for client in (_ACCOUNT_CLIENTS if account_id else _CLIENTS):
                name = ",".join(client) if client else "default"
                try:
                    with yt_dlp.YoutubeDL({**_options(client, cookies), "skip_download": True}) as ydl:
                        ydl.extract_info(_TEST_VIDEO, download=False)
                    attempts.append({"client": name, "result": "ok"})
                    break
                except Exception as exc:
                    attempts.append({"client": name, "result": ANSI.sub("", str(exc))[:160]})
            ok = attempts[-1]["result"] == "ok"
            if account_id and ok:
                _mark_ok(account_id)  # a good test lifts any rest
            results.append({"id": account_id, "label": label, "ok": ok, "attempts": attempts})
        info["test"] = {"results": results, "ok": any(r["ok"] for r in results)}
        info["accounts"] = list_accounts()
    return info
