"""End-to-end check of giving, extending and ending a person's plan from the admin, and how it mixes with plans they pay for.

Run from backend/:   python scripts/check_userplans.py
"""
import os
import sys
import tempfile
import time

tmp = tempfile.mkdtemp(prefix="userplans-test-")
os.environ["DATA_DIR"] = tmp
os.environ["ADMIN_TOKEN"] = "tok-" + "x" * 30
os.environ["ADMIN_EMAILS"] = "owner@example.com"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from fastapi.testclient import TestClient  # noqa: E402

from app import main, plans as plans_module  # noqa: E402
import _pg_guard  # noqa: E402

_pg_guard.install(main)

client = TestClient(main.app, base_url="http://testserver")
TOKEN = {"X-Admin-Token": os.environ["ADMIN_TOKEN"]}
passed = failed = 0
DAY = 86400


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


def person(n):
    return main.accounts.sign_in(f"g-{n}", f"person{n}@example.com", f"Person {n}", "")


def plan_of(user):
    return main.plans.effective(user["id"])


def post(user, body, headers=TOKEN):
    return client.post(f"/api/admin/users/{user['id']}/plan", headers=headers, json=body)


paid_plans = [p for p in main.plans.list_plans() if not p["isFree"]]
check("the database has paid plans to give", len(paid_plans) >= 1)
premium = paid_plans[0]
other = paid_plans[1] if len(paid_plans) > 1 else paid_plans[0]

print("== calendar maths")
t = time.mktime((2026, 1, 31, 12, 0, 0, 0, 0, 0))
import datetime as dt  # noqa: E402

def ymd(ts):
    return dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).strftime("%Y-%m-%d")

base = dt.datetime(2026, 1, 31, 12, tzinfo=dt.timezone.utc).timestamp()
check("31 Jan + 1 month is the end of February", ymd(plans_module.add_period(base, "months", 1)) == "2026-02-28")
check("31 Jan + 13 months is the end of February next year", ymd(plans_module.add_period(base, "months", 13)) == "2027-02-28")
check("a year from 29 Feb is 28 Feb", ymd(plans_module.add_period(dt.datetime(2028, 2, 29, tzinfo=dt.timezone.utc).timestamp(), "years", 1)) == "2029-02-28")
check("30 days later", ymd(plans_module.add_period(base, "days", 30)) == "2026-03-02")
check("December rolls into January", ymd(plans_module.add_period(dt.datetime(2026, 12, 15, tzinfo=dt.timezone.utc).timestamp(), "months", 1)) == "2027-01-15")

print("== giving a plan")
a = person(1)
check("a new person is on Free", plan_of(a)[0]["isFree"])
r = post(a, {"action": "give", "planId": premium["id"], "unit": "months", "amount": 3})
check("giving a plan works", r.status_code == 200, r.text)
state = r.json()
check("the answer says it is from the team, with its end", state["current"]["source"] == "gift" and state["current"]["planName"] == premium["name"] and state["current"]["end"] > time.time() + 80 * DAY, str(state["current"]))
plan, sub = plan_of(a)
check("the person is on that plan now", plan["id"] == premium["id"] and sub["manual"])
check("the plan code on the account follows", main.accounts.get_user(a["id"])["plan"] == premium["code"])
check("the website's plan answer shows a gift that does not renew", main._subscription_view(sub)["gift"] is True and main._subscription_view(sub)["cancelAtPeriodEnd"] is True)
check("a gift is not counted as revenue", main.plans.revenue()["active"] == 0)

print("== the list shows it")
users = client.get("/api/admin/users", headers=TOKEN).json()["users"]
row = next(u for u in users if u["id"] == a["id"])
check("the list shows plan name, source and end", row["planName"] == premium["name"] and row["planSource"] == "gift" and row["planEnd"], str({k: row[k] for k in row if k.startswith("plan")}))
row_free = next((u for u in users if u["id"] != a["id"]), None)
check("the list says who may give plans", client.get("/api/admin/users", headers=TOKEN).json()["canGivePlans"] is True)

