"""The permanent memory of the app: the song catalog and every finished analysis.

Two tables:
  songs    every YouTube song that has been chordified, with its main chords and how often people jam to it (it is what
           lets a search result say "C G F · 35K jam sessions" and what the "popular" list is built from)
  results  the full chord data of each analysis, so a second visitor's song opens instantly instead of being analysed again

With DATABASE_URL set (postgresql://user:password@host:5432/dbname) they live in Postgres, which has its own storage and
backups and does not care when this app's container is rebuilt. Without it they live in a SQLite file in DATA_DIR, which is
only as permanent as that folder (mount a persistent volume on it). Both speak the same SQL; only the connection differs.
"""

from __future__ import annotations

import glob
import json
import logging
import os
import sqlite3
import threading
import time
from typing import Any, Iterable, Optional

log = logging.getLogger("chordify.store")

_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS songs (
        video_id     TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL,
        title        TEXT NOT NULL DEFAULT '',
        artist       TEXT NOT NULL DEFAULT '',
        album        TEXT NOT NULL DEFAULT '',
        duration     DOUBLE PRECISION NOT NULL DEFAULT 0,
        thumbnail    TEXT NOT NULL DEFAULT '',
        chords       TEXT NOT NULL DEFAULT '[]',
        song_key     TEXT NOT NULL DEFAULT '',
        tempo        DOUBLE PRECISION NOT NULL DEFAULT 0,
        jams         INTEGER NOT NULL DEFAULT 0,
        created_at   DOUBLE PRECISION NOT NULL,
        updated_at   DOUBLE PRECISION NOT NULL,
        last_jam_at  DOUBLE PRECISION
    )
    """,
    "CREATE INDEX IF NOT EXISTS songs_popular ON songs (jams DESC, updated_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS ratings (
        session_id   TEXT NOT NULL,
        voter        TEXT NOT NULL,
        stars        INTEGER NOT NULL,
        comment      TEXT NOT NULL DEFAULT '',
        title        TEXT NOT NULL DEFAULT '',
        artist       TEXT NOT NULL DEFAULT '',
        created_at   DOUBLE PRECISION NOT NULL,
        updated_at   DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (session_id, voter)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ratings_recent ON ratings (updated_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS results (
        key          TEXT PRIMARY KEY,
        data         TEXT NOT NULL,
        updated_at   DOUBLE PRECISION NOT NULL
    )
    """,
]


class _Sqlite:
    kind = "sqlite"

    def __init__(self, path: str) -> None:
        self._path = path
        self._write = threading.Lock()
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self._path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def run(self, sql: str, params: tuple = ()) -> tuple[list[dict], int]:
        """(rows, rows changed). SQLite allows one writer at a time, so writes queue on a lock."""
        writes = not sql.lstrip().upper().startswith("SELECT")
        lock = self._write if writes else threading.Lock()
        with lock:
            db = self._connect()
            try:
                with db:
                    cur = db.execute(sql, params)
                    rows = [dict(r) for r in cur.fetchall()] if cur.description else []
                    return rows, cur.rowcount
            finally:
                db.close()

    def describe(self) -> str:
        return f"SQLite file {self._path}"


class _Postgres:
    kind = "postgres"

    def __init__(self, url: str) -> None:
        from psycopg.rows import dict_row  # imported here: only needed when DATABASE_URL is set
        from psycopg_pool import ConnectionPool

        self._pool = ConnectionPool(
            url, min_size=1, max_size=6, timeout=15, kwargs={"row_factory": dict_row, "autocommit": True}, open=False
        )
        self._pool.open(wait=True, timeout=15)
        self._url = url

    def run(self, sql: str, params: tuple = ()) -> tuple[list[dict], int]:
        with self._pool.connection() as db:
            cur = db.execute(sql.replace("?", "%s"), params)
            rows = list(cur.fetchall()) if cur.description else []
            return rows, cur.rowcount

    def describe(self) -> str:
        from psycopg.conninfo import conninfo_to_dict

        info = conninfo_to_dict(self._url)
        return f"Postgres {info.get('host', 'localhost')}:{info.get('port', 5432)}/{info.get('dbname', '')}"


def _open_backend(data_dir: str):
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        try:
            return _Postgres(url)
        except Exception as exc:
            # Do not take the whole site down over this; but say it loudly, because the cache is not permanent now.
            log.error("DATABASE_URL is set but Postgres is not reachable (%s): using the SQLite file instead", exc)
    return _Sqlite(os.path.join(data_dir, "songs.db"))


