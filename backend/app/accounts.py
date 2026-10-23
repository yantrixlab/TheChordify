"""People who have signed in, their sessions, and the subscription plans the admin manages.

Sign-in is Google only: the browser gets a signed ID token from Google, `verify_google` checks it (signature, audience,
expiry, verified email), and the person becomes a row in `users`. After that they carry a random session token in a
cookie; only its hash is stored here, so a copy of the database cannot be used to sign in as anybody.

Plans are what the admin pages edit. A plan has the fields Razorpay's Plans API wants (period, interval, amount in the
smallest unit of the currency, and its own Razorpay plan id once it has been created there), so charging for them can be
added without reshaping anything.

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
    """
    CREATE TABLE IF NOT EXISTS plans (
        id               TEXT PRIMARY KEY,
        code             TEXT NOT NULL UNIQUE,
        name             TEXT NOT NULL,
        description      TEXT NOT NULL DEFAULT '',
        price_minor      INTEGER NOT NULL DEFAULT 0,
        currency         TEXT NOT NULL DEFAULT 'INR',
        period           TEXT NOT NULL DEFAULT 'monthly',
        interval_count   INTEGER NOT NULL DEFAULT 1,
        features         TEXT NOT NULL DEFAULT '[]',
        missing          TEXT NOT NULL DEFAULT '[]',
        badge            TEXT NOT NULL DEFAULT '',
        cta              TEXT NOT NULL DEFAULT '',
        featured         INTEGER NOT NULL DEFAULT 0,
        active           INTEGER NOT NULL DEFAULT 1,
        sort_order       INTEGER NOT NULL DEFAULT 0,
        razorpay_plan_id TEXT NOT NULL DEFAULT '',
        created_at       DOUBLE PRECISION NOT NULL,
        updated_at       DOUBLE PRECISION NOT NULL
    )
    """,
]

PERIODS = ("daily", "weekly", "monthly", "quarterly", "yearly", "forever")  # Razorpay's periods, plus a free plan that never renews

# The plans the site shows today, so the admin has something to edit on the first day.
_DEFAULT_PLANS = [
    {
        "code": "free", "name": "Free", "price_minor": 0, "currency": "USD", "period": "forever", "sort_order": 1,
        "description": "Everything you need to start jamming today.", "cta": "Get started free",
        "features": ["5 chord extractions / day", "Guitar & ukulele chords", "Real-time chord scrolling", "Basic transposition", "Mobile & desktop app"],
        "missing": ["Piano & mandolin chords", "PDF / MIDI export", "Live mic detection", "Unlimited songs", "Offline mode"],
    },
    {
        "code": "premium", "name": "Premium", "price_minor": 499, "currency": "USD", "period": "monthly", "sort_order": 2,
        "description": "For serious players who want the full experience.", "cta": "Start 7-day free trial",
        "badge": "Most popular", "featured": 1,
        "features": ["Unlimited chord extractions", "All 4 instruments", "Real-time chord scrolling", "Full transposition + capo", "PDF & MIDI export",
                     "Live mic chord detection", "A–B loop + slow-down", "Offline mode", "Priority processing"],
        "missing": [],
    },
    {
        "code": "pro", "name": "Pro", "price_minor": 999, "currency": "USD", "period": "monthly", "sort_order": 3,
        "description": "For teachers, creators, and professional musicians.", "cta": "Go Pro",
        "features": ["Everything in Premium", "Chord progression analysis", "Multi-track export", "Team library (5 seats)", "API access (beta)",
                     "Custom chord tunings", "White-label PDF export", "Dedicated support"],
        "missing": [],
    },
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


def _plan(row: dict) -> dict:
    return {
        "id": row["id"],
        "code": row["code"],
        "name": row["name"],
        "description": row["description"],
        "priceMinor": row["price_minor"],
        "currency": row["currency"],
        "period": row["period"],
        "intervalCount": row["interval_count"],
        "features": json.loads(row["features"] or "[]"),
        "missing": json.loads(row["missing"] or "[]"),
        "badge": row["badge"],
        "cta": row["cta"],
        "featured": bool(row["featured"]),
        "active": bool(row["active"]),
        "sortOrder": row["sort_order"],
        "razorpayPlanId": row["razorpay_plan_id"],
        "updatedAt": row["updated_at"],
    }


class AccountStore:
    def __init__(self, db: Any) -> None:
        self._db = db
        for statement in _SCHEMA:
            db.run(statement)
        self._seed_plans()

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

    # ----- plans ------------------------------------------------------------------------------------------------

    def _seed_plans(self) -> None:
        rows, _ = self._db.run("SELECT COUNT(*) AS n FROM plans")
        if rows[0]["n"]:
            return
        for plan in _DEFAULT_PLANS:
            self.save_plan(plan)

    def list_plans(self, only_active: bool = False) -> list[dict]:
        where = "WHERE active = 1" if only_active else ""
        rows, _ = self._db.run(f"SELECT * FROM plans {where} ORDER BY sort_order ASC, created_at ASC")
        return [_plan(r) for r in rows]

    def get_plan(self, plan_id: str) -> Optional[dict]:
        rows, _ = self._db.run("SELECT * FROM plans WHERE id = ?", (plan_id,))
        return _plan(rows[0]) if rows else None

    def save_plan(self, data: dict, plan_id: Optional[str] = None) -> dict:
        """Creates a plan, or replaces the editable fields of `plan_id`. Raises ValueError for a mistake worth telling the admin."""
        if plan_id is not None and self.get_plan(plan_id) is None:
            raise LookupError("That plan does not exist.")
        code = str(data.get("code", "")).strip().lower()
        name = str(data.get("name", "")).strip()
        if not name:
            raise ValueError("A plan needs a name.")
        if not code or not all(c.isalnum() or c in "-_" for c in code):
            raise ValueError("The plan code can only use letters, numbers, - and _.")
        period = data.get("period", "monthly")
        if period not in PERIODS:
            raise ValueError(f"The period must be one of: {', '.join(PERIODS)}.")
        price = int(data.get("price_minor", 0) or 0)
        interval = max(1, int(data.get("interval_count", 1) or 1))
        if price < 0:
            raise ValueError("The price cannot be negative.")
        currency = str(data.get("currency", "INR")).strip().upper()
        if len(currency) != 3 or not currency.isalpha():
            raise ValueError("The currency must be a three-letter code such as INR or USD.")
        clash, _ = self._db.run("SELECT id FROM plans WHERE code = ?", (code,))
        if clash and clash[0]["id"] != plan_id:
            raise ValueError(f"There is already a plan with the code “{code}”.")
        fields = (
            code, name, str(data.get("description", "")).strip(), price, currency, period, interval,
            json.dumps([str(f).strip() for f in data.get("features", []) if str(f).strip()]),
            json.dumps([str(f).strip() for f in data.get("missing", []) if str(f).strip()]),
            str(data.get("badge", "")).strip(), str(data.get("cta", "")).strip(),
            1 if data.get("featured") else 0, 0 if data.get("active") is False else 1, int(data.get("sort_order", 0) or 0),
            str(data.get("razorpay_plan_id", "")).strip(),
        )
        now = time.time()
        if plan_id is None:
            plan_id = uuid.uuid4().hex
            self._db.run(
                """
                INSERT INTO plans (code, name, description, price_minor, currency, period, interval_count, features, missing, badge, cta,
                                   featured, active, sort_order, razorpay_plan_id, id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (*fields, plan_id, now, now),
            )
        else:
            _, changed = self._db.run(
                """
                UPDATE plans SET code = ?, name = ?, description = ?, price_minor = ?, currency = ?, period = ?, interval_count = ?,
                                 features = ?, missing = ?, badge = ?, cta = ?, featured = ?, active = ?, sort_order = ?,
                                 razorpay_plan_id = ?, updated_at = ?
                WHERE id = ?
                """,
                (*fields, now, plan_id),
            )
            if changed == 0:
                raise LookupError("That plan does not exist.")
        return self.get_plan(plan_id)  # type: ignore[return-value]

    def delete_plan(self, plan_id: str) -> bool:
        _, changed = self._db.run("DELETE FROM plans WHERE id = ?", (plan_id,))
        return changed > 0
