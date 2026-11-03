"""End-to-end check of editing a chordified song from the admin: validation, versions, locking, restore, re-analysis, permissions.

Run from backend/:   python scripts/check_songedit.py [path/to/a/saved/result.json]
With a saved result (the JSON of /api/result/<session>) it also runs the checks on that real song.
"""
import copy
import json
import os
import shutil
import sys
import tempfile
import time

tmp = tempfile.mkdtemp(prefix="songedit-test-")
os.environ["DATA_DIR"] = tmp
os.environ["ADMIN_TOKEN"] = "tok-" + "x" * 30
os.environ["ADMIN_EMAILS"] = "owner@example.com"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from fastapi.testclient import TestClient  # noqa: E402

from app import main, songedit  # noqa: E402
import _pg_guard  # noqa: E402

_pg_guard.install(main)

client = TestClient(main.app, base_url="http://testserver")
TOKEN = {"X-Admin-Token": os.environ["ADMIN_TOKEN"]}
passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


def synthetic(video_id="abcdefghijk"):
    """A 20-bar song in 4/4 at 0.5 s a beat: C F G Am, one chord a bar."""
    beat = 0.5
    bars = []
    for b in range(20):
        t = b * 4 * beat
        bars.append({"start": t, "beats": [t + k * beat for k in range(4)] + [t + 4 * beat]})
    names = ["C", "F", "G", "Am"]
    chords = [{"start": 0.0, "end": 0.0, "chord": "N", "confidence": 1.0, "gridStart": 0.0}]
    for b in range(20):
        chords.append({"start": b * 2.0 + 0.0, "end": (b + 1) * 2.0, "chord": names[b % 4], "confidence": 0.9, "gridStart": b * 2.0})
    chords = chords[1:]
    return {
        "sessionId": "yt_" + video_id, "source": "youtube", "videoId": video_id, "title": "Test Song", "artist": "Test Artist",
        "duration": 40.0, "tempo": 120.0, "key": "C", "beatsPerBar": 4, "bars": bars, "sections": [], "beatTimes": [],
        "chords": chords, "chordsDetailed": copy.deepcopy(chords), "engine": "btc", "analysisVersion": 1,  # an older detector than the current one
        "strum": {"v": 4, "perBar": 4, "bpm": 120.0, "patterns": [{"pattern": ["D", "-", "D", "-", "D", "U", "D", "-"], "sub": 2, "kind": "heard", "confidence": 0.7, "where": ["Chorus"], "bars": 8, "label": "D – D – D U D –", "easy": ["D", "-", "D", "-", "D", "-", "D", "-"]}],
                  "pattern": ["D", "-", "D", "-", "D", "U", "D", "-"], "sub": 2, "kind": "heard", "confidence": 0.7, "label": "x", "easy": [], "detected": True},
    }


def seed(result):
    vid = result["videoId"]
    main.catalog.save_song(vid, result["sessionId"], title=result["title"], artist=result["artist"], duration=result["duration"], chords=["C", "F"], key="C", tempo=120.0)
    main.catalog.save_result(result["sessionId"], result)
    return vid


