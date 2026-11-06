"""Influencers: a link of their own, who came through it, what they paid, and what each is owed.

Run from backend/:   python scripts/check_partners.py
"""
import json
import os
import sys
import tempfile
import time

tmp = tempfile.mkdtemp(prefix="partners-test-")
os.environ["DATA_DIR"] = tmp
os.environ["ADMIN_TOKEN"] = "tok-" + "x" * 30
os.environ["REVIEWER_LOGIN"] = "true"
os.environ["REVIEWER_EMAIL"] = "reviewer@example.com"
os.environ["REVIEWER_PASSWORD"] = "a-long-reviewer-password"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.partners import _commission  # noqa: E402
import _pg_guard  # noqa: E402

_pg_guard.install(main)
main._reviewer_limiter._limit = 1000
main._click_limiter._limit = 10_000

passed = failed = 0
TOKEN = {"X-Admin-Token": os.environ["ADMIN_TOKEN"]}


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


def fresh():
    return TestClient(main.app, base_url="http://testserver", follow_redirects=False)


admin = fresh()


def add(**fields):
    body = {"slug": "priya", "name": "Priya", "handle": "@priya.guitar", "commissionPct": 20, "commissionMonths": 0, "feeMinor": 0, **fields}
    return admin.post("/api/admin/partners", headers=TOKEN, json=body)


print("== adding an influencer")
r = add()
check("an influencer can be added", r.status_code == 200 and r.json()["partner"]["slug"] == "priya", r.text)
priya = r.json()["partner"]
check("the handle is saved without the @", priya["handle"] == "priya.guitar")
check("the same link name cannot be used twice", add().status_code == 400)
check("a link name needs letters, numbers or dashes", add(slug="bad name!").status_code == 400)
check("a link name cannot be one letter", add(slug="p").status_code == 400)
check("commission is a percent up to 100", add(slug="over", commissionPct=150).status_code == 400)
check("a link cannot lead to another site", add(slug="evil", landingPath="//evil.example").status_code == 400)
check("a link cannot lead to a full address", add(slug="evil2", landingPath="https://evil.example").status_code == 400)
check("a name is needed", add(slug="noname", name=" ").status_code == 400)
raj = add(slug="raj", name="Raj", commissionPct=10, commissionMonths=3, feeMinor=500000, landingPath="/pricing/").json()["partner"]
check("another influencer with a fee and a landing page", raj["landingPath"] == "/pricing/" and raj["feeMinor"] == 500000)
check("signed out, the list is closed", fresh().get("/api/admin/partners").status_code in (401, 404))

print("== the link")
visitor = fresh()
r = visitor.get("/r/priya")
check("opening the link goes on to the site, at a clean address", r.status_code == 302 and r.headers["location"] == "/", r.headers.get("location"))
check("and remembers them in a cookie", visitor.cookies.get("cs_ref") == "priya")
check("and which browser it was", bool(visitor.cookies.get("cs_vid")))
check("a link can open another page", fresh().get("/r/raj").headers["location"] == "/pricing/")
check("the name in the link can be in capitals", fresh().get("/r/PRIYA").status_code == 302)
check("an unknown name just opens the site, with no cookie", (lambda c, x: x.headers["location"] == "/" and "cs_ref" not in c.cookies)(*(lambda c: (c, c.get("/r/nobody")))(fresh())))
bot = fresh()
bot.get("/r/priya", headers={"user-agent": "facebookexternalhit/1.1"})
detail = admin.get(f"/api/admin/partners/{priya['id']}", headers=TOKEN).json()
check("a link preview robot is not counted as a visitor", detail["numbers"]["clicks"] == 2, str(detail["numbers"]["clicks"]))
visitor.get("/r/priya")
visitor.get("/r/raj")
check("opening another influencer's link does not take the credit", visitor.cookies.get("cs_ref") == "priya")
overview = admin.get("/api/admin/partners", headers=TOKEN).json()
raj_row = [p for p in overview["partners"] if p["slug"] == "raj"][0]
priya_row = [p for p in overview["partners"] if p["slug"] == "priya"][0]
check("but the click counts for them", raj_row["clicks"] == 2 and priya_row["clicks"] == 3 and priya_row["visitors"] == 2, f"{raj_row['clicks']} {priya_row['clicks']} {priya_row['visitors']}")
r = fresh().post("/api/ref/click", json={"slug": "raj", "landing": "/chords/"})
check("a page opened with ?ref= counts too (and remembers them)", r.status_code == 200 and r.cookies.get("cs_ref") == "raj")
check("the same answer for a name that does not exist", fresh().post("/api/ref/click", json={"slug": "nobody"}).json() == {"ok": True})
check("a request from another site is refused", fresh().post("/api/ref/click", json={"slug": "raj"}, headers={"Origin": "https://evil.example"}).status_code == 403)

