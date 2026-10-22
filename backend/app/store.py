"""The song catalog: every YouTube song that has been chordified, with its main chords and how often people jam to it.

A small SQLite file next to the saved results (DATA_DIR). It is what lets a search result say "C G F · 35K jam sessions",
what makes a second visitor's song open instantly instead of being analysed again, and what the "popular" list is built from.
Only metadata lives here; the full chord data stays in the result files (main.py).

SQLite is plenty for one server process. Writes take a lock; every call opens its own short-lived connection.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from typing import Iterable, Optional

_SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    video_id     TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    title        TEXT NOT NULL DEFAULT '',
    artist       TEXT NOT NULL DEFAULT '',
    album        TEXT NOT NULL DEFAULT '',
    duration     REAL NOT NULL DEFAULT 0,
    thumbnail    TEXT NOT NULL DEFAULT '',
    chords       TEXT NOT NULL DEFAULT '[]',
    song_key     TEXT NOT NULL DEFAULT '',
    tempo        REAL NOT NULL DEFAULT 0,
    jams         INTEGER NOT NULL DEFAULT 0,
    created_at   REAL NOT NULL,
    updated_at   REAL NOT NULL,
    last_jam_at  REAL
);
CREATE INDEX IF NOT EXISTS songs_popular ON songs (jams DESC, updated_at DESC);
"""


class SongStore:
    def __init__(self, path: str) -> None:
        self._path = path
        self._write = threading.Lock()
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with self._connect() as db:
            db.executescript(_SCHEMA)
            db.execute("PRAGMA journal_mode=WAL")

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self._path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def save_song(
        self,
        video_id: str,
        session_id: str,
        *,
        title: str,
        artist: str = "",
        album: str = "",
        duration: float = 0.0,
        thumbnail: str = "",
        chords: Iterable[str] = (),
        key: str = "",
        tempo: float = 0.0,
    ) -> None:
        """Adds a chordified song, or refreshes it (its jam count is kept)."""
        now = time.time()
        with self._write, self._connect() as db:
            db.execute(
                """
                INSERT INTO songs (video_id, session_id, title, artist, album, duration, thumbnail, chords, song_key, tempo,
                                   created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(video_id) DO UPDATE SET
                    session_id = excluded.session_id,
                    title      = CASE WHEN excluded.title    != '' THEN excluded.title    ELSE songs.title    END,
                    artist     = CASE WHEN excluded.artist   != '' THEN excluded.artist   ELSE songs.artist   END,
                    album      = CASE WHEN excluded.album    != '' THEN excluded.album    ELSE songs.album    END,
                    duration   = CASE WHEN excluded.duration  > 0 THEN excluded.duration  ELSE songs.duration END,
                    thumbnail  = CASE WHEN excluded.thumbnail != '' THEN excluded.thumbnail ELSE songs.thumbnail END,
                    chords     = excluded.chords,
                    song_key   = excluded.song_key,
                    tempo      = excluded.tempo,
                    updated_at = excluded.updated_at
                """,
                (video_id, session_id, title, artist, album, duration, thumbnail, json.dumps(list(chords)), key, tempo, now, now),
            )

    def lookup(self, video_ids: list[str]) -> dict[str, dict]:
        """{video_id: {"chords": [...], "jams": n}} for the ids that have been chordified."""
        if not video_ids:
            return {}
        marks = ",".join("?" * len(video_ids))
        with self._connect() as db:
            rows = db.execute(f"SELECT video_id, chords, jams FROM songs WHERE video_id IN ({marks})", video_ids).fetchall()
        return {r["video_id"]: {"chords": json.loads(r["chords"]), "jams": r["jams"]} for r in rows}

    def add_jam(self, video_id: str) -> Optional[int]:
        """One more jam session; the new total, or None if the song is not in the catalog."""
        with self._write, self._connect() as db:
            cur = db.execute("UPDATE songs SET jams = jams + 1, last_jam_at = ? WHERE video_id = ?", (time.time(), video_id))
            if cur.rowcount == 0:
                return None
            return db.execute("SELECT jams FROM songs WHERE video_id = ?", (video_id,)).fetchone()["jams"]

    def popular(self, limit: int = 12) -> list[dict]:
        """The most-jammed songs (ties: most recently chordified), for the search page before anything is typed."""
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM songs WHERE jams > 0 ORDER BY jams DESC, updated_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [
            {
                "videoId": r["video_id"],
                "title": r["title"],
                "artist": r["artist"],
                "album": r["album"],
                "duration": int(r["duration"]),
                "thumbnail": r["thumbnail"] or f"https://i.ytimg.com/vi/{r['video_id']}/mqdefault.jpg",
                "chords": json.loads(r["chords"]),
                "jams": r["jams"],
            }
            for r in rows
        ]
