"""The answer to signing in is the same person the "who am I" answer gives (level, XP, plan name, streak), so the page looks right at once.

Run from backend/:   python scripts/check_signin.py
"""
import os
import sys
import tempfile
import time

tmp = tempfile.mkdtemp(prefix="signin-test-")
os.environ["DATA_DIR"] = tmp
os.environ["ADMIN_TOKEN"] = "tok-" + "x" * 30
os.environ["REVIEWER_LOGIN"] = "true"
os.environ["REVIEWER_EMAIL"] = "reviewer@example.com"
os.environ["REVIEWER_PASSWORD"] = "a-long-reviewer-password"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


FULL = ("level", "title", "ring", "stars", "xp", "intoLevel", "levelSpan", "nextLevelXp", "streak", "planName")


def sign_in():
    client = TestClient(main.app, base_url="http://testserver")
    r = client.post("/api/auth/reviewer", json={"email": "reviewer@example.com", "password": "a-long-reviewer-password"})
    assert r.status_code == 200, r.text
    return client, r.json()["user"]


print("== a first sign-in")
client, user = sign_in()
check("the answer to signing in has the level, XP, streak and plan name", all(k in user for k in FULL), str(sorted(user)))
me = client.get("/api/auth/me").json()["user"]
check("and it is the same person a refresh shows", user == me, f"{user} != {me}")
check("a new person is level 1 on the Free plan", user["level"] == 1 and user["plan"] == "free" and user["planName"])

print("== a person who has earned XP and has a plan")
uid = user["id"]
main.engagement._db.run("UPDATE user_progress SET xp = ? WHERE user_id = ?", (350, uid)) if main.engagement._progress(uid) else None
paid = [p for p in main.plans.list_plans() if not p["isFree"]][0]
main.plans.give_plan(uid, paid["id"], time.time() + 30 * 86400)
client2, again = sign_in()
me2 = client2.get("/api/auth/me").json()["user"]
check("signing in again shows the XP they have", again["xp"] == 350 and again["level"] > 1, str(again))
check("and the plan they have (the plan name, not the stale code)", again["plan"] == paid["code"] and again["planName"] == paid["name"], str(again))
check("still the same as a refresh", again == me2)

print("== the app's sign-in")
r = TestClient(main.app, base_url="http://testserver").post("/api/auth/reviewer", json={"email": "reviewer@example.com", "password": "a-long-reviewer-password", "mobile": True}).json()
check("the app gets the full person and its token", r["token"] and all(k in r["user"] for k in FULL))

print(f"\npassed {passed}, failed {failed}")
sys.exit(1 if failed else 0)
