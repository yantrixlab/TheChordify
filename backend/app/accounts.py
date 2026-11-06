"""People who have signed in, and their sessions.

Sign-in is Google only: the browser gets a signed ID token from Google, `verify_google` checks it (signature, audience,
expiry, verified email), and the person becomes a row in `users`. After that they carry a random session token in a
cookie; only its hash is stored here, so a copy of the database cannot be used to sign in as anybody.

Staff accounts (an admin, an editor...) have a role (see roles.py) and may have a password, for the admin's email-and-password sign-in; their
google_sub is "pw:<id>" until they sign in with Google using the same email, which then links the two. General users have role "user"
and no password.

Subscription plans, prices and what each plan includes are in plans.py.

Everything lives in the same database as the song catalog (Postgres, or the SQLite file), through the same small `run`
interface, so the SQL below is written to work on both.
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import time
import uuid
from typing import Any, Optional

log = logging.getLogger("chordify.accounts")

SESSION_DAYS = 30
STAFF_SESSION_DAYS = 7  # somebody who signed in to the admin with a password stays signed in for a shorter time

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


def _read_prefs(text: Any) -> dict:
    try:
        value = json.loads(text or "{}")
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _user(row: dict) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "picture": row["picture"],
        "role": row.get("role") or "user",
        "hasPassword": bool(row.get("password_hash")),
        "plan": row["plan_code"],
        "instrument": row.get("instrument") or "",  # the instrument the person shows chords for ("" until they choose)
        "prefs": _read_prefs(row.get("prefs")),  # their other settings (see SETTINGS in main.py): stored as JSON text
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
        self._ensure_columns()

    def _ensure_columns(self) -> None:
        """Adds the role and password columns to a users table made before they existed (nothing changes for people already there: they
        are general users with no password)."""
        wanted = {"role": "TEXT NOT NULL DEFAULT 'user'", "password_hash": "TEXT NOT NULL DEFAULT ''", "instrument": "TEXT NOT NULL DEFAULT ''", "prefs": "TEXT NOT NULL DEFAULT '{}'", "partner_id": "TEXT NOT NULL DEFAULT ''", "partner_at": "DOUBLE PRECISION NOT NULL DEFAULT 0"}
        if getattr(self._db, "kind", "sqlite") == "postgres":
            for column, ddl in wanted.items():
                self._db.run(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {column} {ddl}")
        else:
            rows, _ = self._db.run("PRAGMA table_info(users)")
            have = {r["name"] for r in rows}
            for column, ddl in wanted.items():
                if column not in have:
                    self._db.run(f"ALTER TABLE users ADD COLUMN {column} {ddl}")
        self._db.run("CREATE INDEX IF NOT EXISTS users_role ON users (role)")

    # ----- people -----------------------------------------------------------------------------------------------

    def sign_in(self, sub: str, email: str, name: str, picture: str) -> dict:
        """Creates the person on their first Google sign-in, or refreshes their name and picture on a later one. A staff account that was
        made with an email and password (google_sub "pw:...") is linked to the Google account with the same verified email, and keeps its role."""
        now = time.time()
        taken, _ = self._db.run("SELECT 1 AS x FROM users WHERE google_sub = ?", (sub,))
        if not taken:
            made, _ = self._db.run("SELECT id FROM users WHERE LOWER(email) = ? AND google_sub LIKE ?", (email.lower(), "pw:%"))  # (a % never goes in the SQL text: Postgres reads it as a placeholder)
            if made:
                rows, _ = self._db.run(
                    "UPDATE users SET google_sub = ?, picture = ?, logins = logins + 1, last_login_at = ? WHERE id = ? RETURNING *",
                    (sub, picture, now, made[0]["id"]),
                )
                return _user(rows[0])
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

    def list_users(self, search: str = "", limit: int = 25, offset: int = 0, role: str = "") -> tuple[list[dict], int]:
        clauses, params = [], []
        if search.strip():
            like = f"%{search.strip().lower()}%"
            clauses.append("(LOWER(email) LIKE ? OR LOWER(name) LIKE ?)")
            params += [like, like]
        if role:
            clauses.append("role = ?")
            params.append(role)
        where, params = ("WHERE " + " AND ".join(clauses) if clauses else ""), tuple(params)
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

    def set_instrument(self, user_id: str, instrument: str) -> bool:
        _, changed = self._db.run("UPDATE users SET instrument = ? WHERE id = ?", (instrument, user_id))
        return changed > 0

    def set_prefs(self, user_id: str, prefs: dict) -> bool:
        _, changed = self._db.run("UPDATE users SET prefs = ? WHERE id = ?", (json.dumps(prefs, separators=(",", ":")), user_id))
        return changed > 0

    def set_disabled(self, user_id: str, disabled: bool) -> bool:
        _, changed = self._db.run("UPDATE users SET disabled = ? WHERE id = ?", (1 if disabled else 0, user_id))
        if disabled:
            self._db.run("DELETE FROM sessions WHERE user_id = ?", (user_id,))  # signed out everywhere, at once
        return changed > 0

    # ----- sessions ---------------------------------------------------------------------------------------------

    def start_session(self, user_id: str, days: int = SESSION_DAYS) -> str:
        token = secrets.token_urlsafe(32)
        now = time.time()
        self._db.run(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (_hash(token), user_id, now, now + days * 86400),
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

    # ----- staff: roles and passwords ---------------------------------------------------------------------------

    def get_user(self, user_id: str) -> Optional[dict]:
        rows, _ = self._db.run("SELECT * FROM users WHERE id = ?", (user_id,))
        return _user(rows[0]) if rows else None

    def password_row(self, email: str) -> Optional[dict]:
        """The raw row of the person with this email who has a password (its hash included, for checking a sign-in), or None."""
        rows, _ = self._db.run("SELECT * FROM users WHERE LOWER(email) = ? AND password_hash <> '' ORDER BY created_at LIMIT 1", (email.strip().lower(),))
        return rows[0] if rows else None

    def email_taken(self, email: str) -> bool:
        rows, _ = self._db.run("SELECT 1 AS x FROM users WHERE LOWER(email) = ?", (email.strip().lower(),))
        return bool(rows)

    def create_staff(self, email: str, name: str, password_hash: str, role: str) -> dict:
        """A new account made by an admin, with an email and a password (no Google sign-in yet; see sign_in for how it links later)."""
        now = time.time()
        user_id = uuid.uuid4().hex
        rows, _ = self._db.run(
            """
            INSERT INTO users (id, google_sub, email, name, picture, role, password_hash, logins, created_at, last_login_at)
            VALUES (?, ?, ?, ?, '', ?, ?, 0, ?, 0) RETURNING *
            """,
            (user_id, "pw:" + user_id, email.strip().lower(), name.strip(), role, password_hash, now),
        )
        return _user(rows[0])

    def set_role(self, user_id: str, role: str) -> bool:
        _, changed = self._db.run("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
        return changed > 0

    def set_password(self, user_id: str, password_hash: str) -> bool:
        """Sets (or changes) a password. Every other sign-in of that person ends, so a reset also signs out whoever had the old one."""
        _, changed = self._db.run("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
        if changed:
            self._db.run("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        return changed > 0

    def touch_login(self, user_id: str) -> None:
        self._db.run("UPDATE users SET logins = logins + 1, last_login_at = ? WHERE id = ?", (time.time(), user_id))

    def count_role(self, role: str, excluding: str = "") -> int:
        """People with this role who are not blocked (leaving `excluding` out)."""
        rows, _ = self._db.run("SELECT COUNT(*) AS n FROM users WHERE role = ? AND disabled = 0 AND id <> ?", (role, excluding))
        return int(rows[0]["n"])

    def role_counts(self) -> dict[str, int]:
        rows, _ = self._db.run("SELECT role, COUNT(*) AS n FROM users GROUP BY role")
        return {r["role"]: int(r["n"]) for r in rows}

    def move_role(self, from_role: str, to_role: str) -> int:
        """Everybody with one role gets another (when a role is deleted). Returns how many."""
        _, changed = self._db.run("UPDATE users SET role = ? WHERE role = ?", (to_role, from_role))
        return changed

    def has_staff(self) -> bool:
        rows, _ = self._db.run("SELECT 1 AS x FROM users WHERE role <> 'user' AND disabled = 0 LIMIT 1")
        return bool(rows)

    def delete_user(self, user_id: str) -> bool:
        """Removes a person: their sign-ins and their account (name, email, picture, Google id). True when there was one."""
        self._db.run("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        _, removed = self._db.run("DELETE FROM users WHERE id = ?", (user_id,))
        return removed > 0

    def session_count(self, user_id: str) -> int:
        rows, _ = self._db.run("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?", (user_id, time.time()))
        return int(rows[0]["n"])

    def end_other_sessions(self, user_id: str, keep_token: str) -> int:
        """Signs the person out everywhere but where they are now. Returns how many sign-ins ended."""
        _, removed = self._db.run("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", (user_id, _hash(keep_token)))
        return int(removed)

    def end_session(self, token: str) -> None:
        if token:
            self._db.run("DELETE FROM sessions WHERE token_hash = ?", (_hash(token),))