print("== extending")
end1 = state["current"]["end"]
r = post(a, {"action": "extend", "unit": "months", "amount": 1})
check("extending adds to the end date, not to today", r.status_code == 200 and abs(r.json()["current"]["end"] - plans_module.add_period(end1, "months", 1)) < 2, r.text)
r = post(a, {"action": "extend", "unit": "until", "until": time.time() + DAY})
check("an end date earlier than the current end is refused", r.status_code == 400, r.text)
r = post(a, {"action": "extend", "unit": "lifetime"})
check("extending to no end date works", r.status_code == 200 and r.json()["current"]["end"] is None, r.text)
check("and they still have the plan", plan_of(a)[0]["id"] == premium["id"])
r = post(a, {"action": "extend", "unit": "months", "amount": 1})
check("a plan with no end date cannot be extended", r.status_code == 400, r.text)

print("== replacing a plan keeps one gift at a time")
r = post(a, {"action": "give", "planId": other["id"], "unit": "days", "amount": 10})
check("giving another plan replaces the first", r.status_code == 200 and r.json()["current"]["planId"] == other["id"], r.text)
rows, _ = main.catalog.db.run("SELECT status FROM subscriptions WHERE user_id = ? AND razorpay_subscription_id LIKE ?", (a["id"], "manual_%"))
check("the old gift is kept as history, ended", sorted(x["status"] for x in rows) == ["active", "cancelled"], str(rows))
check("history lists both", len(r.json()["history"]) == 2)

print("== ending")
r = post(a, {"action": "end"})
check("ending takes the plan away at once", r.status_code == 200 and plan_of(a)[0]["isFree"], r.text)
check("the account's plan code is back to free", main.accounts.get_user(a["id"])["plan"] == "free")
r = post(a, {"action": "end"})
check("ending again says there is nothing to end", r.status_code == 400)

print("== a gift runs out by itself")
b = person(2)
post(b, {"action": "give", "planId": premium["id"], "unit": "days", "amount": 5})
main.catalog.db.run("UPDATE subscriptions SET current_end = ? WHERE user_id = ?", (time.time() - 5, b["id"]))
check("past its end date, the person is back on Free", plan_of(b)[0]["isFree"])
row = next(u for u in client.get("/api/admin/users", headers=TOKEN).json()["users"] if u["id"] == b["id"])
check("and the list says Free, not the stale plan code", row["planIsFree"] and row["planSource"] == "free", str(row))
r = post(b, {"action": "extend", "unit": "days", "amount": 5})
check("an expired gift cannot be extended; give again instead", r.status_code == 400)
r = post(b, {"action": "give", "planId": premium["id"], "unit": "until", "until": time.time() + 40 * DAY})
check("giving until a date works", r.status_code == 200 and abs(r.json()["current"]["end"] - (time.time() + 40 * DAY)) < 5, r.text)

print("== mixing with a plan they pay for")
c = person(3)
main.plans.create_subscription(c["id"], premium["id"], (premium["prices"] or [{"id": ""}])[0]["id"], "sub_paid1", "active")
main.catalog.db.run("UPDATE subscriptions SET current_end = ? WHERE razorpay_subscription_id = 'sub_paid1'", (time.time() + 20 * DAY,))
check("a paid plan is the person's plan", plan_of(c)[1]["manual"] is False and plan_of(c)[0]["id"] == premium["id"])
r = post(c, {"action": "give", "planId": other["id"], "unit": "months", "amount": 1})
check("a gift on top wins while it runs", r.json()["current"]["source"] == "gift" and plan_of(c)[0]["id"] == other["id"], r.text)
check("and the paid plan is still shown as theirs", r.json()["paid"] and r.json()["paid"]["end"])
post(c, {"action": "end"})
check("when the gift ends the paid plan is back", plan_of(c)[1]["manual"] is False and plan_of(c)[0]["id"] == premium["id"])
cancelled = []
main.razorpay.cancel_subscription = lambda rid, at_cycle_end=True: cancelled.append((rid, at_cycle_end))
r = post(c, {"action": "stop_renewal"})
check("stopping renewal cancels at the end of the period", r.status_code == 200 and cancelled == [("sub_paid1", True)], r.text)
check("the plan stays until the period ends", plan_of(c)[0]["id"] == premium["id"] and r.json()["paid"]["renewalOff"])
r = post(c, {"action": "stop_renewal"})
check("stopping twice is refused", r.status_code == 400)
check("the paid plan counts as revenue, gifts do not", main.plans.revenue()["active"] == 1)
check("the user's own cancel finds the paid plan even under a gift", len(main.plans.live_paid(c["id"])) == 1)

