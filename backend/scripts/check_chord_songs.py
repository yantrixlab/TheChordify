"""Songs that use a chord: the tables agree with the website's chord catalogue, a chord page gets its songs, a song page links to its chords.

Run from backend/:   python scripts/check_chord_songs.py
If the website has been built (absolute-ablation/dist), every one of its 1,344 chord pages is checked too.
"""
import os
import re
import shutil
import sys
import tempfile

tmp = tempfile.mkdtemp(prefix="chordsongs-test-")
static = os.path.join(tmp, "static")
os.makedirs(os.path.join(static, "guitar-chords", "c", "major"))
os.makedirs(os.path.join(static, "guitar-chords", "f-sharp", "half-diminished"))
os.makedirs(os.path.join(static, "song-template"))
SLOT = '<div class="cs-songs-slot" data-chord="{}"></div>'
for path, chord in (("c/major", "C:"), ("f-sharp/half-diminished", "F#:m7b5")):
    with open(os.path.join(static, "guitar-chords", *path.split("/"), "index.html"), "w", encoding="utf-8") as f:
        f.write(f"<html><body><main><h1>{chord}</h1>{SLOT.format(chord)}<section id=more></section></main></body></html>")
with open(os.path.join(static, "404.html"), "w", encoding="utf-8") as f:
    f.write("<html><body>This page is out of tune.</body></html>")
with open(os.path.join(static, "song-template", "index.html"), "w", encoding="utf-8") as f:
    f.write('<html><head><title>__SP_TITLE__</title><meta name="robots" content="index"></head><body>__SP_BODY__</body></html>')

os.environ["DATA_DIR"] = tmp
os.environ["STATIC_DIR"] = static
os.environ["ADMIN_TOKEN"] = "tok-" + "x" * 30
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from fastapi.testclient import TestClient  # noqa: E402

from app import chordsongs, main  # noqa: E402
import _pg_guard  # noqa: E402

_pg_guard.install(main)
passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


print("== the tables agree with the website's chord catalogue")
catalog = os.path.join(HERE, "..", "..", "absolute-ablation", "src", "lib", "chordCatalog.ts")
if os.path.exists(catalog):
    ts = open(catalog, encoding="utf-8").read()
    roots = {m.group(1): m.group(2) for m in re.finditer(r'\{ name: "([A-G]#?)", short: "[^"]+", label: "[^"]+", slug: "([a-z-]+)"', ts)}
    check("the twelve notes and their addresses", roots == {k: v[0] for k, v in chordsongs.ROOTS.items()} and len(roots) == 12, str(roots))
    kinds = {m.group(1): m.group(2) for m in re.finditer(r'\{ suffix: "([^"]*)", id: "([a-z0-9-]+)"', ts)}
    check("the kinds of chord and their addresses", kinds == chordsongs.KINDS and len(kinds) == 28, f"{len(kinds)} vs {len(chordsongs.KINDS)}")
else:
    print("  (chordCatalog.ts not found: skipped)")

print("== reading a chord name")
p = chordsongs.parse_chord
check("C#m7", p("C#m7") == ("C#", "m7"))
check("plain C", p("C") == ("C", ""))
check("a slash chord is left out", p("C/E") is None)
check("no chord", p("N") is None and p("") is None)
check("a kind the pages do not have", p("Cadd11") is None)
check("a flat name is not the site's spelling", p("Bb") is None)
check("page address", chordsongs.chord_page("F#m7b5") == "/guitar-chords/f-sharp/half-diminished/")
check("page address on another instrument", chordsongs.chord_page("Am", "ukulele") == "/ukulele-chords/a/minor/")
check("no page for a slash chord", chordsongs.chord_page("G/B") is None)


def seed(video_id, title, artist, chords, plays):
    sid = "yt_" + video_id
    main.catalog.save_song(video_id, sid, title=title, artist=artist, duration=200.0, chords=chords, key="C", tempo=100.0)
    main.catalog.save_result(sid, {"sessionId": sid, "videoId": video_id, "title": title, "artist": artist, "duration": 200.0, "tempo": 100.0, "key": "C", "chords": []})
    for _ in range(plays):
        main.catalog.add_jam(video_id)
    return main.song_pages.publish(video_id, title=title, artist=artist)


