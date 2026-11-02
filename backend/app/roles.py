"""Who may do what in the admin: roles, the permissions each role has, and passwords for staff accounts.

A person has one role (users.role). There are three built-in roles and any number the admin makes:

  admin    every permission, always (new permissions are included automatically); cannot be edited
  editor   a starting set the admin can change freely
  user     the people who sign up on the website: no admin access at all; cannot be edited
  ...      custom roles the admin creates ("support", "finance"), each with exactly the permissions ticked

A permission is one thing a person can do in the admin ("see the people list", "edit plans and prices"). Granting "x.manage" also
grants "x.view". Staff (anybody whose role has at least one permission) can sign in to the admin with an email and a password as well
as with Google; general users cannot, whatever the database holds.

Accounts named in ADMIN_EMAILS, and the ADMIN_TOKEN, are administrators whatever the database says, so the owner can never be locked out.

Same database and `run` interface as the rest (Postgres or SQLite), so the SQL is written for both.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from typing import Any, Iterable, Optional

# ---------------------------------------------------------------------------------------------------------------------
# The permissions: (key, label, what it lets somebody do). Grouped for the screen that ticks them.
# ---------------------------------------------------------------------------------------------------------------------

PERMISSION_GROUPS: list[dict] = [
    {"group": "Overview", "items": [
        ("overview.view", "See the overview", "The dashboard: people, songs, the queue, payments and sign-in status."),
    ]},
    {"group": "People", "items": [
        ("users.view", "See the people list", "Names, emails, plans, levels and sign-in dates."),
        ("users.block", "Block and unblock people", "A blocked person is signed out at once and cannot sign in."),
        ("users.create", "Create accounts and set passwords", "Make staff accounts with an email and password; reset a password."),
        ("users.roles", "Change a person's role", "Only to roles that have no more power than your own."),
    ]},
    {"group": "Roles", "items": [
        ("roles.manage", "Manage roles and permissions", "Create roles and choose what each can do (never more than your own role can)."),
    ]},
    {"group": "Money", "items": [
        ("plans.view", "See subscription plans", "Plans, prices and the payment set-up."),
        ("plans.manage", "Edit plans and prices", "Create, change and delete plans and prices; connect them to Razorpay."),
        ("subscriptions.view", "See subscriptions and revenue", "Who is subscribed, and what has been paid."),
    ]},
    {"group": "Product", "items": [
        ("features.view", "See features and limits", "What each plan includes."),
        ("features.manage", "Edit features and limits", "Add features and decide which plan gets what."),
        ("rewards.view", "See the rewards set-up", "XP, levels, badges and rewards."),
        ("rewards.manage", "Edit the rewards set-up", "Change what earns XP and what each level gives."),
    ]},
    {"group": "Content", "items": [
        ("ratings.view", "See ratings and comments", "What people said about songs' chords."),
        ("song_pages.manage", "Manage song pages", "Publish and unpublish the pages that search engines see."),
    ]},
    {"group": "Server", "items": [
        ("youtube.manage", "Manage YouTube accounts", "The accounts the server downloads with, and the download test."),
    ]},
]

PERMISSIONS: list[str] = [item[0] for group in PERMISSION_GROUPS for item in group["items"]]
_KNOWN = set(PERMISSIONS)

# What the built-in editor starts with (the admin can change it).
DEFAULT_EDITOR = ["overview.view", "users.view", "ratings.view", "song_pages.manage"]

BUILTIN = ("admin", "editor", "user")
_KEY = re.compile(r"^[a-z][a-z0-9_-]{1,31}$")


def catalog() -> list[dict]:
    """The permissions as the screen wants them: [{group, items: [{key, label, hint}]}]."""
    return [{"group": g["group"], "items": [{"key": k, "label": label, "hint": hint} for k, label, hint in g["items"]]} for g in PERMISSION_GROUPS]


def clean(permissions: Iterable[str]) -> list[str]:
    """Only real permissions, each once, in catalog order; a "manage" brings its "view"."""
    wanted = set(permissions) & _KNOWN
    for key in list(wanted):
        if key.endswith(".manage") and key[:-7] + ".view" in _KNOWN:
            wanted.add(key[:-7] + ".view")
    return [p for p in PERMISSIONS if p in wanted]


def allows(held: Iterable[str], needed: str) -> bool:
    """Whether a set of permissions covers `needed` ("x.manage" covers "x.view")."""
    held = held if isinstance(held, (set, frozenset)) else set(held)
    if needed in held:
        return True
    return needed.endswith(".view") and needed[:-5] + ".manage" in held


def covers(held: Iterable[str], wanted: Iterable[str]) -> bool:
    """Whether `held` has every permission in `wanted` (the rule that nobody can hand out more than they have)."""
    held = set(held)
    return all(allows(held, p) for p in wanted)


# ---------------------------------------------------------------------------------------------------------------------
# Passwords: scrypt with a random salt per password; only the hash is stored.
# ---------------------------------------------------------------------------------------------------------------------

_SCRYPT = (2**14, 8, 1)
MIN_PASSWORD = 10
MAX_PASSWORD = 200


def check_password_rules(password: str, email: str = "") -> Optional[str]:
    """None when the password is acceptable, else a sentence saying what is wrong."""
    if len(password) < MIN_PASSWORD:
        return f"The password needs at least {MIN_PASSWORD} characters."
    if len(password) > MAX_PASSWORD:
        return f"The password can have at most {MAX_PASSWORD} characters."
    if email and password.strip().lower() in (email.lower(), email.split("@")[0].lower()):
        return "The password must not be the email address."
    if len(set(password)) < 4:
        return "That password is too simple. Use a mix of different characters."
    return None


def hash_password(password: str) -> str:
    n, r, p = _SCRYPT
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=32)
    return "scrypt${}${}${}${}${}".format(n, r, p, base64.b64encode(salt).decode(), base64.b64encode(digest).decode())


def verify_password(password: str, stored: str) -> bool:
    """True when `password` matches `stored`. Takes the same time whether or not it does (and whether or not `stored` is valid)."""
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            raise ValueError
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except Exception:
        hashlib.scrypt(password.encode("utf-8"), salt=b"0" * 16, n=_SCRYPT[0], r=_SCRYPT[1], p=_SCRYPT[2], dklen=32)  # keep the time the same
        return False


# ---------------------------------------------------------------------------------------------------------------------
# The roles
# ---------------------------------------------------------------------------------------------------------------------

_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS roles (
        key         TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        permissions TEXT NOT NULL DEFAULT '[]',
        builtin     INTEGER NOT NULL DEFAULT 0,
        created_at  DOUBLE PRECISION NOT NULL,
        updated_at  DOUBLE PRECISION NOT NULL
    )
    """,
]