class SongStore:
    def __init__(self, data_dir: str) -> None:
        self._db = _open_backend(data_dir)
        self.db = self._db  # the same connection, for the tables of people and plans (accounts.py)
        for statement in _SCHEMA:
            self._db.run(statement)
        log.info("Song catalog and results stored in %s", self._db.describe())

    # ----- the full analyses -------------------------------------------------------------------------------------

    def load_result(self, key: str) -> Optional[dict]:
        rows, _ = self._db.run("SELECT data FROM results WHERE key = ?", (key,))
        if not rows:
            return None
        try:
            return json.loads(rows[0]["data"])
        except ValueError:
            return None  # damaged entry: the caller analyses the song again and overwrites it

    def save_result(self, key: str, result: dict) -> None:
        self._db.run(
            """
            INSERT INTO results (key, data, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
            """,
            (key, json.dumps(result), time.time()),
        )

    # ----- the catalog -------------------------------------------------------------------------------------------

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
        self._db.run(
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

    def get_song(self, video_id: str) -> Optional[dict]:
        """The catalog entry of one song (title, artist, cover...), or None."""
        rows, _ = self._db.run("SELECT * FROM songs WHERE video_id = ?", (video_id,))
        if not rows:
            return None
        r = rows[0]
        return {"videoId": r["video_id"], "title": r["title"], "artist": r["artist"], "thumbnail": r["thumbnail"], "duration": r["duration"]}

    def lookup(self, video_ids: list[str]) -> dict[str, dict]:
        """{video_id: {"chords": [...], "jams": n}} for the ids that have been chordified."""
        if not video_ids:
            return {}
        marks = ",".join("?" * len(video_ids))
        rows, _ = self._db.run(f"SELECT video_id, chords, jams FROM songs WHERE video_id IN ({marks})", tuple(video_ids))
        return {r["video_id"]: {"chords": json.loads(r["chords"]), "jams": r["jams"]} for r in rows}

    def add_jam(self, video_id: str) -> Optional[int]:
        """One more jam session; the new total, or None if the song is not in the catalog."""
        rows, _ = self._db.run(
            "UPDATE songs SET jams = jams + 1, last_jam_at = ? WHERE video_id = ? RETURNING jams", (time.time(), video_id)
        )
        return rows[0]["jams"] if rows else None

    def popular(self, limit: int = 12) -> list[dict]:
        """The most-jammed songs (ties: most recently chordified), for the search page before anything is typed."""
        rows, _ = self._db.run("SELECT * FROM songs WHERE jams > 0 ORDER BY jams DESC, updated_at DESC LIMIT ?", (limit,))
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

    def library(self, limit: int = 600) -> list[dict]:
        """Chordified songs with their key and tempo, the most played and newest first: what "similar songs" picks from."""
        rows, _ = self._db.run("SELECT * FROM songs ORDER BY jams DESC, updated_at DESC LIMIT ?", (limit,))
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
                "key": r["song_key"],
                "tempo": r["tempo"],
            }
            for r in rows
        ]

    # ----- ratings: how good people say a song's chords are --------------------------------------------------------

    def rate(self, session_id: str, voter: str, stars: int, comment: str, title: str = "", artist: str = "") -> None:
        """Saves a person's rating of a song (1 to 5 stars, and what they had to say). A second one from the same person
        replaces the first."""
        now = time.time()
        self._db.run(
            """
            INSERT INTO ratings (session_id, voter, stars, comment, title, artist, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id, voter) DO UPDATE SET
                stars = excluded.stars, comment = excluded.comment, updated_at = excluded.updated_at,
                title = CASE WHEN excluded.title != '' THEN excluded.title ELSE ratings.title END,
                artist = CASE WHEN excluded.artist != '' THEN excluded.artist ELSE ratings.artist END
            """,
            (session_id, voter, stars, comment, title, artist, now, now),
        )

    def delete_ratings_of(self, voter: str) -> None:
        """Removes every rating (and comment) a person left."""
        self._db.run("DELETE FROM ratings WHERE voter = ?", (voter,))

    def delete_result(self, key: str) -> None:
        """Removes a song's saved analysis."""
        self._db.run("DELETE FROM results WHERE key = ?", (key,))

    def rating_summary(self, session_id: str, voter: str = "") -> dict:
        """{"count", "average", "mine": {"stars", "comment"} or None} for one song."""
        rows, _ = self._db.run("SELECT COUNT(*) AS n, AVG(stars) AS mean FROM ratings WHERE session_id = ?", (session_id,))
        count = int(rows[0]["n"])
        mine = None
        if voter:
            own, _ = self._db.run("SELECT stars, comment FROM ratings WHERE session_id = ? AND voter = ?", (session_id, voter))
            if own:
                mine = {"stars": int(own[0]["stars"]), "comment": own[0]["comment"]}
        return {"count": count, "average": round(float(rows[0]["mean"]), 2) if count else 0, "mine": mine}

    def list_ratings(self, limit: int = 25, offset: int = 0, stars: int = 0, only_comments: bool = False) -> tuple[list[dict], int]:
        """The ratings, newest first, for the admin: with the song, the stars and what was said."""
        where, params = [], []
        if stars:
            where.append("stars = ?")
            params.append(stars)
        if only_comments:
            where.append("comment != ''")
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        total, _ = self._db.run(f"SELECT COUNT(*) AS n FROM ratings {clause}", tuple(params))
        rows, _ = self._db.run(
            f"SELECT session_id, voter, stars, comment, title, artist, updated_at FROM ratings {clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (*params, limit, offset),
        )
        return (
            [
                {
                    "sessionId": r["session_id"], "who": "Signed in" if r["voter"].startswith("u:") else "Visitor", "stars": int(r["stars"]),
                    "comment": r["comment"], "title": r["title"], "artist": r["artist"], "at": r["updated_at"],
                }
                for r in rows
            ],
            int(total[0]["n"]),
        )

    def rating_overview(self) -> dict:
        """All ratings at a glance: how many, the average, how many of each star, and the songs rated lowest."""
        totals, _ = self._db.run("SELECT COUNT(*) AS n, AVG(stars) AS mean FROM ratings")
        count = int(totals[0]["n"])
        by_star, _ = self._db.run("SELECT stars, COUNT(*) AS n FROM ratings GROUP BY stars")
        counts = {int(r["stars"]): int(r["n"]) for r in by_star}
        songs, _ = self._db.run(
            """
            SELECT session_id, MAX(title) AS title, MAX(artist) AS artist, COUNT(*) AS n, AVG(stars) AS mean
            FROM ratings GROUP BY session_id ORDER BY AVG(stars) ASC, COUNT(*) DESC LIMIT 8
            """
        )
        return {
            "count": count,
            "average": round(float(totals[0]["mean"]), 2) if count else 0,
            "byStars": [counts.get(i, 0) for i in range(1, 6)],
            "lowest": [
                {"sessionId": r["session_id"], "title": r["title"], "artist": r["artist"], "count": int(r["n"]), "average": round(float(r["mean"]), 2)}
                for r in songs
            ],
        }

    # ----- housekeeping ------------------------------------------------------------------------------------------

    def summary(self) -> dict:
        songs, _ = self._db.run("SELECT COUNT(*) AS n FROM songs")
        results, _ = self._db.run("SELECT COUNT(*) AS n FROM results")
        jams, _ = self._db.run("SELECT COALESCE(SUM(jams), 0) AS n FROM songs")
        return {
            "kind": self._db.kind, "where": self._db.describe(), "songs": songs[0]["n"], "results": results[0]["n"],
            "jams": int(jams[0]["n"]),
        }

    def import_files(self, data_dir: str) -> dict:
        """Brings in what older versions kept in files, once: results/*.json, and (into Postgres) the old songs.db.
        Anything already in the database is left alone, so running this on every start is harmless."""
        added = {"results": 0, "songs": 0}
        for path in glob.glob(os.path.join(data_dir, "results", "*.json")):
            key = os.path.splitext(os.path.basename(path))[0]
            try:
                with open(path, "r", encoding="utf-8") as f:
                    text = f.read()
                json.loads(text)
            except (OSError, ValueError):
                continue
            _, changed = self._db.run(
                "INSERT INTO results (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
                (key, text, os.path.getmtime(path)),
            )
            added["results"] += max(changed, 0)
        old = os.path.join(data_dir, "songs.db")
        if self._db.kind == "postgres" and os.path.exists(old):
            try:
                source = sqlite3.connect(old)
                source.row_factory = sqlite3.Row
                for r in source.execute("SELECT * FROM songs").fetchall():
                    _, changed = self._db.run(
                        """
                        INSERT INTO songs (video_id, session_id, title, artist, album, duration, thumbnail, chords, song_key,
                                           tempo, jams, created_at, updated_at, last_jam_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(video_id) DO NOTHING
                        """,
                        tuple(r[c] for c in (
                            "video_id", "session_id", "title", "artist", "album", "duration", "thumbnail", "chords",
                            "song_key", "tempo", "jams", "created_at", "updated_at", "last_jam_at",
                        )),
                    )
                    added["songs"] += max(changed, 0)
                source.close()
            except sqlite3.Error as exc:
                log.warning("Could not import the old songs.db: %s", exc)
        return added
