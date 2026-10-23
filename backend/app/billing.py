"""Taking payments with Razorpay Subscriptions.

The flow, end to end:
  1. The admin creates each paid price on Razorpay as a Razorpay "plan" (a button on the Plans page does it through the API).
  2. A signed-in person presses "Get <plan>". The server creates a Razorpay *subscription* for that plan and the person's account,
     and hands the subscription id to the browser, which opens Razorpay's checkout window.
  3. After paying, the browser sends back the payment id, subscription id and a signature. `verify_payment` checks the signature
     with the key secret, so a person cannot claim a payment that did not happen.
  4. From then on Razorpay tells the server what happens (renewals, failures, cancellations) by webhook; `verify_webhook` checks
     each one with the webhook secret.

Nothing here ever stores card details: those go to Razorpay only. Settings come from the environment:
  RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET        the API keys (rzp_test_... for trying it, rzp_live_... for real money)
  RAZORPAY_WEBHOOK_SECRET                     the secret typed in when the webhook is added in the Razorpay dashboard
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
from typing import Any, Optional

import requests

log = logging.getLogger("chordify.billing")

API = "https://api.razorpay.com/v1"

# How many billing cycles to ask for when starting a subscription. Razorpay needs a number; these keep a subscription running
# for a long time (it can be cancelled any time, and Razorpay stops charging when the last cycle is reached).
_CYCLES = {"daily": 1000, "weekly": 520, "monthly": 120, "quarterly": 40, "yearly": 10}


class RazorpayError(Exception):
    """Razorpay refused or could not be reached. The message is safe to show the admin (never contains a secret)."""


def razorpay_period(period: str, interval: int) -> tuple[str, int]:
    """Razorpay knows daily, weekly, monthly and yearly; a quarter is three months."""
    if period == "quarterly":
        return "monthly", 3 * interval
    return period, interval


def cycles_for(period: str) -> int:
    return _CYCLES.get(period, 12)


class Razorpay:
    def __init__(self, key_id: str = "", key_secret: str = "", webhook_secret: str = "") -> None:
        self.key_id = key_id.strip()
        self._secret = key_secret.strip()
        self._webhook_secret = webhook_secret.strip()

    @classmethod
    def from_env(cls) -> "Razorpay":
        return cls(os.environ.get("RAZORPAY_KEY_ID", ""), os.environ.get("RAZORPAY_KEY_SECRET", ""), os.environ.get("RAZORPAY_WEBHOOK_SECRET", ""))

    @property
    def configured(self) -> bool:
        return bool(self.key_id and self._secret)

    @property
    def mode(self) -> str:
        return "test" if self.key_id.startswith("rzp_test_") else "live" if self.key_id.startswith("rzp_live_") else ""

    def status(self) -> dict:
        return {"configured": self.configured, "mode": self.mode, "webhookSecretSet": bool(self._webhook_secret)}

    # ---- API calls -----------------------------------------------------------------------------------------------

    def _call(self, method: str, path: str, body: Optional[dict] = None) -> dict:
        if not self.configured:
            raise RazorpayError("Razorpay is not set up on the server (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET).")
        try:
            res = requests.request(method, f"{API}{path}", json=body, auth=(self.key_id, self._secret), timeout=20)
        except requests.RequestException as exc:
            log.warning("Razorpay could not be reached: %s", exc)
            raise RazorpayError("Could not reach Razorpay. Please try again in a moment.") from exc
        try:
            data = res.json()
        except ValueError:
            data = {}
        if res.status_code >= 400:
            message = ((data.get("error") or {}).get("description") if isinstance(data, dict) else "") or f"Razorpay answered with an error ({res.status_code})."
            log.warning("Razorpay %s %s failed (%s): %s", method, path, res.status_code, message)
            raise RazorpayError(message)
        return data

    def create_plan(self, *, period: str, interval: int, name: str, amount_minor: int, currency: str, description: str = "") -> dict:
        rz_period, rz_interval = razorpay_period(period, interval)
        return self._call(
            "POST",
            "/plans",
            {
                "period": rz_period,
                "interval": rz_interval,
                "item": {"name": name[:100], "amount": int(amount_minor), "currency": currency.upper(), "description": description[:250]},
            },
        )

    def create_subscription(self, *, plan_id: str, period: str, notes: dict[str, str]) -> dict:
        return self._call(
            "POST",
            "/subscriptions",
            {"plan_id": plan_id, "total_count": cycles_for(period), "customer_notify": 1, "notes": notes},
        )

    def fetch_subscription(self, subscription_id: str) -> dict:
        return self._call("GET", f"/subscriptions/{subscription_id}")

    def cancel_subscription(self, subscription_id: str, at_cycle_end: bool = True) -> dict:
        return self._call("POST", f"/subscriptions/{subscription_id}/cancel", {"cancel_at_cycle_end": 1 if at_cycle_end else 0})

    # ---- signatures ----------------------------------------------------------------------------------------------

    def verify_payment(self, payment_id: str, subscription_id: str, signature: str) -> bool:
        """Checks the signature Razorpay's checkout hands the browser after a subscription payment."""
        if not (self._secret and payment_id and subscription_id and signature):
            return False
        expected = hmac.new(self._secret.encode(), f"{payment_id}|{subscription_id}".encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def verify_webhook(self, body: bytes, signature: str) -> bool:
        """Checks that a webhook call really came from Razorpay (signed over the exact bytes of the body)."""
        if not (self._webhook_secret and signature):
            return False
        expected = hmac.new(self._webhook_secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)


def entity_summary(entity: dict[str, Any]) -> dict:
    """The fields of a Razorpay subscription that matter here."""
    return {
        "id": entity.get("id", ""),
        "status": entity.get("status", ""),
        "current_start": float(entity.get("current_start") or 0),
        "current_end": float(entity.get("current_end") or 0),
        "paid_count": int(entity.get("paid_count") or 0),
        "notes": entity.get("notes") if isinstance(entity.get("notes"), dict) else {},
    }