print("== switching an influencer off")
off = add(slug="old", name="Old").json()["partner"]
admin.put(f"/api/admin/partners/{off['id']}", headers=TOKEN, json={"slug": "old", "name": "Old", "active": False})
r = fresh().get("/r/old")
check("a switched-off link goes to the site and credits nobody", r.headers["location"] == "/" and "cs_ref" not in r.cookies)
check("one with no history can be deleted", admin.delete(f"/api/admin/partners/{off['id']}", headers=TOKEN).status_code == 200)

print("== who came through the link")
signed = fresh()
signed.get("/r/priya")
r = signed.post("/api/auth/reviewer", json={"email": "reviewer@example.com", "password": "a-long-reviewer-password"})
reviewer = r.json()["user"]
check("a person who signs in for the first time after the link is credited", main.partners.partner_of(reviewer["id"]) == priya["id"])
other_user = main.accounts.sign_in("g-late", "late@example.com", "Late Comer", "")
check("somebody with no link is not credited", main.partners.partner_of(other_user["id"]) == "")
sneaky = fresh()
sneaky.get("/r/raj")
main.partners.credit_user(other_user["id"], raj["id"])
check("credit is given once and never moves", main.partners.credit_user(other_user["id"], priya["id"]) is False and main.partners.partner_of(other_user["id"]) == raj["id"])

print("== paying")
class FakePay:
    configured = True
    mode = "test"
    key_id = "rzp_test_x"
    _webhook_secret = "whsec"
    payments = {}
    def verify_payment(self, *a): return True
    def verify_webhook(self, raw, sig):
        import hashlib, hmac
        return hmac.compare_digest(hmac.new(b"whsec", raw, hashlib.sha256).hexdigest(), sig)
    def create_subscription(self, **kw): return {"id": "sub_" + kw["notes"]["user_id"][:8], "status": "created"}
    def fetch_subscription(self, sid): return {"id": sid, "status": "active", "current_start": int(time.time()), "current_end": int(time.time()) + 30 * 86400, "paid_count": 1, "notes": {}}
    def fetch_payment(self, pid): return self.payments[pid]
    def cancel_subscription(self, *a, **k): return {}

fake = FakePay()
main.razorpay = fake
price_id = main.catalog.db.run("SELECT pr.id AS id FROM plan_prices pr JOIN plans p ON p.id = pr.plan_id WHERE p.code <> 'free' LIMIT 1")[0][0]["id"]
main.catalog.db.run("UPDATE plan_prices SET razorpay_plan_id = 'plan_x', active = 1 WHERE id = ?", (price_id,))

def bearer(user):
    return {"Authorization": f"Bearer {main.accounts.start_session(user['id'])}"}

# the reviewer (credited to Priya) subscribes and pays 999.00
rb = bearer(reviewer)
r = signed.post("/api/billing/subscribe", headers=rb, json={"priceId": price_id})
check("a credited person can start paying", r.status_code == 200, r.text)
sub_id = r.json()["subscriptionId"]
now = time.time()
fake.payments["pay_1"] = {"id": "pay_1", "status": "captured", "amount": 99900, "currency": "INR", "created_at": int(now)}
r = signed.post("/api/billing/verify", headers=rb, json={"paymentId": "pay_1", "subscriptionId": sub_id, "signature": "ok"})
check("confirming the payment works", r.status_code == 200, r.text)
d = admin.get(f"/api/admin/partners/{priya['id']}", headers=TOKEN).json()["numbers"]
check("the first payment is in the books at once", d["grossMinor"] == 99900 and d["customers"] == 1 and d["signups"] == 1, str(d))
check("the commission is a percent of it", d["earnedMinor"] == 19980 and d["owedMinor"] == 19980, str(d))

def hook(event, payload):
    raw = json.dumps({"event": event, "payload": payload}).encode()
    import hashlib, hmac
    sig = hmac.new(b"whsec", raw, hashlib.sha256).hexdigest()
    return fresh().post("/api/billing/webhook", content=raw, headers={"x-razorpay-signature": sig, "content-type": "application/json"})