print("== validation")
d = person(4)
for name, body in [
    ("the free plan cannot be given", {"action": "give", "planId": main.plans.free_plan()["id"], "unit": "days", "amount": 5}),
    ("an unknown plan is refused", {"action": "give", "planId": "nope", "unit": "days", "amount": 5}),
    ("no length is refused", {"action": "give", "planId": premium["id"]}),
    ("zero days is refused", {"action": "give", "planId": premium["id"], "unit": "days", "amount": 0}),
    ("too many months is refused", {"action": "give", "planId": premium["id"], "unit": "months", "amount": 121}),
    ("a past date is refused", {"action": "give", "planId": premium["id"], "unit": "until", "until": time.time() - DAY}),
    ("a date far away is refused", {"action": "give", "planId": premium["id"], "unit": "until", "until": time.time() + 80 * 365 * DAY}),
    ("an unknown unit is refused", {"action": "give", "planId": premium["id"], "unit": "weeks", "amount": 2}),
    ("an unknown action is refused", {"action": "gift"}),
    ("extending with nothing running is refused", {"action": "extend", "unit": "days", "amount": 3}),
    ("stopping renewal with nothing paid is refused", {"action": "stop_renewal"}),
]:
    r = post(d, body)
    check(name, r.status_code == 400, f"{r.status_code} {r.text}")
check("nothing was given by those", plan_of(d)[0]["isFree"])
check("an unknown person is 404", client.post("/api/admin/users/nobody/plan", headers=TOKEN, json={"action": "end"}).status_code == 404)

print("== permissions")
main.role_store.update("editor", None, None, ["users.view", "users.plans"])
from app import roles as roles_module  # noqa: E402

main.accounts.create_staff("helper@example.com", "Helper", roles_module.hash_password("a-long-password-1"), "editor")
login = client.post("/api/admin/auth/login", json={"email": "helper@example.com", "password": "a-long-password-1"})
if login.status_code == 200:
    check("a role with the permission can give a plan", client.post(f"/api/admin/users/{d['id']}/plan", json={"action": "give", "planId": premium["id"], "unit": "days", "amount": 2}).status_code == 200)
    check("and sees canGivePlans", client.get("/api/admin/users").json()["canGivePlans"] is True)
    main.role_store.update("editor", None, None, ["users.view"])
    check("without it the same call is refused", client.post(f"/api/admin/users/{d['id']}/plan", json={"action": "end"}).status_code == 403)
    check("and the list says so", client.get("/api/admin/users").json()["canGivePlans"] is False)
    check("and the dialog's data is refused", client.get(f"/api/admin/users/{d['id']}/plan").status_code == 403)
else:
    print("   (could not sign a staff account in here:", login.status_code, login.text[:120], ")")
check("a signed-out visitor gets nothing", TestClient(main.app, base_url="http://testserver").post(f"/api/admin/users/{d['id']}/plan", json={"action": "end"}).status_code in (401, 403, 404))

print("== deleting an account that has a gift on top of a paid plan")
e = person(5)
main.plans.create_subscription(e["id"], premium["id"], (premium["prices"] or [{"id": ""}])[0]["id"], "sub_paid2", "active")
post(e, {"action": "give", "planId": other["id"], "unit": "months", "amount": 1})
cancelled.clear()
sessions = main.accounts.start_session(e["id"])
r = TestClient(main.app, base_url="http://testserver").delete("/api/me", headers={"Authorization": f"Bearer {sessions}"})
check("the paid plan is cancelled even though a gift sits on top", r.status_code == 200 and ("sub_paid2", False) in cancelled, f"{r.status_code} {r.text} {cancelled}")

print(f"\npassed {passed}, failed {failed}")
sys.exit(1 if failed else 0)
