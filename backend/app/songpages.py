"""Public song pages: one indexable page per song that an admin has approved.

A song in the catalog gets a page at /songs/<name>-<artist>-chords/ only when an admin publishes it (Admin > Song pages), so
search engines are shown songs that have been looked at, not every analysis that ever ran. The page is written from the
song's stored analysis (key, tempo, bar length, chords, and the chords of each section) and wrapped in the site's own header,
footer and styles: the web build leaves a page called song-template, and this module fills it in.

Only the song's name and artist, its facts and its chords are shown. No lyrics.
"""

from __future__ import annotations

import html
import json
import logging
import os
import re
import time
import unicodedata
from typing import Optional

log = logging.getLogger("chordify.songpages")

SITE = "https://chordsuno.com"

_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS song_pages (
        video_id     TEXT PRIMARY KEY,
        slug         TEXT NOT NULL UNIQUE,
        title        TEXT NOT NULL DEFAULT '',
        artist       TEXT NOT NULL DEFAULT '',
        intro        TEXT NOT NULL DEFAULT '',
        published_at DOUBLE PRECISION NOT NULL,
        updated_at   DOUBLE PRECISION NOT NULL
    )
    """,
]

# Chords that need a barre (or a stretch): they push a song up a level.
_BARRE = {"F", "Fm", "Bm", "B", "Bb", "Cm", "Gm", "F#m", "C#m", "G#m", "Ab", "Eb", "Db", "Abm", "Ebm", "Bbm", "F#", "C#"}

_JUNK = r"official|audio|video|lyric|lyrical|lyrics|full song|full video|hd|4k|visuali[sz]er|music video|mv|song|remastered"


def _fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")


def slugify(text: str) -> str:
    """Lower-case words joined by hyphens, in plain ASCII ("Tum Hi Ho" -> "tum-hi-ho"). Empty when nothing Latin is left."""
    return re.sub(r"[^a-z0-9]+", "-", _fold(text).lower()).strip("-")[:80].strip("-")


def clean_title(raw: str) -> str:
    """The song's name without the noise YouTube titles carry: catalogue numbers, "(Official Video)", "| Audio"..."""
    t = (raw or "").strip()
    t = re.sub(r"^\s*\d{4,}\s*", "", t)  # a leading catalogue number
    t = re.sub(r"[\(\[][^)\]]*\b(?:%s)\b[^)\]]*[\)\]]" % _JUNK, "", t, flags=re.I)
    t = re.split(r"\s*[|｜]\s*", t)[0] if re.search(r"\|", t) and len(t.split("|")[0].strip()) >= 2 else t
    t = re.sub(r"\s*[-–—]\s*(?:%s)\b.*$" % _JUNK, "", t, flags=re.I)
    t = re.sub(r"\b(?:official\s+)?(?:%s)\s*$" % _JUNK, "", t, flags=re.I)
    t = t.replace("(", " ").replace(")", " ").replace("[", " ").replace("]", " ")
    return re.sub(r"\s+", " ", t).strip(" -–—|")


def difficulty(chords: list[str]) -> str:
    unique = list(dict.fromkeys(c for c in chords if c and c != "N"))
    base = {re.split(r"/", c)[0] for c in unique}
    score = len(unique) + 2 * sum(1 for c in base if c in _BARRE)
    return "Beginner" if score <= 5 else "Intermediate" if score <= 10 else "Advanced"


def _minutes(seconds: float) -> str:
    s = int(round(seconds))
    return f"{s // 60}:{s % 60:02d}"


def _iso_duration(seconds: float) -> str:
    s = int(round(seconds))
    return f"PT{s // 60}M{s % 60}S"


def _time_signature(per_bar: int) -> str:
    return "6/8" if per_bar == 6 else f"{per_bar}/4"


def _esc(text: object) -> str:
    return html.escape(str(text), quote=True)


