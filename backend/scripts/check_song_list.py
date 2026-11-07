"""The admin's list of songs: the song chordified last comes first, the sorts, the quick filters and the counts.

Run from backend/:   python scripts/check_song_list.py
"""
import os
import shutil
import sys
import tempfile
import time

tmp = tempfile.mkdtemp(prefix="songlist-test-")
os.environ["DATA_DIR"] = tmp
os.environ["ADMIN_TOKEN"] = "tok-" + "x" * 30
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


db = main.catalog.db
now = time.time()
# five songs, chordified one day apart (a is the oldest), with different plays and titles
SONGS = [("aaaaaaaaaaa", "Zebra", 5, 50), ("bbbbbbbbbbb", "Apple", 40, 40), ("ccccccccccc", "Mango", 1, 30), ("ddddddddddd", "Banana", 9, 20), ("eeeeeeeeeee", "Cherry", 0, 10)]
for i, (vid, title, jams, days_ago) in enumerate(SONGS):
    main.catalog.save_song(vid, "yt_" + vid, title=title, artist="Artist " + title, duration=100, chords=["C", "G"], key="C", tempo=100.0)
    db.run("UPDATE songs SET created_at = ?, updated_at = ?, jams = ? WHERE video_id = ?", (now - days_ago * 86400, now - (days_ago - 1) * 86400, jams, vid))
    main.catalog.save_result("yt_" + vid, {"sessionId": "yt_" + vid, "videoId": vid, "title": title, "chords": [], "analysisVersion": main.ANALYSIS_VERSION})


def listing(**q):
    q.setdefault("pageSize", 100)
    r = client.get("/api/admin/song-pages", params=q, headers=TOKEN)
    assert r.status_code == 200, r.text
    return r.json()


def ids(data):
    return [s["videoId"][0] for s in data["songs"]]  # the first letter says which song


print("== the order")
check("the song chordified last is first by default", ids(listing()) == list("edcba"), str(ids(listing())))
check("newest is the same as the default", ids(listing(sort="newest")) == list("edcba"))
check("oldest puts the first one first", ids(listing(sort="oldest")) == list("abcde"))
check("most played", ids(listing(sort="played")) == list("bdace"), str(ids(listing(sort="played"))))
check("title A to Z", ids(listing(sort="title")) == ["b", "d", "e", "c", "a"], str(ids(listing(sort="title"))))
check("recently updated puts the last touched first", ids(listing(sort="updated")) == list("edcba"))
check("an unknown sort falls back to newest", ids(listing(sort="rubbish")) == list("edcba"))
check("a published song does not jump the queue any more", (main.song_pages.publish("aaaaaaaaaaa"), ids(listing()))[1] == list("edcba"))
check("each song says when it was chordified", all(isinstance(s["chordifiedAt"], float) and s["chordifiedAt"] > 0 for s in listing()["songs"]))
check("pages follow the order without repeating a song", ids(listing(pageSize=2, page=1)) + ids(listing(pageSize=2, page=2)) + ids(listing(pageSize=2, page=3)) == list("edcba"))

print("== status and time")
check("published only", ids(listing(status="published")) == ["a"])
check("not published only", ids(listing(status="unpublished")) == list("edcb"))
check("chordified in the last 15 days", ids(listing(since=now - 15 * 86400)) == ["e"], str(ids(listing(since=now - 15 * 86400))))
check("chordified in the last 35 days", ids(listing(since=now - 35 * 86400)) == list("edc"), str(ids(listing(since=now - 35 * 86400))))
check("chordified between 25 and 45 days ago", ids(listing(since=now - 45 * 86400, until=now - 25 * 86400)) == list("cb"), str(ids(listing(since=now - 45 * 86400, until=now - 25 * 86400))))
check("search by title", ids(listing(search="mang")) == ["c"])

print("== the counts above the list")
data = listing(status="unpublished")
check("they are the whole catalog whatever is filtered", data["counts"] == {"all": 5, "published": 1, "notPublished": 4}, str(data["counts"]))
check("while the total is what the filter shows", data["total"] == 4)

print("== quick filters")
main.catalog.save_result("yt_ccccccccccc", {**main.catalog.load_result("yt_ccccccccccc"), "edited": {"at": now, "by": "x", "count": 1}})
main.catalog.save_result("yt_ddddddddddd", {**main.catalog.load_result("yt_ddddddddddd"), "analysisVersion": 1})
main.catalog.save_result("yt_eeeeeeeeeee", {**main.catalog.load_result("yt_eeeeeeeeeee"), "analysisVersion": 1})
check("edited by hand", ids(listing(flag="edited")) == ["c"], str(ids(listing(flag="edited"))))
check("older analysis (not the current detector, not edited)", ids(listing(flag="older")) == ["e", "d"], str(ids(listing(flag="older"))))
songedit.set_strum_edit(main.catalog, "bbbbbbbbbbb", False)
songedit.set_strum_edit(main.catalog, "aaaaaaaaaaa", True)
check("listeners may not edit the strumming", ids(listing(flag="strumoff")) == ["b"], str(ids(listing(flag="strumoff"))))
flags = {s["videoId"][0]: s["strumEdit"] for s in listing()["songs"]}
check("the row says so (and the others are on)", flags == {"a": True, "b": False, "c": True, "d": True, "e": True}, str(flags))
check("a filter and a status together", ids(listing(flag="older", status="published")) == [])
check("a filter and a sort together", ids(listing(flag="older", sort="oldest")) == ["d", "e"], str(ids(listing(flag="older", sort="oldest"))))
check("an unknown filter is ignored", ids(listing(flag="rubbish")) == list("edcba"))
check("the total follows the filter", listing(flag="older")["total"] == 2)
check("signed out gets nothing", TestClient(main.app).get("/api/admin/song-pages").status_code == 401)

print()
print(f"passed {passed}, failed {failed}")
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(1 if failed else 0)