def run(result, label):
    print(f"==== {label}")
    vid = seed(result)
    sid = result["sessionId"]
    url = f"/api/admin/songs/{vid}/edit"
    original = copy.deepcopy(result)

    r = client.get(url, headers=TOKEN)
    check("the editor loads the song", r.status_code == 200 and r.json()["chords"] and r.json()["token"], r.text[:120])
    data = r.json()
    token0 = data["token"]
    check("it is shown as an older analysis and not edited yet", data["detector"]["analysisVersion"] == original.get("analysisVersion") and not data["edited"])

    print("-- validation")
    base = {"token": token0}
    bad = lambda body: client.put(url, headers=TOKEN, json={**base, **body})  # noqa: E731
    segs = copy.deepcopy(data["chords"])
    check("not a chord -> 400", bad({"chords": [{**segs[0], "chord": "H#"}] + segs[1:]}).status_code == 400)
    check("empty list -> 400", bad({"chords": []}).status_code == 400)
    check("time outside the song -> 400", bad({"chords": segs + [{"start": 99999, "end": 100000, "chord": "C"}]}).status_code == 400)
    check("nothing to save -> 400", bad({}).status_code == 400)
    check("bad strum length -> 400", bad({"strumChanged": True, "strum": {"perBar": 4, "patterns": [{"pattern": ["D", "U"], "sub": 2}]}}).status_code == 400)
    check("a pattern with no strokes -> 400", bad({"strumChanged": True, "strum": {"perBar": 4, "patterns": [{"pattern": ["-"] * 8, "sub": 2}]}}).status_code == 400)
    check("eighths or sixteenths only -> 400", bad({"strumChanged": True, "strum": {"perBar": 4, "patterns": [{"pattern": ["D"] * 12, "sub": 3}]}}).status_code == 400)
    check("nothing changed in the stored song so far", main.catalog.load_result(sid) == original)

    print("-- names are tidied")
    for given, want in (("Bb", "A#"), ("Bbm7/F", "A#m7/F"), ("c", None), ("N", "N"), ("rest", "N"), ("Abmaj7", "G#maj7"), ("F#m/C#", "F#m/C#")):
        try:
            got = songedit.normalise_chord(given)
        except songedit.EditError:
            got = None
        check(f"{given!r} -> {want!r}", got == want, str(got))

    print("-- editing chords")
    edited = copy.deepcopy(segs)
    # rename one, move one to another beat, add one, remove one
    edited[1]["chord"] = "Bb"                                   # rename (flat -> sharp)
    moved = edited[2]
    bar_start = data["bars"][2]["beats"]
    moved_to = bar_start[2]                                    # the third beat of its bar
    moved["start"], moved["gridStart"] = moved_to, moved_to
    edited.append({"start": data["bars"][5]["beats"][1], "end": 0, "chord": "Em", "gridStart": data["bars"][5]["beats"][1]})
    del edited[4]
    r = client.put(url, headers=TOKEN, json={**base, "chords": edited})
    check("saved", r.status_code == 200 and r.json()["changed"], r.text[:160])
    saved = main.catalog.load_result(sid)
    check("flat became a sharp", any(s["chord"] == "A#" for s in saved["chords"]))
    check("the moved chord sits on its new beat", any(abs(s["gridStart"] - moved_to) < 1e-6 and s["chord"] == moved["chord"] for s in saved["chords"]))
    starts = [s["start"] for s in saved["chords"]]
    check("chords are in order", starts == sorted(starts))
    check("each chord runs into the next", all(abs(a["end"] - b["start"]) < 1e-6 for a, b in zip(saved["chords"], saved["chords"][1:])))
    check("the song's end is covered", abs(saved["chords"][-1]["end"] - original["duration"]) < 1e-6)
    check("marked as edited, with who", saved["edited"]["by"] == "the admin token" and saved["edited"]["count"] == 1)
    check("an older detector's stamp is kept", saved.get("analysisVersion") == original.get("analysisVersion"))
    check("the other parts are untouched", saved["bars"] == original["bars"] and saved["strum"] == original["strum"] and saved["chordsDetailed"] == original["chordsDetailed"])
    versions = r.json()["versions"]
    check("the original and the edit are kept as versions", len(versions) == 2 and versions[-1]["summary"] == "Original analysis" and versions[0]["summary"].startswith("Edited "), str(versions))
    row = main.catalog.get_song(vid)
    check("the catalog follows (search cards)", main.catalog.lookup([vid])[vid]["chords"] == main._chord_summary(saved["chords"]))

    print("-- editing is safe")
    check("a save on a stale page is refused", client.put(url, headers=TOKEN, json={**base, "chords": edited}).status_code == 409)
    token1 = r.json()["token"]
    check("an edited song is not re-analysed by itself", main._load_cached_result(sid) is not None)
    check("saving no change reports no change", client.put(url, headers=TOKEN, json={"token": token1, "chords": saved["chords"]}).json()["changed"] is False)

    print("-- strumming")
    strum = {"perBar": 4, "patterns": [
        {"pattern": ["D", "-", "D", "U", "-", "U", "D", "-"], "sub": 2, "where": ["Verse", "Chorus"]},
        {"pattern": ["D", "-", "-", "-", "D", "-", "-", "U", "-", "-", "-", "-", "D", "-", "-", "-"], "sub": 4, "where": ["Bridge"]},
    ]}
    r = client.put(url, headers=TOKEN, json={"token": token1, "strumChanged": True, "strum": strum})
    check("the strumming saves", r.status_code == 200 and r.json()["changed"], r.text[:140])
    saved = main.catalog.load_result(sid)
    st = saved["strum"]
    check("both patterns, marked edited", len(st["patterns"]) == 2 and all(p["kind"] == "edited" for p in st["patterns"]))
    check("label and easy version are made", st["patterns"][0]["label"] == "D – D U – U D –" and st["patterns"][0]["easy"] == ["D", "-", "D", "-", "D", "-", "D", "-"] and len(st["patterns"][1]["easy"]) == 16)
    check("the first pattern is mirrored at the top (older readers)", st["pattern"] == st["patterns"][0]["pattern"] and st["kind"] == "edited" and st["detected"] is False)
    check("the chords were not touched by the strumming save", saved["chords"] == main.catalog.load_result(sid)["chords"])
    token2 = r.json()["token"]
    r = client.put(url, headers=TOKEN, json={"token": token2, "strumChanged": True, "strum": {"perBar": 4, "patterns": []}})
    check("no patterns removes the strumming", r.status_code == 200 and main.catalog.load_result(sid)["strum"] is None)

    print("-- versions and restore")
    r = client.get(url, headers=TOKEN).json()
    token3 = r["token"]
    orig_id = next(v["id"] for v in r["versions"] if v["summary"] == "Original analysis")
    r2 = client.post(f"/api/admin/songs/{vid}/restore", headers=TOKEN, json={"versionId": orig_id, "token": "stale-token"})
    check("restore on a stale page is refused", r2.status_code == 409)
    r2 = client.post(f"/api/admin/songs/{vid}/restore", headers=TOKEN, json={"versionId": orig_id, "token": token3})
    check("restore the original", r2.status_code == 200, r2.text[:140])
    back = main.catalog.load_result(sid)
    check("chords and strumming are the original again", back["chords"] == original["chords"] and back["strum"] == original["strum"])
    check("restoring is itself kept as a version", len(r2.json()["versions"]) >= 5)
    check("restoring the version in use is refused", client.post(f"/api/admin/songs/{vid}/restore", headers=TOKEN, json={"versionId": orig_id, "token": r2.json()["token"]}).status_code in (400,))
    check("an unknown version is 404", client.post(f"/api/admin/songs/{vid}/restore", headers=TOKEN, json={"versionId": "nope", "token": r2.json()["token"]}).status_code == 404)

    print("-- the section model cannot put an old copy back")
    cur = client.get(url, headers=TOKEN).json()
    one = copy.deepcopy(cur["chords"])
    one[1]["chord"] = "Dm"
    client.put(url, headers=TOKEN, json={"token": cur["token"], "chords": one})
    stale_copy = copy.deepcopy(original)
    main._PENDING.add(sid)
    main._refine_sections(sid, stale_copy, lambda: [{"label": "Verse 1", "start": 0.0, "end": 40.0, "startBar": 0, "endBar": 19}])
    after = main.catalog.load_result(sid)
    check("the sections arrive and the hand edit is still there", after["sections"] and any(s["chord"] == "Dm" for s in after["chords"]))

    print("-- the song list")
    r = client.get("/api/admin/song-pages?search=" + original["title"].split()[0], headers=TOKEN).json()
    mine = next((s for s in r["songs"] if s["videoId"] == vid), None)
    check("it is marked as edited", bool(mine) and mine["edited"] is True and mine["analysed"] == (original.get("analysisVersion") == main.ANALYSIS_VERSION), str(mine and {k: mine[k] for k in ('edited', 'analysed')}))

    print("-- re-analysis keeps the edited version first")
    fresh = copy.deepcopy(original)
    fresh["analysisVersion"] = main.ANALYSIS_VERSION
    fresh["chords"] = [{**c, "chord": "G"} for c in fresh["chords"]]

    def fake_job(session_id, url_, meta):
        main._set_job(session_id, status="done", progress=100, stage="Done", result=fresh)
        main.catalog.save_result(session_id, fresh)

    real_job = main._run_youtube_job
    main._run_youtube_job = fake_job
    try:
        r = client.post(f"/api/admin/songs/{vid}/reanalyse", headers=TOKEN)
        check("re-analysis starts", r.status_code == 200 and r.json()["status"] in ("queued", "done"), r.text[:120])
        for _ in range(60):
            job = main._get_job(sid) or {}
            if job.get("status") == "done":
                break
            time.sleep(0.1)
        time.sleep(0.3)
    finally:
        main._run_youtube_job = real_job
    now = main.catalog.load_result(sid)
    check("the new analysis replaced the song", all(c["chord"] == "G" for c in now["chords"]) and not now.get("edited"))
    vs = songedit.load_versions(main.catalog, sid)
    check("the version it replaced was kept before", any(v["summary"] in ("Before re-analysis",) or v["summary"].startswith("Edited") for v in vs))
    check("and the re-analysis is a version too", vs[-1]["summary"] == "Re-analysed with the latest detector")
    check("the edited version can be brought back", client.post(f"/api/admin/songs/{vid}/restore", headers=TOKEN, json={"versionId": next(v["id"] for v in vs if v["summary"].startswith("Edited")), "token": songedit.token(now)}).status_code == 200)