class SongPages:
    def __init__(self, catalog, template_path: str, analysis_version: int = 0) -> None:
        self._catalog = catalog
        self._version = analysis_version
        self._db = catalog.db
        self._template_path = template_path
        for statement in _SCHEMA:
            self._db.run(statement)

    # ----- the admin's side ----------------------------------------------------------------------------------------

    def suggestion(self, song: dict) -> dict:
        title = clean_title(song["title"]) or song["title"]
        artist = song["artist"].strip()
        return {"title": title, "artist": artist, "slug": self._free_slug(slugify(f"{title} {artist} chords"), song["video_id"])}

    def _free_slug(self, wanted: str, video_id: str) -> str:
        base = wanted or f"song-{video_id.lower()}-chords"
        slug, n = base, 1
        while True:
            rows, _ = self._db.run("SELECT video_id FROM song_pages WHERE slug = ?", (slug,))
            if not rows or rows[0]["video_id"] == video_id:
                return slug
            n += 1
            slug = f"{base}-{n}"

    def admin_list(self, search: str = "", page: int = 1, size: int = 25, only_published: bool = False) -> dict:
        where, params = [], []
        if search:
            where.append("(LOWER(s.title) LIKE ? OR LOWER(s.artist) LIKE ?)")
            like = f"%{search.lower()}%"
            params += [like, like]
        if only_published:
            where.append("p.video_id IS NOT NULL")
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        base = f"FROM songs s LEFT JOIN song_pages p ON p.video_id = s.video_id {clause}"
        total, _ = self._db.run(f"SELECT COUNT(*) AS n {base}", tuple(params))
        rows, _ = self._db.run(
            f"""SELECT s.*, p.slug AS page_slug, p.title AS page_title, p.artist AS page_artist, p.intro AS page_intro,
                       p.published_at AS page_published_at
                {base} ORDER BY (p.video_id IS NULL), s.jams DESC, s.updated_at DESC LIMIT ? OFFSET ?""",
            tuple(params) + (size, max(page - 1, 0) * size),
        )
        # which of these songs were analysed by the current detector (the others still open, but an admin can re-analyse them)
        current: set[str] = set()
        if rows:
            keys = [r["session_id"] for r in rows]
            marks = ",".join("?" * len(keys))
            fresh, _ = self._db.run(
                f"SELECT key FROM results WHERE key IN ({marks}) AND data LIKE ?",
                tuple(keys) + (f'%"analysisVersion": {self._version}%',),
            )
            current = {f["key"] for f in fresh}
        songs = []
        for r in rows:
            sug = self.suggestion(r)
            songs.append(
                {
                    "videoId": r["video_id"],
                    "sessionId": r["session_id"],
                    "title": r["title"],
                    "artist": r["artist"],
                    "thumbnail": r["thumbnail"] or f"https://i.ytimg.com/vi/{r['video_id']}/mqdefault.jpg",
                    "chords": json.loads(r["chords"] or "[]"),
                    "key": r["song_key"],
                    "tempo": r["tempo"],
                    "jams": r["jams"],
                    "published": r["page_slug"] is not None,
                    "slug": r["page_slug"] or "",
                    "pageTitle": r["page_title"] if r["page_slug"] else sug["title"],
                    "pageArtist": r["page_artist"] if r["page_slug"] else sug["artist"],
                    "intro": r["page_intro"] or "",
                    "suggestedSlug": sug["slug"],
                    "publishedAt": r["page_published_at"],
                    "analysed": r["session_id"] in current,
                }
            )
        return {"songs": songs, "total": total[0]["n"], "published": self.count()}

    def count(self) -> int:
        rows, _ = self._db.run("SELECT COUNT(*) AS n FROM song_pages")
        return rows[0]["n"]

    def publish(self, video_id: str, *, title: str = "", artist: str = "", slug: str = "", intro: str = "") -> Optional[dict]:
        """Approves a catalog song (or updates its page). None when the song is not in the catalog."""
        rows, _ = self._db.run("SELECT * FROM songs WHERE video_id = ?", (video_id,))
        if not rows:
            return None
        song = rows[0]
        sug = self.suggestion(song)
        title = title.strip()[:120] or sug["title"]
        artist = artist.strip()[:120] if artist.strip() else sug["artist"]
        wanted = slugify(slug) if slug.strip() else slugify(f"{title} {artist} chords")
        final = self._free_slug(wanted, video_id)
        now = time.time()
        self._db.run(
            """
            INSERT INTO song_pages (video_id, slug, title, artist, intro, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(video_id) DO UPDATE SET slug = excluded.slug, title = excluded.title, artist = excluded.artist,
                intro = excluded.intro, updated_at = excluded.updated_at
            """,
            (video_id, final, title, artist, intro.strip()[:1500], now, now),
        )
        return {"slug": final, "title": title, "artist": artist}

    def unpublish(self, video_id: str) -> bool:
        _, changed = self._db.run("DELETE FROM song_pages WHERE video_id = ?", (video_id,))
        return changed > 0

    # ----- what the public sees --------------------------------------------------------------------------------------

    def published(self, limit: int = 500) -> list[dict]:
        rows, _ = self._db.run(
            """SELECT p.*, s.session_id, s.chords, s.song_key, s.tempo, s.jams, s.thumbnail FROM song_pages p
               JOIN songs s ON s.video_id = p.video_id ORDER BY p.published_at DESC LIMIT ?""",
            (limit,),
        )
        return rows

    def sitemap(self) -> str:
        urls = [f"  <url><loc>{SITE}/songs/</loc><changefreq>daily</changefreq><priority>0.7</priority></url>"] if self.count() else []
        for r in self.published(5000):
            when = time.strftime("%Y-%m-%d", time.gmtime(r["updated_at"]))
            urls.append(f"  <url><loc>{SITE}/songs/{r['slug']}/</loc><lastmod>{when}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>")
        return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(urls) + "\n</urlset>\n"

    def _template(self) -> Optional[str]:
        try:
            with open(self._template_path, "r", encoding="utf-8") as f:
                return f.read()
        except OSError:
            return None

    def _fill(self, template: str, *, title: str, description: str, path: str, image: str, body: str, ld: list, index: bool) -> str:
        page = template
        page = page.replace("https://chordsuno.com/song-template/", f"{SITE}{path}")
        page = page.replace("https://img.invalid/__SP_IMAGE__", image)
        page = page.replace("__SP_TITLE__", _esc(title)).replace("__SP_DESC__", _esc(description))
        page = page.replace("__SP_BODY__", body)
        page = re.sub(r'<meta name="robots"[^>]*>', "" if index else '<meta name="robots" content="noindex, follow">', page)
        script = '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False).replace("</", "<\\/") + "</script>"
        return page.replace("</head>", script + "</head>", 1)

    def render_index(self) -> Optional[str]:
        template = self._template()
        if template is None:
            return None
        items = self.published(500)
        cards = []
        for r in items:
            chords = json.loads(r["chords"] or "[]")[:6]
            cards.append(
                f'<a class="sp-card" href="/songs/{_esc(r["slug"])}/">'
                f'<img src="https://i.ytimg.com/vi/{_esc(r["video_id"])}/mqdefault.jpg" alt="" width="320" height="180" loading="lazy" />'
                f'<span class="sp-card-body"><strong>{_esc(r["title"])}</strong><small>{_esc(r["artist"])}</small>'
                f'<span class="sp-mini">{"".join(f"<i>{_esc(c)}</i>" for c in chords)}</span></span></a>'
            )
        body = (
            '<section class="sp-wrap"><header class="sp-head"><p class="sp-eyebrow">Songs</p><h1>Chords for popular songs</h1>'
            "<p>Every chord, key and tempo, worked out from the audio. Open a song to play along with the chords synced to the beat.</p></header>"
            + (f'<div class="sp-grid">{"".join(cards)}</div>' if cards else '<p class="sp-empty">Song pages are coming soon.</p>')
            + "</section>"
        )
        ld = [{"@context": "https://schema.org", "@type": "CollectionPage", "name": "Chords for popular songs", "url": f"{SITE}/songs/"}]
        return self._fill(
            template,
            title="Chords for Popular Songs — Guitar, Piano & Ukulele | Chord Suno",
            description="Browse chord charts for popular songs: the key, tempo and every chord, ready to play along with on guitar, piano, ukulele or mandolin.",
            path="/songs/",
            image=f"{SITE}/og-image.png",
            body=body,
            ld=ld,
            index=bool(items),
        )

    def render_song(self, slug: str) -> Optional[str]:
        template = self._template()
        if template is None:
            return None
        rows, _ = self._db.run(
            "SELECT p.*, s.session_id, s.duration AS song_duration, s.song_key, s.tempo AS song_tempo, s.chords AS song_chords, s.thumbnail "
            "FROM song_pages p JOIN songs s ON s.video_id = p.video_id WHERE p.slug = ?",
            (slug,),
        )
        if not rows:
            return None
        row = rows[0]
        result = self._catalog.load_result(row["session_id"]) or {}
        title, artist = row["title"], row["artist"]
        name = f"{title} by {artist}" if artist else title

        key = result.get("key") or row["song_key"] or ""
        tempo = int(round(result.get("tempo") or row["song_tempo"] or 0))
        per_bar = int(result.get("beatsPerBar") or 4)
        duration = float(result.get("duration") or row["song_duration"] or 0)
        segments = [c for c in (result.get("chords") or []) if c.get("chord") not in (None, "N")]
        timeline = {}
        for c in segments:
            timeline[c["chord"]] = timeline.get(c["chord"], 0.0) + max(float(c["end"]) - float(c["start"]), 0.0)
        used = [c for c, _ in sorted(timeline.items(), key=lambda kv: -kv[1])] or json.loads(row["song_chords"] or "[]")
        level = difficulty(used)

        facts = [("Key", key or "—"), ("Tempo", f"{tempo} BPM" if tempo else "—"), ("Time", _time_signature(per_bar)), ("Level", level)]
        if duration:
            facts.append(("Length", _minutes(duration)))
        facts_html = "".join(f"<div><dt>{_esc(k)}</dt><dd>{_esc(v)}</dd></div>" for k, v in facts)
        chips = "".join(f"<span>{_esc(c)}</span>" for c in used[:12])

        # the chords of each section, as they follow one another (repeats of the same chord merged)
        prog_html = ""
        seen_labels: set[str] = set()
        for sec in result.get("sections") or []:
            label = sec.get("label") or ""
            kind = re.sub(r"\s*\d+$", "", label)
            if not label or kind in seen_labels or label == "Silence" or len(seen_labels) >= 6:
                continue
            chain: list[str] = []
            for c in segments:
                if sec["start"] - 0.01 <= c["start"] < sec["end"] and (not chain or chain[-1] != c["chord"]):
                    chain.append(c["chord"])
            if len(chain) >= 2:
                seen_labels.add(kind)
                prog_html += f"<li><strong>{_esc(label)}</strong><span>{' <b>›</b> '.join(_esc(c) for c in chain[:16])}</span></li>"
        progression = f'<section class="sp-block"><h2>Chord progression</h2><ul class="sp-prog">{prog_html}</ul></section>' if prog_html else ""

        intro = row["intro"].strip()
        about = (
            f"<p>{_esc(intro)}</p>"
            if intro
            else (
                f"<p>{_esc(title)}{(' by ' + _esc(artist)) if artist else ''} is in the key of {_esc(key)} at about {tempo} BPM, "
                f"counted in {_time_signature(per_bar)}.</p>"
                if key and tempo
                else f"<p>Chords for {_esc(name)}.</p>"
            )
        )
        about += (
            f"<p>These chords were worked out automatically from the song's audio, with the chord changes placed on the beat. "
            f"Open the player to follow {_esc(title)} chord by chord, slow it down, loop a section, transpose it, or see it for "
            f"piano, ukulele and mandolin. Real recordings differ a little from any chart, so use your ear as the last word.</p>"
        )

        related_rows = [r for r in self.published(60) if r["slug"] != slug]
        related_rows.sort(key=lambda r: (r["artist"] != artist or not artist))
        related = "".join(
            f'<a class="sp-card" href="/songs/{_esc(r["slug"])}/"><img src="https://i.ytimg.com/vi/{_esc(r["video_id"])}/mqdefault.jpg" alt="" width="320" height="180" loading="lazy" />'
            f'<span class="sp-card-body"><strong>{_esc(r["title"])}</strong><small>{_esc(r["artist"])}</small></span></a>'
            for r in related_rows[:6]
        )
        related_html = f'<section class="sp-block"><h2>More songs</h2><div class="sp-grid">{related}</div></section>' if related else ""

        thumb = row["thumbnail"] or f"https://i.ytimg.com/vi/{row['video_id']}/hqdefault.jpg"
        body = (
            '<article class="sp-wrap">'
            '<nav class="sp-crumb" aria-label="Breadcrumb"><a href="/">Chord Suno</a><span>›</span><a href="/songs/">Songs</a>'
            f"<span>›</span><span>{_esc(title)}</span></nav>"
            f'<header class="sp-hero"><img src="https://i.ytimg.com/vi/{_esc(row["video_id"])}/hqdefault.jpg" alt="{_esc(name)}" width="480" height="360" />'
            f'<div><p class="sp-eyebrow">Chords</p><h1>{_esc(title)} chords</h1>'
            f'{f"<p class=sp-by>{_esc(artist)}</p>" if artist else ""}'
            f'<a class="sp-play" href="/play?session={_esc(row["session_id"])}">▶ Play along with the chords</a>'
            "<small>Synced to the beat · guitar, piano, ukulele &amp; mandolin diagrams</small></div></header>"
            f'<dl class="sp-facts">{facts_html}</dl>'
            f'<section class="sp-block"><h2>Chords used in {_esc(title)}</h2><div class="sp-chips">{chips}</div></section>'
            f"{progression}"
            f'<section class="sp-block"><h2>About these chords</h2>{about}</section>'
            f"{related_html}"
            '<aside class="sp-note">Chord charts are transcriptions made by software for learning and practice. Chord Suno does not show lyrics.</aside>'
            "</article>"
        )

        description = (
            f"Chords for {name}: {', '.join(used[:6])}. Key of {key}, {tempo} BPM, {_time_signature(per_bar)}. "
            "Play along with the chords synced to the beat."
            if key and tempo and used
            else f"Chords for {name}, synced to the beat. Play along on guitar, piano, ukulele or mandolin."
        )
        ld = [
            {
                "@context": "https://schema.org",
                "@type": "MusicComposition",
                "name": title,
                **({"musicalKey": key} if key else {}),
                "url": f"{SITE}/songs/{slug}/",
                **({"recordedAs": {"@type": "MusicRecording", "name": title, "byArtist": {"@type": "MusicGroup", "name": artist}, "duration": _iso_duration(duration)}} if artist and duration else {}),
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Chord Suno", "item": f"{SITE}/"},
                    {"@type": "ListItem", "position": 2, "name": "Songs", "item": f"{SITE}/songs/"},
                    {"@type": "ListItem", "position": 3, "name": f"{title} chords", "item": f"{SITE}/songs/{slug}/"},
                ],
            },
        ]
        return self._fill(
            template,
            title=f"{title} Chords{(' — ' + artist) if artist else ''} | Chord Suno",
            description=description[:300],
            path=f"/songs/{slug}/",
            image=thumb if thumb.startswith("https://") else f"https://i.ytimg.com/vi/{row['video_id']}/hqdefault.jpg",
            body=body,
            ld=ld,
            index=True,
        )

    def not_found(self) -> Optional[str]:
        template = self._template()
        if template is None:
            return None
        body = (
            '<section class="sp-wrap"><header class="sp-head"><h1>That song page is not here</h1>'
            '<p>It may have moved. <a href="/songs/">Browse the songs</a> or <a href="/">find the chords of any song</a>.</p></header></section>'
        )
        return self._fill(
            template, title="Song not found | Chord Suno", description="That song page could not be found.", path="/songs/",
            image=f"{SITE}/og-image.png", body=body, ld=[], index=False,
        )
