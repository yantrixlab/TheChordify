"""The title and heading of a published song page: a song whose saved title already says "chords" is not given "Chords, Key & BPM" twice.

Run from backend/ after the site is built:   python scripts/check_song_titles.py
"""
import os
import re
import shutil
import sys
import tempfile

tmp = tempfile.mkdtemp(prefix="songtitles-test-")
os.environ["DATA_DIR"] = tmp
os.environ["ADMIN_TOKEN"] = "tok-" + "x" * 30
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from app import main  # noqa: E402
import _pg_guard  # noqa: E402

_pg_guard.install(main)

template = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "absolute-ablation", "dist", "song-template", "index.html")
if not os.path.exists(template):
    print("build the site first (npm run build in absolute-ablation)")
    sys.exit(2)
pages = main.song_pages
pages._template_path = template
passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


def make(vid, title, artist="Some Artist", saved_title=None):
    main.catalog.save_song(vid, "yt_" + vid, title=title, artist=artist, duration=200, chords=["C", "G", "Am", "F"], key="C", tempo=100.0)
    main.catalog.save_result("yt_" + vid, {"sessionId": "yt_" + vid, "videoId": vid, "title": title, "chords": [], "analysisVersion": main.ANALYSIS_VERSION})
    page = pages.publish(vid, title=saved_title or title, artist=artist)
    html = pages.render_song(page["slug"])
    return (re.search(r"<title>(.*?)</title>", html, re.S).group(1), re.search(r"<h1>(.*?)</h1>", html, re.S).group(1))


t, h = make("aaaaaaaaaaa", "Hotel California", "Eagles")
check("a plain title gets Chords, Key & BPM, the artist and the site name", t == "Hotel California Chords, Key &amp; BPM — Eagles | Chord Suno", t)
check("and its heading says chords", h == "Hotel California chords", h)

t, h = make("bbbbbbbbbbb", "The Reason", "Hoobastank", saved_title="The Reason Chords – Hoobastank | Easy Guitar Guide (E, C#m, A, B, D)")
check("a title that already says chords is kept as it is, with the site name added", t == "The Reason Chords – Hoobastank | Easy Guitar Guide (E, C#m, A, B, D) | Chord Suno", t)
check("and its heading does not say chords twice", h == "The Reason Chords – Hoobastank | Easy Guitar Guide (E, C#m, A, B, D)", h)

t, h = make("ccccccccccc", "Mama Chords", "Bjorn", saved_title="Mama Chords | Chord Suno")
check("a title that already names the site is not given it twice", t == "Mama Chords | Chord Suno", t)

print()
print(f"passed {passed}, failed {failed}")
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(1 if failed else 0)
