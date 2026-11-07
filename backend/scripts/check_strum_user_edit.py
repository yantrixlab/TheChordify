"""Listeners editing a song's strumming: who may, what is checked, the versions it keeps, and the admin's switch for each song.

Run from backend/:   python scripts/check_strum_user_edit.py
"""
import copy
import os
import shutil
import sys
import tempfile

tmp = tempfile.mkdtemp(prefix="strumedit-test-")
os.environ["DATA_DIR"] = tmp
os.environ["ADMIN_TOKEN"] = "tok-" + "x" * 30
os.environ["REVIEWER_LOGIN"] = "true"
os.environ["REVIEWER_EMAIL"] = "listener@example.com"
os.environ["REVIEWER_PASSWORD"] = "a-long-reviewer-password"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from fastapi.testclient import TestClient  # noqa: E402

from app import main, songedit  # noqa: E402
import _pg_guard  # noqa: E402

_pg_guard.install(main)
main._reviewer_limiter._limit = 1000

TOKEN = {"X-Admin-Token": os.environ["ADMIN_TOKEN"]}
admin = TestClient(main.app, base_url="http://testserver")
passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


def listener():
    c = TestClient(main.app, base_url="http://testserver")
    r = c.post("/api/auth/reviewer", json={"email": "listener@example.com", "password": "a-long-reviewer-password"})
    assert r.status_code == 200, r.text
    return c


def song(video_id="abcdefghijk"):
    beat = 0.5
    bars = []
    for b in range(20):
        t = b * 4 * beat
        bars.append({"start": t, "beats": [t + k * beat for k in range(4)] + [t + 4 * beat]})
    names = ["C", "F", "G", "Am"]
    chords = [{"start": b * 2.0, "end": (b + 1) * 2.0, "chord": names[b % 4], "confidence": 0.9, "gridStart": b * 2.0} for b in range(20)]
    first = {"pattern": ["D", "-", "D", "-", "D", "U", "D", "-"], "sub": 2, "kind": "heard", "confidence": 0.7, "where": ["Chorus"], "bars": 8, "label": "x", "easy": ["D", "-", "D", "-", "D", "-", "D", "-"]}
    return {
        "sessionId": "yt_" + video_id, "source": "youtube", "videoId": video_id, "title": "Test Song", "artist": "Test Artist",
        "duration": 40.0, "tempo": 120.0, "key": "C", "beatsPerBar": 4, "bars": bars, "sections": [], "beatTimes": [],
        "chords": chords, "chordsDetailed": copy.deepcopy(chords), "engine": "btc", "analysisVersion": main.ANALYSIS_VERSION,
        "strum": {"v": 4, "perBar": 4, "bpm": 120.0, "patterns": [first], **first, "detected": True},
    }


def seed(result):
    main.catalog.save_song(result["videoId"], result["sessionId"], title=result["title"], artist=result["artist"], duration=result["duration"], chords=["C", "F"], key="C", tempo=120.0)
    main.catalog.save_result(result["sessionId"], result)


VID = "abcdefghijk"
SID = "yt_" + VID
seed(song(VID))
URL = f"/api/songs/{SID}/strumming"
NEW = {"perBar": 4, "bpm": 120, "patterns": [{"pattern": ["D", "-", "D", "U", "-", "U", "D", "U"], "sub": 2, "where": ["Verse"]}]}

print("== what the player is told")
c = listener()
got = c.get(f"/api/result/{SID}").json()
check("a YouTube song says strumming may be edited (the default)", got.get("strumEdit") is True, str({k: got.get(k) for k in ("strumEdit", "strumToken")}))
check("and gives the fingerprint a save is checked against", bool(got.get("strumToken")) and got["strumToken"] == songedit.token(main.catalog.load_result(SID)))
check("the fingerprint is not stored in the song", "strumToken" not in main.catalog.load_result(SID))
check("the job answer says it too", c.get(f"/api/job/{SID}").json()["result"]["strumEdit"] is True)
check("an uploaded song's answer carries no switch (it cannot be edited)", "strumEdit" not in main._with_pending("up_abc123", {"chords": []}))

print("== who may save")
check("a signed-out visitor is refused", TestClient(main.app, base_url="http://testserver").put(URL, json={"token": got["strumToken"], "strum": NEW}).status_code == 401)
check("a request from another site is refused", c.put(URL, json={"token": got["strumToken"], "strum": NEW}, headers={"Origin": "https://evil.example"}).status_code == 403)
check("an uploaded song cannot be edited", c.put("/api/songs/up_abc123/strumming", json={"token": "x", "strum": NEW}).status_code == 404)
check("an unknown song is 404", c.put("/api/songs/yt_zzzzzzzzzzz/strumming", json={"token": "x", "strum": NEW}).status_code == 404)