entity = {"id": sub_id, "status": "active", "current_start": int(now), "current_end": int(now) + 30 * 86400, "paid_count": 1, "notes": {"user_id": reviewer["id"], "price_id": price_id}}
r = hook("subscription.charged", {"subscription": {"entity": entity}, "payment": {"entity": {"id": "pay_1", "amount": 99900, "currency": "INR", "created_at": int(now)}}})
check("Razorpay saying it again does not count the payment twice", r.status_code == 200 and admin.get(f"/api/admin/partners/{priya['id']}", headers=TOKEN).json()["numbers"]["grossMinor"] == 99900)
r = hook("subscription.charged", {"subscription": {"entity": {**entity, "paid_count": 2}}, "payment": {"entity": {"id": "pay_2", "amount": 99900, "currency": "INR", "created_at": int(now) + 40 * 86400}}})
d = admin.get(f"/api/admin/partners/{priya['id']}", headers=TOKEN).json()["numbers"]
check("a renewal is a second payment from the same customer", d["grossMinor"] == 199800 and d["customers"] == 1, str(d))
r = hook("refund.processed", {"refund": {"entity": {"id": "rfnd_1", "payment_id": "pay_2", "amount": 49900, "status": "processed", "created_at": int(now) + 41 * 86400}}})
d = admin.get(f"/api/admin/partners/{priya['id']}", headers=TOKEN).json()["numbers"]
check("a refund comes off the revenue", d["refundedMinor"] == 49900 and d["netMinor"] == 149900, str(d))
check("and off the commission", d["earnedMinor"] == 29980, str(d))
hook("refund.processed", {"refund": {"entity": {"id": "rfnd_1", "payment_id": "pay_2", "amount": 49900, "status": "processed"}}})
check("the same refund told twice counts once", admin.get(f"/api/admin/partners/{priya['id']}", headers=TOKEN).json()["numbers"]["refundedMinor"] == 49900)
check("a webhook with a bad signature is refused", fresh().post("/api/billing/webhook", content=b"{}", headers={"x-razorpay-signature": "bad"}).status_code == 401)
check("a payment for a plan the team gave (no real subscription) is ignored", main.partners.record_payment("pay_x", "manual_abc", 100, "INR", now) is False)
check("so is one for a subscription we do not know", main.partners.record_payment("pay_y", "sub_unknown", 100, "INR", now) is False)

print("== commission rules")
pays = [
    {"payer": "a", "net": 100000, "paid_at": 0.0},
    {"payer": "a", "net": 100000, "paid_at": 40 * 86400.0},
    {"payer": "a", "net": 100000, "paid_at": 100 * 86400.0},
    {"payer": "b", "net": 50000, "paid_at": 50 * 86400.0},
]
check("every payment earns when months is 0", _commission(10, 0, pays) == 35000)
check("only the first 2 months of each customer count", _commission(10, 2, pays) == 25000, str(_commission(10, 2, pays)))
check("a refunded payment earns nothing", _commission(10, 0, [{"payer": "a", "net": 0, "paid_at": 0.0}]) == 0)

print("== payouts and what is owed")
r = admin.post(f"/api/admin/partners/{priya['id']}/payouts", headers=TOKEN, json={"amountMinor": 10000, "note": "UPI, 1st payout"})
check("a payout can be recorded", r.status_code == 200, r.text)
payout_id = r.json()["payout"]["id"]
d = admin.get(f"/api/admin/partners/{priya['id']}", headers=TOKEN).json()
check("what is owed is earned minus paid out", d["numbers"]["paidOutMinor"] == 10000 and d["numbers"]["owedMinor"] == 19980, str(d["numbers"]))
check("it is listed with its note", d["payouts"][0]["note"] == "UPI, 1st payout")
check("a payout of nothing is refused", admin.post(f"/api/admin/partners/{priya['id']}/payouts", headers=TOKEN, json={"amountMinor": 0}).status_code == 400)
check("an influencer with money on record cannot be deleted", admin.delete(f"/api/admin/partners/{priya['id']}", headers=TOKEN).status_code == 400)
check("a payout can be undone", admin.delete(f"/api/admin/partners/{priya['id']}/payouts/{payout_id}", headers=TOKEN).status_code == 200)

print("== the figures")
check("the 30 days are listed day by day", len(d["series"]) == 30 and sum(day["signups"] for day in d["series"]) == 1, str(len(d["series"])))
check("the customer is listed with what they paid", d["customers"][0]["paidMinor"] == 149900 and d["customers"][0]["subscribed"] is True, str(d["customers"]))
check("without their name or id in the payments table", "reviewer" not in json.dumps(main.catalog.db.run("SELECT * FROM payments")[0]))
check("revenue less the commission is the profit", d["numbers"]["profitMinor"] == d["numbers"]["netMinor"] - d["numbers"]["costMinor"])
totals = admin.get("/api/admin/partners", headers=TOKEN).json()["totals"]
check("the totals add up every influencer", totals["netMinor"] == 149900 and totals["signups"] == 2 and totals["clicks"] >= 6, str(totals))
raj_row = [p for p in admin.get("/api/admin/partners", headers=TOKEN).json()["partners"] if p["slug"] == "raj"][0]
check("an influencer with a fee and no sales is at a loss", raj_row["profitMinor"] == -500000 and raj_row["roiPct"] == -100.0, str(raj_row))

print("== the account is deleted")
r = signed.delete("/api/me", headers=rb)
check("a customer can delete their account", r.status_code == 200, r.text)
d = admin.get(f"/api/admin/partners/{priya['id']}", headers=TOKEN).json()
check("the revenue stays on the books", d["numbers"]["netMinor"] == 149900, str(d["numbers"]))
check("and nobody is named in it", d["customers"] == [])

print(f"\npassed {passed}, failed {failed}")
sys.exit(1 if failed else 0)