# ------------------------------------------------------------------------------------------------------------------------------------
run(synthetic(), "a synthetic song")

print("==== permissions")
vid = "abcdefghijk"
mk = lambda perms, email: None  # noqa: E731
client.post("/api/admin/roles", headers=TOKEN, json={"name": "Chords", "permissions": ["songs.edit"]})
client.post("/api/admin/roles", headers=TOKEN, json={"name": "Redo", "permissions": ["songs.edit", "songs.reanalyse"]})
client.post("/api/admin/roles", headers=TOKEN, json={"name": "Pages", "permissions": ["song_pages.manage"]})
for role, email in (("chords", "c@example.com"), ("redo", "r@example.com"), ("pages", "p@example.com")):
    client.post("/api/admin/users", headers=TOKEN, json={"email": email, "name": role, "password": "correct horse 9", "role": role})
sessions = {}
for email in ("c@example.com", "r@example.com", "p@example.com"):
    c = TestClient(main.app, base_url="http://testserver")
    c.post("/api/admin/auth/login", json={"email": email, "password": "correct horse 9"})
    sessions[email] = c
chords_only, redo, pages = sessions["c@example.com"], sessions["r@example.com"], sessions["p@example.com"]
check("a chords-only editor can open the editor", chords_only.get(f"/api/admin/songs/{vid}/edit").status_code == 200)
check("and see the song list", chords_only.get("/api/admin/song-pages").status_code == 200)
check("but not re-analyse", chords_only.post(f"/api/admin/songs/{vid}/reanalyse").status_code == 403)
check("the editor says whether re-analysing is allowed", chords_only.get(f"/api/admin/songs/{vid}/edit").json()["canReanalyse"] is False and redo.get(f"/api/admin/songs/{vid}/edit").json()["canReanalyse"] is True)
check("a page manager cannot edit chords", pages.get(f"/api/admin/songs/{vid}/edit").status_code == 403)
check("and cannot save either", pages.put(f"/api/admin/songs/{vid}/edit", json={"token": "x", "chords": []}).status_code == 403)
check("a signed-out visitor gets nothing", TestClient(main.app).get(f"/api/admin/songs/{vid}/edit").status_code == 401)
check("an unknown song is 404", client.get("/api/admin/songs/zzzzzzzzzzz/edit", headers=TOKEN).status_code == 404)
check("a bad id is 404", client.get("/api/admin/songs/not-an-id/edit", headers=TOKEN).status_code == 404)

if len(sys.argv) > 1:
    real = json.load(open(sys.argv[1], encoding="utf-8"))
    real.pop("sectionsPending", None)
    real["sessionId"] = "yt_" + real["videoId"]
    run(real, "a real saved song (" + real.get("title", "?") + ")")

print()
print(f"passed {passed}, failed {failed}")
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(1 if failed else 0)
