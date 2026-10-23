"""People who have signed in, and their sessions.

Sign-in is Google only: the browser gets a signed ID token from Google, `verify_google` checks it (signature, audience,
expiry, verified email), and the person becomes a row in `users`. After that they carry a random session token in a
cookie; only its hash is stored here, so a copy of the database cannot be used to sign in as anybody.

Subscription plans, prices and what each plan includes are in plans.py.

Everything lives in the same database as the song catalog (Postgres, or the SQLite file), through the same small `run`
interface, so the SQL below is written to work on both.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import time
import uuid
from typing import Any, Optional

log = logging.getLogger("chordify.accounts")

SESSION_DAYS = 30

_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        google_sub    TEXT NOT NULL UNIQUE,
        email         TEXT NOT NULL,
        name          TEXT NOT NULL DEFAULT '',
        picture       TEXT NOT NULL DEFAULT '',
        plan_code     TEXT NOT NULL DEFAULT 'free',
        logins        INTEGER NOT NULL DEFAULT 0,
        disabled      INTEGER NOT NULL DEFAULT 0,
        created_at    DOUBLE PRECISION NOT NULL,
        last_login_at DOUBLE PRECISION NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS users_created ON users (created_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash  TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        created_at  DOUBLE PRECISION NOT NULL,
        expires_at  DOUBLE PRECISION NOT NULL
    )
    """,
]

class SignInError(ValueError):
    """The Google credential could not be accepted (the message is safe to show)."""


def verify_google(credential: str, client_id: str) -> dict:
    """Checks a Google ID token and returns who it is: {sub, email, name, picture}."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    try:
        info = id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)
    except Exception as exc:  # bad signature, wrong audience, expired, certificates unreachable...
        log.info("Google sign-in rejected: %s", exc)
        raise SignInError("Google could not confirm that sign-in. Please try again.") from exc
    if not info.get("email") or not info.get("email_verified"):
        raise SignInError("That Google account has no verified email address.")
    email = str(info["email"]).strip().lower()
    return {
        "sub": str(info["sub"]),
        "email": email,
        "name": (info.get("name") or email.split("@")[0]).strip(),
        "picture": info.get("picture") or "",
    }


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _user(row: dict) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "picture": row["picture"],
        "plan": row["plan_code"],
        "logins": row["logins"],
        "disabled": bool(row["disabled"]),
        "createdAt": row["created_at"],
        "lastLoginAt": row["last_login_at"],
    }


class AccountStore:
    def __init__(self, db: Any) -> None:
        self._db = db
        for statement in _SCHEMA:
            db.run(statement)

    # ----- people -----------------------------------------------------------------------------------------------

    def sign_in(self, sub: str, email: str, name: str, picture: str) -> dict:
        """Creates the person on their first Google sign-in, or refreshes their name and picture on a later one."""
        now = time.time()
        rows, _ = self._db.run(
            """
            INSERT INTO users (id, google_sub, email, name, picture, logins, created_at, last_login_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(google_sub) DO UPDATE SET
                email = excluded.email,
                name = excluded.name,
                picture = excluded.picture,
                logins = users.logins + 1,
                last_login_at = excluded.last_login_at
            RETURNING *
            """,
            (uuid.uuid4().hex, sub, email, name, picture, now, now),
        )
        return _user(rows[0])

    def list_users(self, search: str = "", limit: int = 25, offset: int = 0) -> tuple[list[dict], int]:
        where, params = "", ()
        if search.strip():
            like = f"%{search.strip().lower()}%"
            where, params = "WHERE LOWER(email) LIKE ? OR LOWER(name) LIKE ?", (like, like)
        total, _ = self._db.run(f"SELECT COUNT(*) AS n FROM users {where}", params)
        rows, _ = self._db.run(
            f"SELECT * FROM users {where} ORDER BY created_at DESC LIMIT ? OFFSET ?", (*params, limit, offset)
        )
        return [_user(r) for r in rows], total[0]["n"]

    def count_users(self) -> dict:
        rows, _ = self._db.run(
            "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END), 0) AS week FROM users",
            (time.time() - 7 * 86400,),
        )
        return {"total": rows[0]["total"], "lastWeek": int(rows[0]["week"])}

    def set_disabled(self, user_id: str, disabled: bool) -> bool:
        _, changed = self._db.run("UPDATE users SET disabled = ? WHERE id = ?", (1 if disabled else 0, user_id))
        if disabled:
            self._db.run("DELETE FROM sessions WHERE user_id = ?", (user_id,))  # signed out everywhere, at once
        return changed > 0

    # ----- sessions ---------------------------------------------------------------------------------------------

    def start_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        now = time.time()
        self._db.run(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (_hash(token), user_id, now, now + SESSION_DAYS * 86400),
        )
        self._db.run("DELETE FROM sessions WHERE expires_at < ?", (now,))  # tidy up, a few at a time
        return token

    def user_for_session(self, token: str) -> Optional[dict]:
        if not token:
            return None
        rows, _ = self._db.run(
            """
            SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0
            """,
            (_hash(token), time.time()),
        )
        return _user(rows[0]) if rows else None

    def end_session(self, token: str) -> None:
        if token:
            self._db.run("DELETE FROM sessions WHERE token_hash = ?", (_hash(token),))
