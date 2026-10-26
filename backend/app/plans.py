"""Subscription plans, what each one includes, and who is subscribed to what.

  Plan          a tier people can be on ("Free", "Premium"): a name, a short description, a badge, how it is shown.
  Prices        a plan can be sold in several ways (monthly, yearly...). Each price is also a Razorpay plan once the admin has
                created it there, which is what a subscription is charged against.
  Features      one catalogue of everything a plan can include: switches (a feature is on or off) and limits (a number, or
                unlimited). The admin edits the catalogue and the on/off and numbers for every plan in one grid.
  Subscription  a person's paid plan, kept in step with Razorpay by its webhooks.

Everyone starts on the Free plan, with or without signing in: it is the plan whose code is `free`, it always exists and it is never
charged for. A person is on a paid plan while their subscription grants access, and drops back to Free when it does not.

Where the product checks a feature it asks for the person's *entitlements*. A feature the plan has no rule for is allowed without a
limit, so removing a row from the catalogue never locks anybody out.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Optional

log = logging.getLogger("chordify.plans")

FREE_CODE = "free"
PERIODS = ("daily", "weekly", "monthly", "quarterly", "yearly")
STATUSES = ("live", "soon")  # "soon": shown on the pricing page with a Soon tag
KINDS = ("flag", "limit")

# Months in one billing period, to compare prices ("save 20% when billed yearly") and to add up monthly income.
_MONTHS = {"daily": 1 / 30, "weekly": 12 / 52, "monthly": 1, "quarterly": 3, "yearly": 12}

# Features the product itself checks today. The rest still show on the pricing page, but switching them changes nothing in the app.
ENFORCED = {"songs_per_day", "favorites_max", "chord_detail", "chord_voicings", "transpose_capo", "upload_song", "metronome", "tuner", "practice_chords", "chord_detector", "pdf_export", "midi_export", "instruments_more"}

# (key, label, description, kind, unit, group, status)
_DEFAULT_FEATURES = [
    ("songs_per_day", "New songs chordified per day", "How many songs you can have chordified each day. Songs others have already chordified are free.", "limit", "songs", "Songs & chords", "live"),
    ("chord_detail", "Full chord detail", "7ths, suspended and slash chords on top of the simple major and minor chords.", "flag", "", "Songs & chords", "live"),
    ("chord_voicings", "Alternative chord shapes", "Switch any chord to other ways of playing it on the guitar neck.", "flag", "", "Songs & chords", "live"),
    ("transpose_capo", "Transpose and capo", "Change the key of a song and see the shapes with a capo.", "flag", "", "Songs & chords", "live"),
    ("upload_song", "Upload your own song", "Analyse an audio file from your device (MP3, WAV, FLAC and more), not only songs from YouTube.", "flag", "", "Songs & chords", "live"),
    ("instruments_more", "Ukulele chord diagrams", "Chord diagrams for the ukulele, next to the guitar's.", "flag", "", "Songs & chords", "live"),
    ("piano_diagrams", "Piano chord diagrams", "Chord diagrams for the piano.", "flag", "", "Songs & chords", "soon"),
    ("mandolin_diagrams", "Mandolin chord diagrams", "Chord diagrams for the mandolin.", "flag", "", "Songs & chords", "soon"),
    ("tempo_loop", "Slow-down and loop", "Slow a song down and loop a section while you practise.", "flag", "", "Playing", "live"),
    ("no_ads", "No ads", "Chord Suno shows no advertising.", "flag", "", "Playing", "live"),
    ("favorites_max", "Favourite songs", "How many songs you can keep as favourites.", "limit", "songs", "Library", "live"),
    ("library_history", "Play history", "Every song you play is kept so you can pick it up again.", "flag", "", "Library", "live"),
    ("xp_levels", "XP, levels and badges", "Earn XP, level up and win badges as you play.", "flag", "", "Library", "live"),
    ("pdf_export", "Chord sheet PDF", "Download a song's chords as a printable PDF.", "flag", "", "Export & tools", "live"),
    ("midi_export", "Chord MIDI files", "Download a song's chords as MIDI.", "flag", "", "Export & tools", "live"),
    ("lyrics", "Lyrics", "Read the lyrics with the chords.", "flag", "", "Export & tools", "soon"),
    ("offline_mode", "Offline mode", "Open your songs without a connection.", "flag", "", "Export & tools", "soon"),
    ("metronome", "Metronome", "Tap tempo, time signatures, subdivisions, accents and a speed trainer, in the Toolkit.", "flag", "", "Toolkit", "live"),
    ("tuner", "Tuner", "Tune guitar, bass, ukulele, violin and more with your microphone, in the Toolkit.", "flag", "", "Toolkit", "live"),
    ("practice_chords", "Practice your chords", "Chord-change drills with a metronome, a one-minute challenge, and a mode that listens and checks you.", "flag", "", "Toolkit", "live"),
    ("chord_detector", "Live chord detection", "Play your instrument and see the chord name appear as you play, in the Toolkit.", "flag", "", "Toolkit", "live"),
    ("priority_processing", "Priority processing", "Your new songs go to the front of the line.", "flag", "", "Support & teams", "soon"),
    ("priority_support", "Priority support", "Quicker answers when you need help.", "flag", "", "Support & teams", "soon"),
    ("team_seats", "Team seats", "People you can add to your plan.", "limit", "seats", "Support & teams", "soon"),
    ("api_access", "API access", "Use Chord Suno from your own tools.", "flag", "", "Support & teams", "soon"),
]

# What each starting plan includes: key -> True (on), a number (limit), None (a limit that is unlimited). Anything missing is off.
_FREE_ON = {"songs_per_day": None, "upload_song": True, "practice_chords": True, "chord_detail": True, "chord_voicings": True, "transpose_capo": True, "tempo_loop": True, "no_ads": True, "favorites_max": 25, "library_history": True, "xp_levels": True}
_PREMIUM_ON = {**_FREE_ON, "favorites_max": None, "instruments_more": True, "piano_diagrams": True, "mandolin_diagrams": True, "pdf_export": True, "midi_export": True, "lyrics": True, "tuner": True, "metronome": True, "chord_detector": True, "offline_mode": True, "priority_processing": True}
_PRO_ON = {**_PREMIUM_ON, "priority_support": True, "team_seats": 5, "api_access": True}
_DEFAULT_MATRIX = {"free": _FREE_ON, "premium": _PREMIUM_ON, "pro": _PRO_ON}

# (code, name, description, badge, cta, featured, order, monthly price in rupees)
_DEFAULT_PLANS = [
    ("free", "Free", "Everything you need to start jamming today.", "", "Get started free", False, 1, 0),
    ("premium", "Premium", "For serious players who want the full experience.", "Most popular", "Go Premium", True, 2, 249),
    ("pro", "Pro", "For teachers, creators and professional musicians.", "", "Go Pro", False, 3, 499),
]

_SCHEMA = [
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
    """
    CREATE TABLE IF NOT EXISTS plan_prices (
        id               TEXT PRIMARY KEY,
        plan_id          TEXT NOT NULL,
        period           TEXT NOT NULL DEFAULT 'monthly',
        interval_count   INTEGER NOT NULL DEFAULT 1,
        amount_minor     INTEGER NOT NULL DEFAULT 0,
        compare_at_minor INTEGER NOT NULL DEFAULT 0,
        currency         TEXT NOT NULL DEFAULT 'INR',
        razorpay_plan_id TEXT NOT NULL DEFAULT '',
        active           INTEGER NOT NULL DEFAULT 1,
        created_at       DOUBLE PRECISION NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS plan_prices_plan ON plan_prices (plan_id)",
    """
    CREATE TABLE IF NOT EXISTS features (
        key         TEXT PRIMARY KEY,
        label       TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        kind        TEXT NOT NULL DEFAULT 'flag',
        unit        TEXT NOT NULL DEFAULT '',
        grp         TEXT NOT NULL DEFAULT 'General',
        status      TEXT NOT NULL DEFAULT 'live',
        sort_order  INTEGER NOT NULL DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS plan_features (
        plan_id     TEXT NOT NULL,
        feature_key TEXT NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 0,
        value       INTEGER,
        PRIMARY KEY (plan_id, feature_key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS subscriptions (
        id                       TEXT PRIMARY KEY,
        user_id                  TEXT NOT NULL,
        plan_id                  TEXT NOT NULL,
        price_id                 TEXT NOT NULL,
        razorpay_subscription_id TEXT NOT NULL UNIQUE,
        status                   TEXT NOT NULL DEFAULT 'created',
        current_start            DOUBLE PRECISION NOT NULL DEFAULT 0,
        current_end              DOUBLE PRECISION NOT NULL DEFAULT 0,
        cancel_at_period_end     INTEGER NOT NULL DEFAULT 0,
        paid_count               INTEGER NOT NULL DEFAULT 0,
        created_at               DOUBLE PRECISION NOT NULL,
        updated_at               DOUBLE PRECISION NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions (user_id, updated_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS usage (
        user_key TEXT NOT NULL,
        day      INTEGER NOT NULL,
        name     TEXT NOT NULL,
        n        INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_key, day, name)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  DOUBLE PRECISION NOT NULL
    )
    """,
]


