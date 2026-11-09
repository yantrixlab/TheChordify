"""The home page's extra shelves: songs for the visitor's taste, the popular songs of their country, and the artists.

YouTube Music is replaced by canned answers, so this runs offline.

Run from backend/:   python scripts/check_home_extras.py
"""
import os
import shutil
import sys
import tempfile

tmp = tempfile.mkdtemp(prefix="homeextras-test-")
os.environ["DATA_DIR"] = tmp
os.environ["ADMIN_TOKEN"] = "tok-" + "x" * 30
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from fastapi.testclient import TestClient  # noqa: E402

from app import discover, main  # noqa: E402
import _pg_guard  # noqa: E402

_pg_guard.install(main)

client = TestClient(main.app, base_url="http://testserver")
passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


def song(vid, title="Song", artist="Artist"):
    return {"videoId": vid, "kind": "song", "title": title, "artist": artist, "album": "", "duration": 200, "thumbnail": "https://x/y.jpg"}


calls = {"country": [], "taste": [], "artists": []}


def fake_country(code):
    calls["country"].append(code)
    return [song("a" * 11, "One"), song("b" * 11, "Two")] if code in ("IN", "GB") else []


def fake_artists(code):
    calls["artists"].append(code)
    return [{"name": "Somebody", "image": "https://x/p.jpg", "id": "UC1", "subscribers": "1M"}]


def fake_taste(seeds, skip):
    calls["taste"].append((list(seeds), set(skip)))
    return [song("c" * 11, "Like it")], ["Seed Song"]


discover.country_songs = fake_country
discover.artists = fake_artists
discover.taste = fake_taste
discover.supported = lambda code: code in ("IN", "GB", "US", "ZZ")

print("country")
r = client.get("/api/home/country", params={"country": "in"})
check("asked for India: its songs", r.status_code == 200 and [s["title"] for s in r.json()["songs"]] == ["One", "Two"] and r.json()["country"] == "IN", r.text)
check("the answer is private to the visitor", "private" in r.headers.get("cache-control", ""))
r = client.get("/api/home/country", params={"country": "in"}, headers={"CF-IPCountry": "GB"})
check("a country header from the server in front wins over the browser's guess", r.json()["country"] == "GB" and calls["country"][-1] == "GB", r.text)
r = client.get("/api/home/country")
check("no country at all: no songs, not an error", r.status_code == 200 and r.json()["songs"] == [], r.text)
r = client.get("/api/home/country", params={"country": "x1"})
check("a made-up country: no songs", r.status_code == 200 and r.json()["songs"] == [])
r = client.get("/api/home/country", params={"country": "ZZZ"})
check("a code that is not two letters is ignored", r.json()["songs"] == [] and r.json()["country"] == "")

print("artists")
r = client.get("/api/home/artists", params={"country": "gb"})
check("the artists of the country", r.status_code == 200 and r.json()["artists"][0]["name"] == "Somebody" and calls["artists"][-1] == "GB", r.text)
r = client.get("/api/home/artists")
check("no country: the world's artists", r.json()["artists"] and calls["artists"][-1] == "ZZ", str(calls["artists"]))

print("taste")
r = client.get("/api/home/taste")
check("no history, nothing to base it on: no songs", r.status_code == 200 and r.json() == {"songs": [], "basedOn": []}, r.text)
check("and nothing was asked of YouTube Music", calls["taste"] == [])
seeds = ",".join(["d" * 11, "e" * 11, "f" * 11, "g" * 11, "h" * 11, "not-an-id"])
r = client.get("/api/home/taste", params={"seeds": seeds})
sent = calls["taste"][-1] if calls["taste"] else ([], set())
check("a browser's recent songs make a shelf", r.status_code == 200 and r.json()["songs"][0]["title"] == "Like it" and r.json()["basedOn"] == ["Seed Song"], r.text)
check("at most four seeds, only real video ids", sent[0] == ["d" * 11, "e" * 11, "f" * 11, "g" * 11], str(sent))
check("the songs it already played are left out", {"d" * 11, "e" * 11}.issubset(sent[1]), str(sent))
check("never cached for the others", r.headers.get("cache-control") == "private, no-store", r.headers.get("cache-control"))

print("signed in")
real_user, real_list = main._session_user, main.engagement.list_items
main._session_user = lambda request: {"id": "u1"}
LIB = {
    "favorites": [{"videoId": "F" * 11}, {"videoId": "G" * 11}],
    "history": [{"videoId": "H" * 11}, {"videoId": ""}, {"videoId": "I" * 11}, {"videoId": "J" * 11}],
}
main.engagement.list_items = lambda uid, tab, limit, offset: (LIB[tab][:limit], len(LIB[tab]))
r = client.get("/api/home/taste", params={"seeds": "k" * 11})
sent = calls["taste"][-1]
check("their library is the source: recent plays and favourites in turns, newest first", sent[0] == ["H" * 11, "F" * 11, "G" * 11, "I" * 11], str(sent[0]))
check("everything in the library is left out of the shelf", {"F" * 11, "G" * 11, "H" * 11, "I" * 11, "J" * 11, "k" * 11}.issubset(sent[1]), str(sent[1]))
main._session_user, main.engagement.list_items = real_user, real_list

print()
print(f"{passed} passed, {failed} failed")
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(1 if failed else 0)