class RoleError(ValueError):
    """Something about a role cannot be done (the message is safe to show)."""


def _role(row: dict) -> dict:
    key = row["key"]
    if key == "admin":
        perms = list(PERMISSIONS)
    elif key == "user":
        perms = []
    else:
        try:
            perms = clean(json.loads(row["permissions"] or "[]"))
        except ValueError:
            perms = []
    return {
        "key": key,
        "name": row["name"],
        "description": row["description"],
        "permissions": perms,
        "builtin": bool(row["builtin"]),
        "locked": key in ("admin", "user"),  # the admin always has everything; the general user never has anything
    }


class RoleStore:
    def __init__(self, db: Any) -> None:
        self._db = db
        for statement in _SCHEMA:
            db.run(statement)
        now = time.time()
        for key, name, description, perms in (
            ("admin", "Admin", "Everything in the admin, always.", []),
            ("editor", "Editor", "Looks after content. The admin chooses what an editor can do.", DEFAULT_EDITOR),
            ("user", "General user", "People who sign up on the website. No admin access.", []),
        ):
            db.run(
                "INSERT INTO roles (key, name, description, permissions, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?) "
                "ON CONFLICT(key) DO NOTHING",
                (key, name, description, json.dumps(perms), now, now),
            )

    def list(self) -> list[dict]:
        rows, _ = self._db.run("SELECT * FROM roles")
        roles = [_role(r) for r in rows]
        order = {"admin": 0, "editor": 1, "user": 9}
        roles.sort(key=lambda r: (order.get(r["key"], 5), r["name"].lower()))
        return roles

    def get(self, key: str) -> Optional[dict]:
        rows, _ = self._db.run("SELECT * FROM roles WHERE key = ?", (key,))
        return _role(rows[0]) if rows else None

    def permissions(self, key: str) -> list[str]:
        """What a role may do ([] for an unknown role, so a deleted role grants nothing)."""
        role = self.get(key or "user")
        return role["permissions"] if role else []

    def create(self, name: str, description: str, permissions: Iterable[str], key: str = "") -> dict:
        name = name.strip()
        if not 2 <= len(name) <= 40:
            raise RoleError("Give the role a name of 2 to 40 characters.")
        key = (key or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"))[:32]
        if not _KEY.match(key):
            raise RoleError("The role's name must start with a letter.")
        if key in BUILTIN or self.get(key):
            raise RoleError("There is already a role with that name.")
        now = time.time()
        self._db.run(
            "INSERT INTO roles (key, name, description, permissions, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
            (key, name, description.strip()[:200], json.dumps(clean(permissions)), now, now),
        )
        return self.get(key)  # type: ignore[return-value]

    def update(self, key: str, name: Optional[str], description: Optional[str], permissions: Optional[Iterable[str]]) -> dict:
        role = self.get(key)
        if not role:
            raise RoleError("No such role.")
        if role["locked"]:
            raise RoleError("The Admin role always has everything and the General user role never has anything, so neither can be changed.")
        new_name = role["name"] if name is None else name.strip()
        if not 2 <= len(new_name) <= 40:
            raise RoleError("Give the role a name of 2 to 40 characters.")
        self._db.run(
            "UPDATE roles SET name = ?, description = ?, permissions = ?, updated_at = ? WHERE key = ?",
            (
                new_name,
                role["description"] if description is None else description.strip()[:200],
                json.dumps(role["permissions"] if permissions is None else clean(permissions)),
                time.time(),
                key,
            ),
        )
        return self.get(key)  # type: ignore[return-value]

    def delete(self, key: str) -> None:
        role = self.get(key)
        if not role:
            raise RoleError("No such role.")
        if role["builtin"]:
            raise RoleError("The built-in roles cannot be deleted.")
        self._db.run("DELETE FROM roles WHERE key = ?", (key,))