seed("aaaaaaaaaaa", "Quiet Song", "A Band", ["C", "G", "Am", "F"], 1)
seed("bbbbbbbbbbb", "Loud Song", "B Band", ["C", "Dm7", "G/B"], 5)
main.catalog.save_song("ccccccccccc", "yt_ccccccccccc", title="Hidden", artist="X", duration=100.0, chords=["C", "Em"], key="C", tempo=90.0)  # not published
client = TestClient(main.app, base_url="http://testserver")

print("== a chord page gets the songs that use it")
r = client.get("/guitar-chords/c/major/")
check("the page is served", r.status_code == 200, str(r.status_code))
check("the slot is gone", "cs-songs-slot" not in r.text)
check("it says which chord", "Songs that use C" in r.text)
check("both published songs are listed", "Quiet Song" in r.text and "Loud Song" in r.text)
check("the song that is played more comes first", r.text.index("Loud Song") < r.text.index("Quiet Song"))
check("a song that is not published is not listed", "Hidden" not in r.text)
check("it links to the song page", 'href="/songs/quiet-song-a-band-chords/"' in r.text, r.text[r.text.find("cs-song") : r.text.find("cs-song") + 200])
check("the count is right", "played in 2 songs" in r.text)
check("the block sits before the next section", r.text.index("cs-songs") < r.text.index("id=more"))
check("it can be cached for a few minutes", "max-age=300" in r.headers.get("cache-control", ""))
other = client.get("/guitar-chords/f-sharp/half-diminished/")
check("a chord no song uses has no block and no leftover slot", other.status_code == 200 and "cs-songs" not in other.text)

print("== addresses that are not chord pages")
missing = client.get("/guitar-chords/c/nonsense/")
check("a chord page the site does not have is the site's 404", missing.status_code == 404 and "out of tune" in missing.text)
check("another note", client.get("/guitar-chords/zz/major/").status_code == 404)
check("nothing escapes the site folder", client.get("/guitar-chords/..%2f..%2fsecret/major/").status_code in (404, 422))

print("== a song page links its chords to their pages")
page = client.get("/songs/loud-song-b-band-chords/")
check("the song page is served", page.status_code == 200, str(page.status_code))
check("a chord with a page is a link", '<a href="/guitar-chords/c/major/"' in page.text)
check("a minor 7th is a link", "/guitar-chords/d/minor-seventh/" in page.text)

print("== the songs are a bonus: a failure never breaks the chord page")
original = main.chord_songs.fill
main.chord_songs.fill = lambda html: 1 / 0
broken = client.get("/guitar-chords/c/major/")
main.chord_songs.fill = original
check("the page is still served, with the slot taken out", broken.status_code == 200 and "cs-songs-slot" not in broken.text and "<h1>C:</h1>" in broken.text)

print("== the built website")
dist = os.path.join(HERE, "..", "..", "absolute-ablation", "dist")
if os.path.isdir(os.path.join(dist, "guitar-chords", "c", "major")):
    bad, total = [], 0
    for inst in chordsongs.INSTRUMENTS:
        for root, (slug, _) in chordsongs.ROOTS.items():
            for suffix, kind_id in chordsongs.KINDS.items():
                total += 1
                f = os.path.join(dist, f"{inst}-chords", slug, kind_id, "index.html")
                if not os.path.exists(f):
                    bad.append(f"{inst}/{slug}/{kind_id}: no page")
                    continue
                html = open(f, encoding="utf-8").read()
                found = re.findall(r'<div class="cs-songs-slot" data-chord="([^"]*)"></div>', html)
                if found != [f"{root}:{suffix}"]:
                    bad.append(f"{inst}/{slug}/{kind_id}: slot {found}")
    check(f"all {total} chord pages have one slot that names their chord", total == 1344 and not bad, "; ".join(bad[:5]))
else:
    print("  (the site is not built: skipped)")

shutil.rmtree(tmp, ignore_errors=True)
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
