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
import _pg_guard  # noqa: E402

_pg_guard.install(main)
main._reviewer_limiter._limit = 1000  # these checks sign in more often than the real limit allows

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

print("== the instrument a person shows chords for")
client3, me3 = sign_in()
check("a new person has chosen nothing", me3["instrument"] == "")
r = client3.put("/api/me/instrument", json={"instrument": "piano"})
check("choosing an instrument works", r.status_code == 200 and r.json() == {"instrument": "piano"}, r.text)
check("and signing in again brings it back (any device)", sign_in()[1]["instrument"] == "piano")
check("so does asking who they are", client3.get("/api/auth/me").json()["user"]["instrument"] == "piano")
check("an unknown instrument is refused", client3.put("/api/me/instrument", json={"instrument": "kazoo"}).status_code == 400)
check("signed out, nothing is saved", TestClient(main.app, base_url="http://testserver").put("/api/me/instrument", json={"instrument": "guitar"}).status_code == 401)
check("a request from another site is refused", client3.put("/api/me/instrument", json={"instrument": "guitar"}, headers={"Origin": "https://evil.example"}).status_code == 403)
check("the choice is unchanged by those", sign_in()[1]["instrument"] == "piano")
for name in ("guitar", "ukulele", "mandolin"):
    check(f"{name} is accepted", client3.put("/api/me/instrument", json={"instrument": name}).status_code == 200)

print("== settings")
c4, me4 = sign_in()
DEFAULTS = {"easyChords": False, "lite": False, "theme": "system"}
check("a new person has every setting at its default", me4["settings"] == DEFAULTS, str(me4.get("settings")))
r = c4.put("/api/me/settings", json={"easyChords": True, "theme": "dark"})
check("changing some settings answers with all of them", r.status_code == 200 and r.json()["settings"] == {"easyChords": True, "lite": False, "theme": "dark"}, r.text)
check("the others are left as they were", c4.put("/api/me/settings", json={"lite": True}).json()["settings"] == {"easyChords": True, "lite": True, "theme": "dark"})
check("signing in again brings them back (any device)", sign_in()[1]["settings"] == {"easyChords": True, "lite": True, "theme": "dark"})
check("asking for them gives the same", c4.get("/api/me/settings").json()["settings"]["theme"] == "dark")
check("an unknown theme is refused", c4.put("/api/me/settings", json={"theme": "neon"}).status_code == 400)
check("an unknown instrument is refused", c4.put("/api/me/settings", json={"instrument": "kazoo"}).status_code == 400)
check("the instrument can be set with them", c4.put("/api/me/settings", json={"instrument": "ukulele"}).json()["instrument"] == "ukulele" and c4.get("/api/auth/me").json()["user"]["instrument"] == "ukulele")
check("signed out, nothing is read or saved", TestClient(main.app, base_url="http://testserver").get("/api/me/settings").status_code == 401)
check("a request from another site is refused", c4.put("/api/me/settings", json={"lite": False}, headers={"Origin": "https://evil.example"}).status_code == 403)
check("and changed nothing", c4.get("/api/me/settings").json()["settings"]["lite"] is True)

print("== signed-in devices, history and the download of my data")
c5, _ = sign_in()
check("two sign-ins are counted", c4.get("/api/me/security").json()["sessions"] >= 2)
r = c4.post("/api/me/sessions/end-others")
check("signing out the others ends them", r.status_code == 200 and r.json()["ended"] >= 1, r.text)
check("this sign-in stays", c4.get("/api/auth/me").json()["user"] is not None and c4.get("/api/me/security").json()["sessions"] == 1)
check("the other is signed out", c5.get("/api/auth/me").json()["user"] is None)
check("a request from another site cannot end sign-ins", c4.post("/api/me/sessions/end-others", headers={"Origin": "https://evil.example"}).status_code == 403)
uid4 = me4["id"]
main.engagement.record_play(uid4, "yt_abcdefghijk", {"title": "A song", "artist": "Somebody", "duration": 120, "chords": []})
data = c4.get("/api/me/export")
check("the download is a file with the account, plan, settings and library", data.status_code == 200 and "attachment" in data.headers["content-disposition"] and {"account", "plan", "settings", "library", "progress"} <= set(data.json()), data.text[:200])
check("it lists the song that was played", [i["title"] for i in data.json()["library"]] == ["A song"])
check("it holds no session or password data", "token" not in data.text and "password" not in data.text.lower())
r = c4.delete("/api/me/history")
check("clearing the history removes songs that were only played", r.status_code == 200 and r.json()["removed"] == 1, r.text)
check("the library is empty after it", c4.get("/api/me/export").json()["library"] == [])
check("signed out, none of these work", TestClient(main.app, base_url="http://testserver").get("/api/me/export").status_code == 401)

print(f"\npassed {passed}, failed {failed}")
sys.exit(1 if failed else 0)