print("== a listener changes the strumming")
before = copy.deepcopy(main.catalog.load_result(SID))
r = c.put(URL, json={"token": got["strumToken"], "strum": NEW})
check("a signed-in person can save", r.status_code == 200 and r.json()["changed"] is True, r.text)
saved = main.catalog.load_result(SID)
check("the song now has the new pattern", saved["strum"]["patterns"][0]["pattern"] == NEW["patterns"][0]["pattern"], str(saved["strum"])[:200])
check("marked as edited, with where it plays", saved["strum"]["patterns"][0]["kind"] == "edited" and saved["strum"]["patterns"][0]["where"] == ["Verse"])
check("the chords and the sections are untouched", saved["chords"] == before["chords"] and saved["chordsDetailed"] == before["chordsDetailed"] and saved["sections"] == before["sections"])
check("the song is marked as edited, so it is not re-analysed by itself", bool(saved.get("edited")) and saved["edited"]["by"] == "listener@example.com")
check("everybody sees it at once", listener().get(f"/api/result/{SID}").json()["strum"]["patterns"][0]["pattern"] == NEW["patterns"][0]["pattern"])
versions = songedit.load_versions(main.catalog, SID)
check("the original and the change are kept as versions", len(versions) == 2 and versions[0]["summary"] == "Original analysis" and "listener" in versions[1]["summary"], str([v["summary"] for v in versions]))
check("with who made the change", versions[1]["by"] == "listener@example.com")
check("the admin can see it in the editor's history", any("listener" in v["summary"] for v in admin.get(f"/api/admin/songs/{VID}/edit", headers=TOKEN).json()["versions"]))
r2 = c.put(URL, json={"token": r.json()["token"], "strum": NEW})
check("saving the same thing again changes nothing", r2.status_code == 200 and r2.json()["changed"] is False, r2.text)

print("== what is refused")
tok = songedit.token(main.catalog.load_result(SID))
check("an old fingerprint (somebody else saved first) is a conflict", c.put(URL, json={"token": got["strumToken"], "strum": NEW}).status_code == 409)
check("a pattern of the wrong length is refused", c.put(URL, json={"token": tok, "strum": {"perBar": 4, "patterns": [{"pattern": ["D", "U"], "sub": 2}]}}).status_code == 400)
check("a pattern with no strokes is refused", c.put(URL, json={"token": tok, "strum": {"perBar": 4, "patterns": [{"pattern": ["-"] * 8, "sub": 2}]}}).status_code == 400)
check("an unknown stroke is refused", c.put(URL, json={"token": tok, "strum": {"perBar": 4, "patterns": [{"pattern": ["X"] * 8, "sub": 2}]}}).status_code == 400)
check("taking every pattern away is refused", c.put(URL, json={"token": tok, "strum": {"perBar": 4, "patterns": []}}).status_code == 400)
check("more than eight patterns is refused", c.put(URL, json={"token": tok, "strum": {"perBar": 4, "patterns": [NEW["patterns"][0]] * 9}}).status_code == 400)
check("nothing changed by the refused ones", songedit.token(main.catalog.load_result(SID)) == tok)

print("== the admin's switch")
check("the admin's list says it is on for the song", [s for s in admin.get("/api/admin/song-pages", headers=TOKEN).json()["songs"] if s["videoId"] == VID][0]["strumEdit"] is True)
check("the song editor says it is on", admin.get(f"/api/admin/songs/{VID}/edit", headers=TOKEN).json()["userStrumEdit"] is True)
check("a signed-out visitor cannot use the switch", TestClient(main.app).put(f"/api/admin/songs/{VID}/strum-edit", json={"enabled": False}).status_code == 401)
check("a listener cannot use the switch", c.put(f"/api/admin/songs/{VID}/strum-edit", json={"enabled": False}).status_code in (401, 403))
check("an unknown song cannot be switched", admin.put("/api/admin/songs/zzzzzzzzzzz/strum-edit", json={"enabled": False}, headers=TOKEN).status_code == 404)
r = admin.put(f"/api/admin/songs/{VID}/strum-edit", json={"enabled": False}, headers=TOKEN)
check("the admin can turn it off for a song", r.status_code == 200 and r.json() == {"videoId": VID, "enabled": False}, r.text)
check("the player is told", listener().get(f"/api/result/{SID}").json()["strumEdit"] is False)
check("the list and the editor say off", [s for s in admin.get("/api/admin/song-pages", headers=TOKEN).json()["songs"] if s["videoId"] == VID][0]["strumEdit"] is False and admin.get(f"/api/admin/songs/{VID}/edit", headers=TOKEN).json()["userStrumEdit"] is False)
tok = songedit.token(main.catalog.load_result(SID))
check("a save is refused while it is off", c.put(URL, json={"token": tok, "strum": NEW}).status_code == 403)
check("the song is as it was", songedit.token(main.catalog.load_result(SID)) == tok)
check("the admin can still edit the strumming", admin.put(f"/api/admin/songs/{VID}/edit", json={"token": tok, "strumChanged": True, "strum": NEW}, headers=TOKEN).status_code == 200)
seed_other = song("bcdefghijkl")
seed(seed_other)
check("another song is not affected", listener().get("/api/result/yt_bcdefghijkl").json()["strumEdit"] is True)
check("the admin can turn it back on", admin.put(f"/api/admin/songs/{VID}/strum-edit", json={"enabled": True}, headers=TOKEN).json()["enabled"] is True)
tok = songedit.token(main.catalog.load_result(SID))
NEW2 = {"perBar": 4, "bpm": 120, "patterns": [{"pattern": ["D", "-", "-", "U", "-", "U", "D", "-"], "sub": 2, "where": []}]}
check("and a save works again", c.put(URL, json={"token": tok, "strum": NEW2}).status_code == 200)

print("== not too many saves")
main._strum_save_limiter._limit = 2
main._strum_save_limiter._hits.clear() if hasattr(main._strum_save_limiter, "_hits") else None
seen = []
for n in range(4):
    t = songedit.token(main.catalog.load_result(SID))
    pattern = ["D", "-", "D", "U", "-", "U", "D", "-"] if n % 2 else ["D", "U", "D", "-", "-", "U", "D", "-"]
    seen.append(c.put(URL, json={"token": t, "strum": {"perBar": 4, "patterns": [{"pattern": pattern, "sub": 2}]}}).status_code)
check("a person who saves again and again is slowed down", 429 in seen, str(seen))

print()
print(f"passed {passed}, failed {failed}")
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(1 if failed else 0)