def _slug_ok(text: str) -> bool:
    return bool(text) and all(c.isalnum() or c in "-_" for c in text)


def grants_access(sub: dict, now: float) -> bool:
    """Whether a subscription gives its plan right now. A cancelled one still does until the period that was paid for ends."""
    status = sub["status"]
    if status in ("active", "pending"):  # "pending" is a failed renewal Razorpay is still retrying
        return True
    return status in ("cancelled", "completed", "expired") and sub["currentEnd"] > now


def months_in(period: str, interval: int) -> float:
    return _MONTHS.get(period, 1) * max(1, interval)


class PlanStore:
    def __init__(self, db: Any) -> None:
        self._db = db
        for statement in _SCHEMA:
            db.run(statement)
        try:  # a database made before prices could show a crossed-out price: add the column (it already exists in a new one)
            db.run("ALTER TABLE plan_prices ADD COLUMN compare_at_minor INTEGER NOT NULL DEFAULT 0")
        except Exception:
            pass
        self._seed()

    # ----- first-run setup ---------------------------------------------------------------------------------------

    def _flag(self, name: str) -> bool:
        rows, _ = self._db.run("SELECT value FROM settings WHERE key = ?", (name,))
        return bool(rows)

    def _set_flag(self, name: str) -> None:
        self._db.run("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING", (name, "1", time.time()))

    def _seed(self) -> None:
        rows, _ = self._db.run("SELECT COUNT(*) AS n FROM plans")
        if rows[0]["n"] == 0:
            for code, name, description, badge, cta, featured, order, monthly in _DEFAULT_PLANS:
                plan = self._insert_plan(code, name, description, badge, cta, featured, True, order)
                if monthly:
                    self._insert_price(plan, "monthly", 1, monthly * 100, "INR")
                    self._insert_price(plan, "yearly", 1, monthly * 100 * 10, "INR")  # two months free
        self._ensure_free_plan()

        # Plans made before prices had their own table carry one price in the plan row itself: move it, once.
        if not self._flag("plan_prices_moved"):
            legacy, _ = self._db.run("SELECT * FROM plans WHERE price_minor > 0")
            for row in legacy:
                has, _ = self._db.run("SELECT COUNT(*) AS n FROM plan_prices WHERE plan_id = ?", (row["id"],))
                if has[0]["n"] == 0:
                    self._insert_price(row["id"], row["period"] if row["period"] in PERIODS else "monthly", row["interval_count"], row["price_minor"], row["currency"], row["razorpay_plan_id"])
            self._set_flag("plan_prices_moved")

        have, _ = self._db.run("SELECT COUNT(*) AS n FROM features")
        if have[0]["n"] == 0:
            for order, (key, label, description, kind, unit, group, status) in enumerate(_DEFAULT_FEATURES, start=1):
                self._db.run(
                    "INSERT INTO features (key, label, description, kind, unit, grp, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (key, label, description, kind, unit, group, status, order),
                )
        self._add_new_features()
        self._toolkit_live()
        self._exports_live()
        self._ukulele_live()
        # The starting grid, for a starting plan that has no rules at all yet.
        for code, ons in _DEFAULT_MATRIX.items():
            plan, _ = self._db.run("SELECT id FROM plans WHERE code = ?", (code,))
            if not plan:
                continue
            existing, _ = self._db.run("SELECT COUNT(*) AS n FROM plan_features WHERE plan_id = ?", (plan[0]["id"],))
            if existing[0]["n"]:
                continue
            for key, *_ in _DEFAULT_FEATURES:
                if key in ons:
                    value = ons[key] if isinstance(ons[key], int) and not isinstance(ons[key], bool) else None
                    self._db.run("INSERT INTO plan_features (plan_id, feature_key, enabled, value) VALUES (?, ?, 1, ?)", (plan[0]["id"], key, value))
                else:
                    self._db.run("INSERT INTO plan_features (plan_id, feature_key, enabled, value) VALUES (?, ?, 0, NULL)", (plan[0]["id"], key))

    def _add_new_features(self) -> None:
        """Features added to the product after a database was first filled. Each is created once, and switched on for the
        plans that exist (what everybody had before it became a setting); from then on the admin decides."""
        # what each starting plan gets when the feature is first created; any other plan gets what Premium gets
        defaults = {
            "upload_song": {"free": True, "premium": True, "pro": True},
            "practice_chords": {"free": True, "premium": True, "pro": True},
            "chord_detector": {"free": False, "premium": True, "pro": True},
            "piano_diagrams": {"free": False, "premium": True, "pro": True},
            "mandolin_diagrams": {"free": False, "premium": True, "pro": True},
        }
        for key in defaults:
            exists, _ = self._db.run("SELECT key FROM features WHERE key = ?", (key,))
            if exists:
                continue
            _, label, description, kind, unit, group, status = next(f for f in _DEFAULT_FEATURES if f[0] == key)
            order = self._db.run("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM features")[0][0]["n"]
            self._db.run(
                "INSERT INTO features (key, label, description, kind, unit, grp, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (key, label, description, kind, unit, group, status, order),
            )
            for plan in self._db.run("SELECT id, code FROM plans")[0]:
                on = defaults[key].get(plan["code"], defaults[key]["premium"])
                self._db.run(
                    "INSERT INTO plan_features (plan_id, feature_key, enabled, value) VALUES (?, ?, ?, NULL) ON CONFLICT(plan_id, feature_key) DO NOTHING",
                    (plan["id"], key, 1 if on else 0),
                )

    def _toolkit_live(self) -> None:
        """The metronome and the tuner used to be listed as coming soon. Now they are built, once: move them into the Toolkit
        group and mark them live. Whatever plans the admin gave them stays as it is."""
        if self._flag("toolkit_live"):
            return
        for key in ("metronome", "tuner"):
            _, label, description, kind, unit, group, status = next(f for f in _DEFAULT_FEATURES if f[0] == key)
            self._db.run("UPDATE features SET description = ?, grp = ?, status = ? WHERE key = ?", (description, group, status, key))
        self._set_flag("toolkit_live")

    def _exports_live(self) -> None:
        """The chord sheet PDF and the MIDI download are built, so they stop being listed as coming soon (once). Whatever plans
        the admin gave them stays as it is."""
        if self._flag("exports_live"):
            return
        self._db.run("UPDATE features SET status = 'live' WHERE key IN ('pdf_export', 'midi_export')")
        self._set_flag("exports_live")

    def _ukulele_live(self) -> None:
        """The ukulele diagrams are built, so the old "piano, ukulele and mandolin" feature becomes the ukulele's alone (once); piano
        and mandolin get features of their own, still coming soon. Whatever plans the admin gave it stays as it is."""
        if self._flag("ukulele_live"):
            return
        _, label, description, _, _, group, status = next(f for f in _DEFAULT_FEATURES if f[0] == "instruments_more")
        self._db.run("UPDATE features SET label = ?, description = ?, grp = ?, status = ? WHERE key = 'instruments_more'", (label, description, group, status))
        self._set_flag("ukulele_live")

    def _ensure_free_plan(self) -> None:
        rows, _ = self._db.run("SELECT id FROM plans WHERE code = ?", (FREE_CODE,))
        if not rows:
            self._insert_plan(FREE_CODE, "Free", "Everything you need to start jamming today.", "", "Get started free", False, True, 0)

    def _insert_plan(self, code: str, name: str, description: str, badge: str, cta: str, featured: bool, active: bool, order: int) -> str:
        plan_id, now = uuid.uuid4().hex, time.time()
        self._db.run(
            """
            INSERT INTO plans (id, code, name, description, badge, cta, featured, active, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (plan_id, code, name, description, badge, cta, 1 if featured else 0, 1 if active else 0, order, now, now),
        )
        return plan_id

    def _insert_price(self, plan_id: str, period: str, interval: int, amount: int, currency: str, razorpay_id: str = "", compare_at: int = 0) -> str:
        price_id = uuid.uuid4().hex
        self._db.run(
            "INSERT INTO plan_prices (id, plan_id, period, interval_count, amount_minor, compare_at_minor, currency, razorpay_plan_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
            (price_id, plan_id, period, max(1, interval), int(amount), int(compare_at), currency.upper(), razorpay_id, time.time()),
        )
        return price_id

    # ----- reading -----------------------------------------------------------------------------------------------

    @staticmethod
    def _price(row: dict) -> dict:
        return {
            "id": row["id"], "planId": row["plan_id"], "period": row["period"], "intervalCount": row["interval_count"],
            "amountMinor": row["amount_minor"], "compareAtMinor": row["compare_at_minor"], "currency": row["currency"],
            "razorpayPlanId": row["razorpay_plan_id"], "active": bool(row["active"]),
        }

    def list_features(self) -> list[dict]:
        rows, _ = self._db.run("SELECT * FROM features ORDER BY sort_order ASC, key ASC")
        return [
            {"key": r["key"], "label": r["label"], "description": r["description"], "kind": r["kind"], "unit": r["unit"], "group": r["grp"],
             "status": r["status"], "sortOrder": r["sort_order"], "enforced": r["key"] in ENFORCED}
            for r in rows
        ]

    def list_plans(self, only_active: bool = False) -> list[dict]:
        where = "WHERE active = 1" if only_active else ""
        plans, _ = self._db.run(f"SELECT * FROM plans {where} ORDER BY sort_order ASC, created_at ASC")
        prices, _ = self._db.run("SELECT * FROM plan_prices ORDER BY amount_minor ASC, created_at ASC")
        matrix, _ = self._db.run("SELECT * FROM plan_features")
        prices_by: dict[str, list] = {}
        for p in prices:
            prices_by.setdefault(p["plan_id"], []).append(self._price(p))
        rules_by: dict[str, dict] = {}
        for m in matrix:
            rules_by.setdefault(m["plan_id"], {})[m["feature_key"]] = {"enabled": bool(m["enabled"]), "value": m["value"]}
        return [
            {
                "id": p["id"], "code": p["code"], "name": p["name"], "description": p["description"], "badge": p["badge"], "cta": p["cta"],
                "featured": bool(p["featured"]), "active": bool(p["active"]), "sortOrder": p["sort_order"], "isFree": p["code"] == FREE_CODE,
                "prices": prices_by.get(p["id"], []), "entitlements": rules_by.get(p["id"], {}),
            }
            for p in plans
        ]

    def get_plan(self, plan_id: str) -> Optional[dict]:
        return next((p for p in self.list_plans() if p["id"] == plan_id), None)

    def free_plan(self) -> dict:
        return next(p for p in self.list_plans() if p["code"] == FREE_CODE)

    def get_price(self, price_id: str) -> Optional[dict]:
        rows, _ = self._db.run("SELECT * FROM plan_prices WHERE id = ?", (price_id,))
        return self._price(rows[0]) if rows else None

    def pricing(self) -> dict:
        """What the public pricing page shows: plans that are on sale, with their live prices, and the feature catalogue."""
        plans = []
        for plan in self.list_plans(only_active=True):
            prices = [p for p in plan["prices"] if p["active"]]
            if plan["isFree"] or prices:
                plans.append({**plan, "prices": [] if plan["isFree"] else prices})
        return {"plans": plans, "features": self.list_features()}

    # ----- plans -------------------------------------------------------------------------------------------------

    def save_plan(self, data: dict, plan_id: Optional[str] = None) -> dict:
        """The details of a plan (not its prices or features). Raises ValueError for a mistake worth telling the admin."""
        existing = self.get_plan(plan_id) if plan_id else None
        if plan_id and existing is None:
            raise LookupError("That plan does not exist.")
        code = str(data.get("code", "")).strip().lower()
        name = str(data.get("name", "")).strip()
        if not name:
            raise ValueError("A plan needs a name.")
        if not _slug_ok(code):
            raise ValueError("The plan code can only use letters, numbers, - and _.")
        if existing and existing["isFree"] and code != FREE_CODE:
            raise ValueError("The Free plan keeps the code “free”: it is the plan everybody starts on.")
        if existing and existing["isFree"] and data.get("active") is False:
            raise ValueError("The Free plan cannot be switched off: everybody starts on it.")
        clash, _ = self._db.run("SELECT id FROM plans WHERE code = ?", (code,))
        if clash and clash[0]["id"] != plan_id:
            raise ValueError(f"There is already a plan with the code “{code}”.")
        fields = (
            code, name, str(data.get("description", "")).strip()[:200], str(data.get("badge", "")).strip()[:30], str(data.get("cta", "")).strip()[:40],
            1 if data.get("featured") else 0, 0 if data.get("active") is False else 1, int(data.get("sort_order", 0) or 0),
        )
        now = time.time()
        if plan_id is None:
            plan_id = uuid.uuid4().hex
            self._db.run(
                "INSERT INTO plans (code, name, description, badge, cta, featured, active, sort_order, id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (*fields, plan_id, now, now),
            )
        else:
            self._db.run(
                "UPDATE plans SET code = ?, name = ?, description = ?, badge = ?, cta = ?, featured = ?, active = ?, sort_order = ?, updated_at = ? WHERE id = ?",
                (*fields, now, plan_id),
            )
        return self.get_plan(plan_id)  # type: ignore[return-value]

    def delete_plan(self, plan_id: str) -> None:
        plan = self.get_plan(plan_id)
        if plan is None:
            raise LookupError("That plan does not exist.")
        if plan["isFree"]:
            raise ValueError("The Free plan cannot be deleted: everybody starts on it.")
        subs, _ = self._db.run("SELECT COUNT(*) AS n FROM subscriptions WHERE plan_id = ?", (plan_id,))
        if subs[0]["n"]:
            raise ValueError("People have subscribed to this plan. Switch it off instead, so they keep what they paid for.")
        self._db.run("DELETE FROM plan_features WHERE plan_id = ?", (plan_id,))
        self._db.run("DELETE FROM plan_prices WHERE plan_id = ?", (plan_id,))
        self._db.run("DELETE FROM plans WHERE id = ?", (plan_id,))

    # ----- prices ------------------------------------------------------------------------------------------------

    def save_price(self, plan_id: str, data: dict, price_id: Optional[str] = None) -> dict:
        plan = self.get_plan(plan_id)
        if plan is None:
            raise LookupError("That plan does not exist.")
        if plan["isFree"]:
            raise ValueError("The Free plan is never charged for, so it has no prices.")
        period = data.get("period", "monthly")
        if period not in PERIODS:
            raise ValueError(f"The period must be one of: {', '.join(PERIODS)}.")
        amount = int(data.get("amount_minor", 0) or 0)
        if amount <= 0:
            raise ValueError("A price must be more than zero.")
        interval = max(1, int(data.get("interval_count", 1) or 1))
        currency = str(data.get("currency", "INR")).strip().upper()
        if len(currency) != 3 or not currency.isalpha():
            raise ValueError("The currency must be a three-letter code such as INR.")
        compare_at = int(data.get("compare_at_minor", 0) or 0)
        if compare_at < 0 or (compare_at and compare_at <= amount):
            raise ValueError("The original price is shown crossed out next to the price, so it must be higher than the price (or empty).")
        razorpay_id = str(data.get("razorpay_plan_id", "")).strip()[:60]
        if price_id is None:
            price_id = self._insert_price(plan_id, period, interval, amount, currency, razorpay_id, compare_at)
        else:
            old = self.get_price(price_id)
            if old is None or old["planId"] != plan_id:
                raise LookupError("That price does not exist.")
            # A Razorpay plan cannot change: if what is charged changed, the old Razorpay plan no longer matches it.
            changed = (old["period"], old["intervalCount"], old["amountMinor"], old["currency"]) != (period, interval, amount, currency)
            if changed and razorpay_id == old["razorpayPlanId"]:
                razorpay_id = ""
            self._db.run(
                "UPDATE plan_prices SET period = ?, interval_count = ?, amount_minor = ?, compare_at_minor = ?, currency = ?, razorpay_plan_id = ?, active = ? WHERE id = ?",
                (period, interval, amount, compare_at, currency, razorpay_id, 0 if data.get("active") is False else 1, price_id),
            )
        return self.get_price(price_id)  # type: ignore[return-value]

    def set_price_razorpay(self, price_id: str, razorpay_plan_id: str) -> None:
        self._db.run("UPDATE plan_prices SET razorpay_plan_id = ? WHERE id = ?", (razorpay_plan_id, price_id))

    def delete_price(self, price_id: str) -> None:
        subs, _ = self._db.run("SELECT COUNT(*) AS n FROM subscriptions WHERE price_id = ?", (price_id,))
        if subs[0]["n"]:
            self._db.run("UPDATE plan_prices SET active = 0 WHERE id = ?", (price_id,))
            raise ValueError("People have subscribed at this price, so it was switched off instead of deleted.")
        self._db.run("DELETE FROM plan_prices WHERE id = ?", (price_id,))

    # ----- the catalogue of features -----------------------------------------------------------------------------

    def save_feature(self, data: dict, key: Optional[str] = None) -> dict:
        new_key = str(data.get("key", key or "")).strip().lower()
        label = str(data.get("label", "")).strip()[:80]
        if not label:
            raise ValueError("A feature needs a name.")
        if not _slug_ok(new_key):
            raise ValueError("The feature key can only use letters, numbers, - and _.")
        kind = data.get("kind", "flag")
        status = data.get("status", "live")
        if kind not in KINDS or status not in STATUSES:
            raise ValueError("That kind or status is not one of the choices.")
        if key is not None and new_key != key:
            raise ValueError("A feature's key cannot change once it exists: the product and the plans refer to it.")
        exists, _ = self._db.run("SELECT key FROM features WHERE key = ?", (new_key,))
        if key is None and exists:
            raise ValueError(f"There is already a feature with the key “{new_key}”.")
        if key is not None and not exists:
            raise LookupError("That feature does not exist.")
        values = (label, str(data.get("description", "")).strip()[:200], kind, str(data.get("unit", "")).strip()[:20],
                  str(data.get("group", "General")).strip()[:40] or "General", status, int(data.get("sort_order", 0) or 0))
        if key is None:
            order = values[-1] or (self._db.run("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM features")[0][0]["n"])
            self._db.run(
                "INSERT INTO features (label, description, kind, unit, grp, status, sort_order, key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (*values[:-1], order, new_key),
            )
        else:
            self._db.run(
                "UPDATE features SET label = ?, description = ?, kind = ?, unit = ?, grp = ?, status = ?, sort_order = ? WHERE key = ?",
                (*values, new_key),
            )
        return next(f for f in self.list_features() if f["key"] == new_key)

    def delete_feature(self, key: str) -> None:
        if key in ENFORCED:
            raise ValueError("The product checks this feature itself, so it cannot be deleted. Switch it off for the plans that should not have it.")
        self._db.run("DELETE FROM plan_features WHERE feature_key = ?", (key,))
        self._db.run("DELETE FROM features WHERE key = ?", (key,))

    def set_plan_feature(self, plan_id: str, key: str, enabled: bool, value: Optional[int]) -> dict:
        if self.get_plan(plan_id) is None:
            raise LookupError("That plan does not exist.")
        feature = next((f for f in self.list_features() if f["key"] == key), None)
        if feature is None:
            raise LookupError("That feature does not exist.")
        if feature["kind"] == "flag":
            value = None
        elif value is not None:
            if int(value) < 0:
                raise ValueError("A limit cannot be negative.")
            value = int(value)
        self._db.run(
            """
            INSERT INTO plan_features (plan_id, feature_key, enabled, value) VALUES (?, ?, ?, ?)
            ON CONFLICT(plan_id, feature_key) DO UPDATE SET enabled = excluded.enabled, value = excluded.value
            """,
            (plan_id, key, 1 if enabled else 0, value),
        )
        return {"enabled": bool(enabled), "value": value}

    # ----- what a person gets ------------------------------------------------------------------------------------

    @staticmethod
    def allowed(plan: dict, key: str) -> bool:
        """Whether the plan includes a feature. A feature the plan has no rule for is not restricted."""
        rule = plan["entitlements"].get(key)
        return True if rule is None else bool(rule["enabled"])

    @staticmethod
    def limit(plan: dict, key: str) -> Optional[int]:
        """The most the plan allows: None for no limit, 0 when it is not included."""
        rule = plan["entitlements"].get(key)
        if rule is None:
            return None
        return None if (rule["enabled"] and rule["value"] is None) else (rule["value"] if rule["enabled"] else 0)

    def effective(self, user_id: Optional[str]) -> tuple[dict, Optional[dict]]:
        """The plan a person is on, and the subscription behind it: Free unless a paid subscription grants access."""
        plans = {p["id"]: p for p in self.list_plans()}
        free = next(p for p in plans.values() if p["code"] == FREE_CODE)
        if not user_id:
            return free, None
        now = time.time()
        rows, _ = self._db.run("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC", (user_id,))
        for row in rows:
            sub = self._sub(row)
            if grants_access(sub, now) and row["plan_id"] in plans:
                return plans[row["plan_id"]], sub
        return free, None

    # ----- subscriptions -----------------------------------------------------------------------------------------

    @staticmethod
    def _sub(row: dict) -> dict:
        return {
            "id": row["id"], "userId": row["user_id"], "planId": row["plan_id"], "priceId": row["price_id"],
            "razorpaySubscriptionId": row["razorpay_subscription_id"], "status": row["status"], "currentStart": row["current_start"],
            "currentEnd": row["current_end"], "cancelAtPeriodEnd": bool(row["cancel_at_period_end"]), "paidCount": row["paid_count"],
            "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }

    def create_subscription(self, user_id: str, plan_id: str, price_id: str, razorpay_id: str, status: str = "created") -> dict:
        sub_id, now = uuid.uuid4().hex, time.time()
        self._db.run(
            """
            INSERT INTO subscriptions (id, user_id, plan_id, price_id, razorpay_subscription_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (sub_id, user_id, plan_id, price_id, razorpay_id, status, now, now),
        )
        return self.subscription_by_razorpay(razorpay_id)  # type: ignore[return-value]

    def subscription_by_razorpay(self, razorpay_id: str) -> Optional[dict]:
        rows, _ = self._db.run("SELECT * FROM subscriptions WHERE razorpay_subscription_id = ?", (razorpay_id,))
        return self._sub(rows[0]) if rows else None

    def apply_razorpay(self, entity: dict, user_id: str = "") -> Optional[dict]:
        """Brings our record of a subscription in line with what Razorpay says (from a webhook, or after a payment)."""
        sub = self.subscription_by_razorpay(entity["id"])
        notes = entity.get("notes") or {}
        if sub is None:  # a webhook for a subscription we have no row for: rebuild it from the notes we attached
            user_id = user_id or str(notes.get("user_id", ""))
            price = self.get_price(str(notes.get("price_id", ""))) if notes.get("price_id") else None
            if not user_id or price is None:
                log.warning("Razorpay subscription %s is unknown and has no notes to rebuild it from", entity["id"])
                return None
            sub = self.create_subscription(user_id, price["planId"], price["id"], entity["id"], entity.get("status", "created"))
        status = entity.get("status") or sub["status"]
        cancel = sub["cancelAtPeriodEnd"]
        if "has_scheduled_changes" in entity and status in ("active", "pending", "authenticated"):
            cancel = bool(entity["has_scheduled_changes"])
        self._db.run(
            "UPDATE subscriptions SET status = ?, current_start = ?, current_end = ?, paid_count = ?, cancel_at_period_end = ?, updated_at = ? WHERE id = ?",
            (status, float(entity.get("current_start") or sub["currentStart"]), float(entity.get("current_end") or sub["currentEnd"]),
             int(entity.get("paid_count") or sub["paidCount"]), 1 if cancel else 0, time.time(), sub["id"]),
        )
        self.sync_user_plan(sub["userId"])
        return self.subscription_by_razorpay(entity["id"])

    def mark_cancelling(self, razorpay_id: str) -> None:
        self._db.run("UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE razorpay_subscription_id = ?", (time.time(), razorpay_id))

    def sync_user_plan(self, user_id: str) -> None:
        """Keeps the plan code on the person's account in step (the admin's Users list reads it)."""
        plan, _ = self.effective(user_id)
        self._db.run("UPDATE users SET plan_code = ? WHERE id = ?", (plan["code"], user_id))

    def list_subscriptions(self, limit: int = 25, offset: int = 0) -> tuple[list[dict], int]:
        total, _ = self._db.run("SELECT COUNT(*) AS n FROM subscriptions")
        rows, _ = self._db.run(
            """
            SELECT s.*, u.email AS email, u.name AS user_name, p.name AS plan_name,
                   pr.period AS period, pr.interval_count AS interval_count, pr.amount_minor AS amount_minor, pr.currency AS currency
            FROM subscriptions s
            LEFT JOIN users u ON u.id = s.user_id
            LEFT JOIN plans p ON p.id = s.plan_id
            LEFT JOIN plan_prices pr ON pr.id = s.price_id
            ORDER BY s.updated_at DESC LIMIT ? OFFSET ?
            """,
            (limit, offset),
        )
        out = []
        for r in rows:
            out.append({
                **self._sub(r), "email": r["email"] or "", "name": r["user_name"] or "", "planName": r["plan_name"] or "",
                "period": r["period"], "intervalCount": r["interval_count"], "amountMinor": r["amount_minor"], "currency": r["currency"],
                "grantsAccess": grants_access(self._sub(r), time.time()),
            })
        return out, total[0]["n"]

    def revenue(self) -> dict:
        """Active subscriptions and what they bring in each month (rupees only, since the totals are not converted)."""
        rows, _ = self._db.run(
            """
            SELECT s.status AS status, s.current_end AS current_end, pr.period AS period, pr.interval_count AS interval_count,
                   pr.amount_minor AS amount_minor, pr.currency AS currency
            FROM subscriptions s JOIN plan_prices pr ON pr.id = s.price_id
            """
        )
        now, active, monthly = time.time(), 0, 0.0
        for r in rows:
            if grants_access({"status": r["status"], "currentEnd": r["current_end"]}, now) and r["status"] in ("active", "pending"):
                active += 1
                if r["currency"] == "INR":
                    monthly += r["amount_minor"] / months_in(r["period"], r["interval_count"])
        return {"active": active, "monthlyMinor": int(round(monthly))}

    # ----- daily use, for limits ---------------------------------------------------------------------------------

    def usage(self, user_key: str, day: int, name: str) -> int:
        rows, _ = self._db.run("SELECT n FROM usage WHERE user_key = ? AND day = ? AND name = ?", (user_key, day, name))
        return rows[0]["n"] if rows else 0

    def delete_usage(self, user_key: str) -> None:
        """Forgets the day-by-day counts kept for a person (new songs per day)."""
        self._db.run("DELETE FROM usage WHERE user_key = ?", (user_key,))

    def add_usage(self, user_key: str, day: int, name: str, amount: int = 1) -> None:
        self._db.run(
            """
            INSERT INTO usage (user_key, day, name, n) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_key, day, name) DO UPDATE SET n = usage.n + excluded.n
            """,
            (user_key, day, name, amount),
        )
        self._db.run("DELETE FROM usage WHERE day < ?", (day - 3,))  # the days before yesterday are no use to anybody
