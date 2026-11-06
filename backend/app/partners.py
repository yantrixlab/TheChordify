"""Influencers (partners): a link of their own, who came through it, what those people paid, and what the influencer is owed.

  Partner   an influencer (or a shop, a channel...). A short name for their link, how much they earn (a percent of what their
            customers pay, for every payment or only the first months, and/or a fee paid up front) and where their link leads.
  Link      chordsuno.com/r/<slug>. Opening it counts a click, remembers the partner in a cookie (60 days) and goes on to the site.
  Credit    a person is credited to a partner once: at their first sign-in, from the cookie (or at their first purchase, if they had
            signed in before the link). The first link they opened wins; it never moves to another partner later.
  Payments  every payment Razorpay tells us about, with what was refunded. Revenue here is what was paid minus refunds, so it is real
            money, not the list price. Only rupees are added up (the same as the rest of the admin).
  Payouts   what has been paid to a partner. Owed = earned commission - paid out.

Nothing here keeps who paid: a payment holds a hash of the person's id, never their name or email, so deleting an account leaves the
books intact and without personal data.
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
import uuid
from typing import Any, Optional

from .plans import MANUAL_PREFIX

log = logging.getLogger("chordify.partners")

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,29}$")
COOKIE_DAYS = 60
_MONTH = 30.4375 * 86400

_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS partners (
        id                TEXT PRIMARY KEY,
        slug              TEXT NOT NULL UNIQUE,
        name              TEXT NOT NULL,
        handle            TEXT NOT NULL DEFAULT '',
        email             TEXT NOT NULL DEFAULT '',
        notes             TEXT NOT NULL DEFAULT '',
        landing_path      TEXT NOT NULL DEFAULT '/',
        commission_pct    DOUBLE PRECISION NOT NULL DEFAULT 0,
        commission_months INTEGER NOT NULL DEFAULT 0,
        fee_minor         INTEGER NOT NULL DEFAULT 0,
        active            INTEGER NOT NULL DEFAULT 1,
        created_at        DOUBLE PRECISION NOT NULL,
        updated_at        DOUBLE PRECISION NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS partner_clicks (
        partner_id TEXT NOT NULL,
        visitor    TEXT NOT NULL,
        at         DOUBLE PRECISION NOT NULL,
        landing    TEXT NOT NULL DEFAULT '',
        source     TEXT NOT NULL DEFAULT ''
    )
    """,
    "CREATE INDEX IF NOT EXISTS partner_clicks_p ON partner_clicks (partner_id, at)",
    """
    CREATE TABLE IF NOT EXISTS payments (
        id                       TEXT PRIMARY KEY,
        razorpay_subscription_id TEXT NOT NULL DEFAULT '',
        payer                    TEXT NOT NULL DEFAULT '',
        partner_id               TEXT NOT NULL DEFAULT '',
        amount_minor             INTEGER NOT NULL,
        currency                 TEXT NOT NULL DEFAULT 'INR',
        paid_at                  DOUBLE PRECISION NOT NULL,
        created_at               DOUBLE PRECISION NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS payments_partner ON payments (partner_id, paid_at)",
    "CREATE INDEX IF NOT EXISTS payments_payer ON payments (payer)",
    """
    CREATE TABLE IF NOT EXISTS payment_refunds (
        id           TEXT PRIMARY KEY,
        payment_id   TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        refunded_at  DOUBLE PRECISION NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS payment_refunds_pay ON payment_refunds (payment_id)",
    """
    CREATE TABLE IF NOT EXISTS partner_payouts (
        id           TEXT PRIMARY KEY,
        partner_id   TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        paid_at      DOUBLE PRECISION NOT NULL,
        note         TEXT NOT NULL DEFAULT '',
        created_at   DOUBLE PRECISION NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS partner_payouts_p ON partner_payouts (partner_id, paid_at)",
]


class PartnerError(ValueError):
    """Something about the partner could not be saved (the message is safe to show the admin)."""


def payer_key(user_id: str) -> str:
    """What a payment keeps instead of the person's id: the same person always gives the same key, and it cannot be turned back into them."""
    return hashlib.sha256(("payer:" + user_id).encode("utf-8")).hexdigest()[:24]


def _view(row: dict) -> dict:
    return {
        "id": row["id"], "slug": row["slug"], "name": row["name"], "handle": row["handle"], "email": row["email"], "notes": row["notes"],
        "landingPath": row["landing_path"], "commissionPct": float(row["commission_pct"]), "commissionMonths": int(row["commission_months"]),
        "feeMinor": int(row["fee_minor"]), "active": bool(row["active"]), "createdAt": float(row["created_at"]),
    }


def _commission(pct: float, months: int, payments: list[dict]) -> int:
    """What a partner has earned on payments (of one partner): `pct` percent of each payment's net amount, counting only the payments made
    in the first `months` months after each customer's first payment (0 months: every payment)."""
    first: dict[str, float] = {}
    for p in sorted(payments, key=lambda p: p["paid_at"]):
        first.setdefault(p["payer"], p["paid_at"])
    total = 0.0
    for p in payments:
        if months > 0 and p["paid_at"] > first[p["payer"]] + months * _MONTH:
            continue
        total += max(0, p["net"]) * pct / 100.0
    return int(round(total))


class PartnerStore:
    def __init__(self, db: Any) -> None:
        self._db = db
        for statement in _SCHEMA:
            db.run(statement)

    # ----- the partners -----------------------------------------------------------------------------------------

    def get(self, partner_id: str) -> Optional[dict]:
        rows, _ = self._db.run("SELECT * FROM partners WHERE id = ?", (partner_id,))
        return _view(rows[0]) if rows else None

    def by_slug(self, slug: str) -> Optional[dict]:
        rows, _ = self._db.run("SELECT * FROM partners WHERE slug = ?", (slug.strip().lower(),))
        return _view(rows[0]) if rows else None

    def save(self, fields: dict, partner_id: str = "") -> dict:
        """Adds a partner, or changes one. Validates everything an admin can type."""
        slug = str(fields.get("slug", "")).strip().lower().lstrip("@")
        name = str(fields.get("name", "")).strip()[:80]
        if not SLUG_RE.match(slug):
            raise PartnerError("The link name must be 2 to 30 letters, numbers or dashes, such as priya or guitar-with-raj.")
        if not name:
            raise PartnerError("Give the influencer a name.")
        landing = str(fields.get("landing_path", "/")).strip() or "/"
        if not landing.startswith("/") or landing.startswith("//") or "\\" in landing or len(landing) > 200 or any(c in landing for c in " \r\n"):
            raise PartnerError("The page the link opens must be a path on this site, such as / or /pricing/.")
        try:
            pct = float(fields.get("commission_pct", 0) or 0)
            months = int(fields.get("commission_months", 0) or 0)
            fee = int(fields.get("fee_minor", 0) or 0)
        except (TypeError, ValueError):
            raise PartnerError("The commission and the fee must be numbers.")
        if not 0 <= pct <= 100:
            raise PartnerError("The commission is a percent between 0 and 100.")
        if not 0 <= months <= 120:
            raise PartnerError("Commission months is 0 (every payment) to 120.")
        if not 0 <= fee <= 100_000_000:
            raise PartnerError("The fee is not valid.")
        clash, _ = self._db.run("SELECT id FROM partners WHERE slug = ?", (slug,))
        if clash and clash[0]["id"] != partner_id:
            raise PartnerError(f"The link name {slug} is already used by another influencer.")
        values = (
            slug, name, str(fields.get("handle", "")).strip().lstrip("@")[:60], str(fields.get("email", "")).strip()[:120],
            str(fields.get("notes", "")).strip()[:1000], landing, pct, months, fee, 1 if fields.get("active", True) else 0,
        )
        now = time.time()
        if partner_id:
            if not self.get(partner_id):
                raise PartnerError("That influencer does not exist.")
            self._db.run(
                "UPDATE partners SET slug = ?, name = ?, handle = ?, email = ?, notes = ?, landing_path = ?, commission_pct = ?, commission_months = ?, fee_minor = ?, active = ?, updated_at = ? WHERE id = ?",
                (*values, now, partner_id),
            )
            return self.get(partner_id)  # type: ignore[return-value]
        partner_id = uuid.uuid4().hex
        self._db.run(
            "INSERT INTO partners (slug, name, handle, email, notes, landing_path, commission_pct, commission_months, fee_minor, active, id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (*values, partner_id, now, now),
        )
        return self.get(partner_id)  # type: ignore[return-value]

    def delete(self, partner_id: str) -> None:
        """Removes a partner who has no history. One with clicks, sign-ups or payments is switched off instead (their numbers stay)."""
        if not self.get(partner_id):
            raise PartnerError("That influencer does not exist.")
        used = self._counts(partner_id)
        if used["clicks"] or used["signups"] or used["payments"] or used["payouts"]:
            raise PartnerError("This influencer has clicks, sign-ups or payments on record, so it cannot be deleted. Switch it off instead: the link stops crediting people and the numbers stay.")
        self._db.run("DELETE FROM partners WHERE id = ?", (partner_id,))

    def _counts(self, partner_id: str) -> dict:
        def n(sql: str) -> int:
            rows, _ = self._db.run(sql, (partner_id,))
            return int(rows[0]["n"])
        return {
            "clicks": n("SELECT COUNT(*) AS n FROM partner_clicks WHERE partner_id = ?"),
            "signups": n("SELECT COUNT(*) AS n FROM users WHERE partner_id = ?"),
            "payments": n("SELECT COUNT(*) AS n FROM payments WHERE partner_id = ?"),
            "payouts": n("SELECT COUNT(*) AS n FROM partner_payouts WHERE partner_id = ?"),
        }

    # ----- clicks and credit ------------------------------------------------------------------------------------

    def record_click(self, partner_id: str, visitor: str, landing: str, source: str = "") -> None:
        self._db.run(
            "INSERT INTO partner_clicks (partner_id, visitor, at, landing, source) VALUES (?, ?, ?, ?, ?)",
            (partner_id, visitor[:40], time.time(), landing[:200], source[:60]),
        )

    def credit_user(self, user_id: str, partner_id: str) -> bool:
        """Credits a person to a partner, once: a person who already has a partner keeps it. Payments they already made follow."""
        _, changed = self._db.run("UPDATE users SET partner_id = ?, partner_at = ? WHERE id = ? AND partner_id = ''", (partner_id, time.time(), user_id))
        if changed > 0:
            self._db.run("UPDATE payments SET partner_id = ? WHERE payer = ? AND partner_id = ''", (partner_id, payer_key(user_id)))
        return changed > 0

    def partner_of(self, user_id: str) -> str:
        rows, _ = self._db.run("SELECT partner_id FROM users WHERE id = ?", (user_id,))
        return rows[0]["partner_id"] if rows else ""

    def has_paid(self, user_id: str) -> bool:
        rows, _ = self._db.run("SELECT 1 AS x FROM payments WHERE payer = ? LIMIT 1", (payer_key(user_id),))
        return bool(rows)

    # ----- payments ---------------------------------------------------------------------------------------------

    def record_payment(self, payment_id: str, razorpay_subscription_id: str, amount_minor: int, currency: str, paid_at: float) -> bool:
        """Records a payment Razorpay took for one of our subscriptions (once: Razorpay may tell us twice). False if it is not ours or is known."""
        if not payment_id or amount_minor <= 0:
            return False
        if razorpay_subscription_id.startswith(MANUAL_PREFIX):
            return False
        rows, _ = self._db.run("SELECT user_id FROM subscriptions WHERE razorpay_subscription_id = ?", (razorpay_subscription_id,))
        if not rows:
            return False
        user_id = rows[0]["user_id"]
        _, changed = self._db.run(
            """
            INSERT INTO payments (id, razorpay_subscription_id, payer, partner_id, amount_minor, currency, paid_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            (payment_id, razorpay_subscription_id, payer_key(user_id), self.partner_of(user_id), int(amount_minor), (currency or "INR").upper(), float(paid_at), time.time()),
        )
        return changed > 0

    def record_refund(self, refund_id: str, payment_id: str, amount_minor: int, at: float = 0.0) -> bool:
        if not refund_id or not payment_id or amount_minor <= 0:
            return False
        known, _ = self._db.run("SELECT 1 AS x FROM payments WHERE id = ?", (payment_id,))
        if not known:
            return False
        _, changed = self._db.run(
            "INSERT INTO payment_refunds (id, payment_id, amount_minor, refunded_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            (refund_id, payment_id, int(amount_minor), at or time.time()),
        )
        return changed > 0

    def _payments(self, partner_id: str = "") -> list[dict]:
        """Rupee payments (of one partner, or of every partner) with what is left after refunds."""
        where, params = ("partner_id = ?", (partner_id,)) if partner_id else ("partner_id <> ?", ("",))
        rows, _ = self._db.run(
            f"SELECT id, partner_id, payer, amount_minor, paid_at FROM payments WHERE currency = 'INR' AND {where}", params
        )
        refunds, _ = self._db.run("SELECT payment_id, SUM(amount_minor) AS n FROM payment_refunds GROUP BY payment_id")
        back = {r["payment_id"]: int(r["n"]) for r in refunds}
        out = []
        for r in rows:
            amount = int(r["amount_minor"])
            refunded = min(amount, back.get(r["id"], 0))
            out.append({"id": r["id"], "partner_id": r["partner_id"], "payer": r["payer"], "amount": amount, "refunded": refunded, "net": amount - refunded, "paid_at": float(r["paid_at"])})
        return out

    # ----- payouts ----------------------------------------------------------------------------------------------

    def add_payout(self, partner_id: str, amount_minor: int, note: str = "", paid_at: float = 0.0) -> dict:
        if not self.get(partner_id):
            raise PartnerError("That influencer does not exist.")
        if not 0 < int(amount_minor) <= 100_000_000:
            raise PartnerError("The payout must be more than zero.")
        payout_id = uuid.uuid4().hex
        now = time.time()
        self._db.run(
            "INSERT INTO partner_payouts (id, partner_id, amount_minor, paid_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (payout_id, partner_id, int(amount_minor), paid_at or now, note.strip()[:200], now),
        )
        return {"id": payout_id, "amountMinor": int(amount_minor), "paidAt": paid_at or now, "note": note.strip()[:200]}

    def delete_payout(self, partner_id: str, payout_id: str) -> bool:
        _, changed = self._db.run("DELETE FROM partner_payouts WHERE id = ? AND partner_id = ?", (payout_id, partner_id))
        return changed > 0

    def payouts(self, partner_id: str) -> list[dict]:
        rows, _ = self._db.run("SELECT * FROM partner_payouts WHERE partner_id = ? ORDER BY paid_at DESC", (partner_id,))
        return [{"id": r["id"], "amountMinor": int(r["amount_minor"]), "paidAt": float(r["paid_at"]), "note": r["note"]} for r in rows]

    # ----- the numbers ------------------------------------------------------------------------------------------

    def _numbers(self, partner: dict, clicks: dict, signups: int, subscribers: int, payments: list[dict], paid_out: int) -> dict:
        gross = sum(p["amount"] for p in payments)
        refunded = sum(p["refunded"] for p in payments)
        net = gross - refunded
        customers = len({p["payer"] for p in payments if p["net"] > 0})
        earned = _commission(partner["commissionPct"], partner["commissionMonths"], payments)
        cost = partner["feeMinor"] + earned
        visitors = clicks.get("visitors", 0)
        return {
            "clicks": clicks.get("clicks", 0), "visitors": visitors, "signups": signups, "customers": customers, "subscribers": subscribers,
            "grossMinor": gross, "refundedMinor": refunded, "netMinor": net,
            "earnedMinor": earned, "paidOutMinor": paid_out, "owedMinor": earned - paid_out,
            "costMinor": cost, "profitMinor": net - cost,
            "roiPct": round((net - cost) * 100.0 / cost, 1) if cost > 0 else None,
            "signupRatePct": round(signups * 100.0 / visitors, 1) if visitors else None,
            "payRatePct": round(customers * 100.0 / signups, 1) if signups else None,
        }

    def overview(self) -> dict:
        """Every partner with their numbers, and the totals across all of them."""
        partners = [_view(r) for r in self._db.run("SELECT * FROM partners ORDER BY created_at DESC")[0]]
        clicks = {r["partner_id"]: {"clicks": int(r["clicks"]), "visitors": int(r["visitors"])} for r in self._db.run(
            "SELECT partner_id, COUNT(*) AS clicks, COUNT(DISTINCT visitor) AS visitors FROM partner_clicks GROUP BY partner_id")[0]}
        signups = {r["partner_id"]: int(r["n"]) for r in self._db.run("SELECT partner_id, COUNT(*) AS n FROM users WHERE partner_id <> '' GROUP BY partner_id")[0]}
        subs = {r["partner_id"]: int(r["n"]) for r in self._db.run(
            """
            SELECT u.partner_id AS partner_id, COUNT(*) AS n FROM subscriptions s JOIN users u ON u.id = s.user_id
            WHERE u.partner_id <> '' AND s.status IN ('active', 'pending') AND s.razorpay_subscription_id NOT LIKE ?
            GROUP BY u.partner_id
            """,
            (MANUAL_PREFIX + "%",),  # a % never goes in the SQL text itself: Postgres reads it as a placeholder
        )[0]}
        out = {r["partner_id"]: int(r["n"]) for r in self._db.run("SELECT partner_id, SUM(amount_minor) AS n FROM partner_payouts GROUP BY partner_id")[0]}
        by_partner: dict[str, list[dict]] = {}
        for p in self._payments():
            by_partner.setdefault(p["partner_id"], []).append(p)
        listed, totals = [], {k: 0 for k in ("clicks", "visitors", "signups", "customers", "subscribers", "grossMinor", "refundedMinor", "netMinor", "earnedMinor", "paidOutMinor", "owedMinor", "costMinor", "profitMinor")}
        for partner in partners:
            n = self._numbers(partner, clicks.get(partner["id"], {}), signups.get(partner["id"], 0), subs.get(partner["id"], 0), by_partner.get(partner["id"], []), out.get(partner["id"], 0))
            listed.append({**partner, **n})
            for key in totals:
                totals[key] += n[key]
        return {"partners": listed, "totals": totals}

    def detail(self, partner_id: str, days: int = 30, tz_minutes: int = 330) -> Optional[dict]:
        """One partner: the numbers, the last `days` days day by day, the people who came through them and what has been paid out."""
        partner = self.get(partner_id)
        if not partner:
            return None
        now = time.time()
        since = now - days * 86400
        offset = tz_minutes * 60

        def day(t: float) -> str:
            return time.strftime("%Y-%m-%d", time.gmtime(t + offset))

        click_rows, _ = self._db.run("SELECT visitor, at FROM partner_clicks WHERE partner_id = ?", (partner_id,))
        user_rows, _ = self._db.run("SELECT id, email, name, partner_at, plan_code FROM users WHERE partner_id = ? ORDER BY partner_at DESC", (partner_id,))
        sub_rows, _ = self._db.run(
            """
            SELECT u.id AS id FROM subscriptions s JOIN users u ON u.id = s.user_id
            WHERE u.partner_id = ? AND s.status IN ('active', 'pending') AND s.razorpay_subscription_id NOT LIKE ?
            """,
            (partner_id, MANUAL_PREFIX + "%"),
        )
        payments = self._payments(partner_id)
        paid_out = sum(p["amountMinor"] for p in self.payouts(partner_id))
        visitors = len({r["visitor"] for r in click_rows})
        numbers = self._numbers(partner, {"clicks": len(click_rows), "visitors": visitors}, len(user_rows), len(sub_rows), payments, paid_out)

        series: dict[str, dict] = {}
        for i in range(days - 1, -1, -1):
            series[day(now - i * 86400)] = {"clicks": 0, "signups": 0, "revenueMinor": 0}
        for r in click_rows:
            if r["at"] >= since and day(r["at"]) in series:
                series[day(r["at"])]["clicks"] += 1
        for r in user_rows:
            if r["partner_at"] >= since and day(r["partner_at"]) in series:
                series[day(r["partner_at"])]["signups"] += 1
        for p in payments:
            if p["paid_at"] >= since and day(p["paid_at"]) in series:
                series[day(p["paid_at"])]["revenueMinor"] += p["net"]

        by_payer: dict[str, dict] = {}
        for p in payments:
            row = by_payer.setdefault(p["payer"], {"paidMinor": 0, "payments": 0, "lastPaidAt": 0.0})
            row["paidMinor"] += p["net"]
            row["payments"] += 1
            row["lastPaidAt"] = max(row["lastPaidAt"], p["paid_at"])
        active = {r["id"] for r in sub_rows}
        customers = []
        for u in user_rows[:300]:
            paid = by_payer.get(payer_key(u["id"]), {})
            customers.append({
                "email": u["email"], "name": u["name"], "signedUpAt": float(u["partner_at"]), "plan": u["plan_code"], "subscribed": u["id"] in active,
                "paidMinor": paid.get("paidMinor", 0), "payments": paid.get("payments", 0), "lastPaidAt": paid.get("lastPaidAt") or None,
            })
        return {
            "partner": partner, "numbers": numbers, "series": [{"day": d, **v} for d, v in series.items()], "customers": customers,
            "payouts": self.payouts(partner_id),
        }
