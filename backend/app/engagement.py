"""What keeps people coming back: each person's library (songs played, songs favourited), and the XP, levels, badges and
rewards they earn by playing.

Everything a person earns follows a small set of rules that the admin edits on the Rewards page, kept as one document in the
`settings` table (see DEFAULT_CONFIG). The rules are:

  XP        playing a song, playing one for the first time, favouriting one, the first play of a day, and a bonus for a streak
            of days in a row. Playing the same song again within a few minutes counts for nothing, and a day's XP has a cap,
            so the numbers cannot be pumped by pressing play over and over.
  Levels    there is no top level: the XP needed for level n is  base * (n - 1) ** growth,  which just keeps growing.
  Titles    a name for each stretch of levels ("Strummer", "Maestro"...).
  Badges    earned once, when a number reaches a target (plays, different songs, favourites, streak, level, XP).
  Rewards   things unlocked at a level. One can repeat every N levels, so there is always another one ahead
            (a star every 10 levels, for example).

Levels and rewards are worked out from the XP when they are asked for, never stored, so changing the rules on the admin page
changes everybody's level at once and nothing has to be migrated.
"""

from __future__ import annotations

import copy
import json
import logging
import re
import time
from typing import Any, Optional

log = logging.getLogger("chordify.engagement")

_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  DOUBLE PRECISION NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS library_items (
        user_id         TEXT NOT NULL,
        session_id      TEXT NOT NULL,
        video_id        TEXT NOT NULL DEFAULT '',
        title           TEXT NOT NULL DEFAULT '',
        artist          TEXT NOT NULL DEFAULT '',
        thumbnail       TEXT NOT NULL DEFAULT '',
        duration        DOUBLE PRECISION NOT NULL DEFAULT 0,
        chords          TEXT NOT NULL DEFAULT '[]',
        plays           INTEGER NOT NULL DEFAULT 0,
        favorite        INTEGER NOT NULL DEFAULT 0,
        favorited_at    DOUBLE PRECISION NOT NULL DEFAULT 0,
        first_played_at DOUBLE PRECISION NOT NULL DEFAULT 0,
        last_played_at  DOUBLE PRECISION NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, session_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS library_recent ON library_items (user_id, last_played_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS user_progress (
        user_id     TEXT PRIMARY KEY,
        xp          INTEGER NOT NULL DEFAULT 0,
        streak      INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        last_day    INTEGER NOT NULL DEFAULT 0,
        xp_day      INTEGER NOT NULL DEFAULT 0,
        xp_today    INTEGER NOT NULL DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_badges (
        user_id    TEXT NOT NULL,
        code       TEXT NOT NULL,
        earned_at  DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (user_id, code)
    )
    """,
]

BADGE_RULES = {
    "plays": "Songs played (every play)",
    "songs": "Different songs played",
    "favorites": "Songs favourited",
    "streak": "Days in a row",
    "level": "Level reached",
    "xp": "Total XP",
}
REWARD_KINDS = {"ring": "Avatar ring (value: a colour like #f59e0b)", "star": "Prestige star, shown next to the level", "perk": "A perk to hand out (value: what it is)"}

DEFAULT_CONFIG: dict = {
    "xp": {
        "play": 10,  # every counted play
        "newSong": 20,  # extra, the first time a person plays a song
        "favorite": 5,  # the first time a person favourites a song
        "dailyFirst": 15,  # extra, for the first play of each day
        "streakPerDay": 5,  # extra per day of the streak after the first, up to streakMaxDays
        "streakMaxDays": 7,
        "repeatCooldownMinutes": 10,  # playing the same song again sooner than this counts for nothing
        "dailyCap": 400,  # most XP from playing in one day (0 = no cap); badge bonuses are not counted
    },
    "curve": {"base": 100, "growth": 1.6},  # XP for level n = base * (n - 1) ** growth
    "timezoneOffsetMinutes": 330,  # where a "day" starts for streaks (330 = India)
    "titles": [
        {"level": 1, "name": "Listener"},
        {"level": 3, "name": "Strummer"},
        {"level": 6, "name": "Jammer"},
        {"level": 10, "name": "Chord Hunter"},
        {"level": 15, "name": "Groove Master"},
        {"level": 25, "name": "Maestro"},
        {"level": 40, "name": "Legend"},
    ],
    "badges": [
        {"code": "first-note", "name": "First Note", "icon": "🎵", "description": "Play your first song", "rule": "plays", "threshold": 1, "bonusXp": 10},
        {"code": "warming-up", "name": "Warming Up", "icon": "🎸", "description": "Play 5 different songs", "rule": "songs", "threshold": 5, "bonusXp": 25},
        {"code": "explorer", "name": "Explorer", "icon": "🧭", "description": "Play 25 different songs", "rule": "songs", "threshold": 25, "bonusXp": 75},
        {"code": "jam-regular", "name": "Jam Regular", "icon": "🔁", "description": "Press play 50 times", "rule": "plays", "threshold": 50, "bonusXp": 50},
        {"code": "century", "name": "Century", "icon": "💯", "description": "Press play 100 times", "rule": "plays", "threshold": 100, "bonusXp": 100},
        {"code": "collector", "name": "Collector", "icon": "❤️", "description": "Favourite 5 songs", "rule": "favorites", "threshold": 5, "bonusXp": 25},
        {"code": "on-a-roll", "name": "On a Roll", "icon": "🔥", "description": "Play 3 days in a row", "rule": "streak", "threshold": 3, "bonusXp": 30},
        {"code": "week-warrior", "name": "Week Warrior", "icon": "🏆", "description": "Play 7 days in a row", "rule": "streak", "threshold": 7, "bonusXp": 100},
        {"code": "level-5", "name": "Rising Star", "icon": "⭐", "description": "Reach level 5", "rule": "level", "threshold": 5, "bonusXp": 0},
        {"code": "level-10", "name": "Chord Hunter", "icon": "🏹", "description": "Reach level 10", "rule": "level", "threshold": 10, "bonusXp": 0},
    ],
    "rewards": [
        {"id": "ring-bronze", "level": 2, "name": "Bronze ring", "description": "A bronze ring around your picture", "kind": "ring", "value": "#cd7f32", "repeatEvery": 0},
        {"id": "ring-silver", "level": 5, "name": "Silver ring", "description": "A silver ring around your picture", "kind": "ring", "value": "#a8b3c4", "repeatEvery": 0},
        {"id": "ring-gold", "level": 10, "name": "Gold ring", "description": "A gold ring around your picture", "kind": "ring", "value": "#f59e0b", "repeatEvery": 0},
        {"id": "ring-violet", "level": 20, "name": "Violet ring", "description": "A glowing violet ring", "kind": "ring", "value": "#7c3aed", "repeatEvery": 0},
        {"id": "star", "level": 10, "name": "Prestige star", "description": "Another star every 10 levels, with no end", "kind": "star", "value": "", "repeatEvery": 10},
    ],
}

_CODE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")


def _int(value: Any, low: int, high: int, default: int) -> int:
    try:
        return max(low, min(high, int(float(value))))
    except (TypeError, ValueError):
        return default


def _float(value: Any, low: float, high: float, default: float) -> float:
    try:
        return max(low, min(high, float(value)))
    except (TypeError, ValueError):
        return default


def clean_config(raw: dict) -> dict:
    """The admin's rules, made safe: numbers clamped, lists capped, codes unique. Raises ValueError for what cannot be fixed."""
    base = DEFAULT_CONFIG
    xp_in = raw.get("xp") or {}
    xp = {
        key: _int(xp_in.get(key), 0, 100000, base["xp"][key])
        for key in ("play", "newSong", "favorite", "dailyFirst", "streakPerDay", "dailyCap")
    }
    xp["streakMaxDays"] = _int(xp_in.get("streakMaxDays"), 1, 365, base["xp"]["streakMaxDays"])
    xp["repeatCooldownMinutes"] = _int(xp_in.get("repeatCooldownMinutes"), 0, 1440, base["xp"]["repeatCooldownMinutes"])
    curve_in = raw.get("curve") or {}
    curve = {"base": _int(curve_in.get("base"), 1, 1000000, 100), "growth": round(_float(curve_in.get("growth"), 1.0, 4.0, 1.6), 3)}

    titles = []
    for item in (raw.get("titles") or [])[:30]:
        name = str(item.get("name", "")).strip()[:30]
        if name:
            titles.append({"level": _int(item.get("level"), 1, 100000, 1), "name": name})
    titles.sort(key=lambda t: t["level"])
    if not titles or titles[0]["level"] > 1:
        titles.insert(0, {"level": 1, "name": titles[0]["name"] if titles else "Listener"})

    badges, seen = [], set()
    for item in (raw.get("badges") or [])[:80]:
        code = str(item.get("code", "")).strip().lower()
        name = str(item.get("name", "")).strip()[:40]
        if not name:
            continue
        if not _CODE.match(code):
            raise ValueError(f"The badge code “{code}” can only use lowercase letters, numbers, - and _.")
        if code in seen:
            raise ValueError(f"Two badges have the code “{code}”.")
        seen.add(code)
        rule = item.get("rule")
        if rule not in BADGE_RULES:
            raise ValueError(f"The badge “{name}” has an unknown rule.")
        badges.append({
            "code": code, "name": name, "icon": str(item.get("icon", "")).strip()[:8] or "🏅",
            "description": str(item.get("description", "")).strip()[:120], "rule": rule,
            "threshold": _int(item.get("threshold"), 1, 10_000_000, 1), "bonusXp": _int(item.get("bonusXp"), 0, 100000, 0),
        })

    rewards, seen = [], set()
    for item in (raw.get("rewards") or [])[:60]:
        name = str(item.get("name", "")).strip()[:40]
        if not name:
            continue
        rid = str(item.get("id", "")).strip().lower() or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        if not _CODE.match(rid):
            raise ValueError(f"The reward id “{rid}” can only use lowercase letters, numbers, - and _.")
        if rid in seen:
            raise ValueError(f"Two rewards have the id “{rid}”.")
        seen.add(rid)
        kind = item.get("kind")
        if kind not in REWARD_KINDS:
            raise ValueError(f"The reward “{name}” has an unknown kind.")
        value = str(item.get("value", "")).strip()[:80]
        if kind == "ring" and not _COLOUR.match(value):
            raise ValueError(f"The ring “{name}” needs a colour like #f59e0b.")
        rewards.append({
            "id": rid, "level": _int(item.get("level"), 1, 100000, 1), "name": name,
            "description": str(item.get("description", "")).strip()[:140], "kind": kind, "value": value,
            "repeatEvery": _int(item.get("repeatEvery"), 0, 100000, 0),
        })
    rewards.sort(key=lambda r: r["level"])
    return {
        "xp": xp, "curve": curve, "timezoneOffsetMinutes": _int(raw.get("timezoneOffsetMinutes"), -720, 840, 330),
        "titles": titles, "badges": badges, "rewards": rewards,
    }


# ---- levels (pure functions of the XP and the rules) ----------------------------------------------------------------------


def xp_for_level(level: int, curve: dict) -> int:
    """Total XP at which a person reaches `level`."""
    return 0 if level <= 1 else round(curve["base"] * (level - 1) ** curve["growth"])


def level_for_xp(xp: int, curve: dict) -> int:
    if xp <= 0:
        return 1
    high = 2
    while xp_for_level(high, curve) <= xp:  # grow the search range until it passes the XP: there is no top level
        high *= 2
    low = high // 2 if high > 2 else 1
    while high - low > 1:
        mid = (low + high) // 2
        if xp_for_level(mid, curve) <= xp:
            low = mid
        else:
            high = mid
    return low


def title_for(level: int, cfg: dict) -> str:
    name = cfg["titles"][0]["name"]
    for item in cfg["titles"]:
        if item["level"] <= level:
            name = item["name"]
    return name


def reward_count(reward: dict, level: int) -> int:
    """How many times a reward has been unlocked at `level` (a repeating one keeps coming)."""
    if level < reward["level"]:
        return 0
    if reward["repeatEvery"] > 0:
        return (level - reward["level"]) // reward["repeatEvery"] + 1
    return 1


def next_unlock_level(reward: dict, level: int) -> int:
    if level < reward["level"]:
        return reward["level"]
    if reward["repeatEvery"] > 0:
        return reward["level"] + reward_count(reward, level) * reward["repeatEvery"]
    return 0  # already unlocked and it does not repeat


def ring_for(level: int, cfg: dict) -> str:
    colour = ""
    for reward in cfg["rewards"]:  # sorted by level: the highest ring reached wins
        if reward["kind"] == "ring" and reward_count(reward, level):
            colour = reward["value"]
    return colour


def stars_for(level: int, cfg: dict) -> int:
    return sum(reward_count(r, level) for r in cfg["rewards"] if r["kind"] == "star")


class Engagement:
    def __init__(self, db: Any) -> None:
        self._db = db
        for statement in _SCHEMA:
            db.run(statement)
        self._config: Optional[dict] = None

    # ----- the rules ---------------------------------------------------------------------------------------------

    def config(self) -> dict:
        if self._config is None:
            rows, _ = self._db.run("SELECT value FROM settings WHERE key = ?", ("engagement",))
            config = copy.deepcopy(DEFAULT_CONFIG)
            if rows:
                try:
                    config = clean_config(json.loads(rows[0]["value"]))
                except (ValueError, TypeError):
                    log.warning("The saved reward rules are damaged: using the defaults")
            self._config = config
        return self._config

    def save_config(self, raw: dict) -> dict:
        config = clean_config(raw)
        now = time.time()
        self._db.run(
            """
            INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            ("engagement", json.dumps(config), now),
        )
        self._config = config
        return config

    def reset_config(self) -> dict:
        self._db.run("DELETE FROM settings WHERE key = ?", ("engagement",))
        self._config = None
        return self.config()

    def badge_counts(self) -> dict[str, int]:
        rows, _ = self._db.run("SELECT code, COUNT(*) AS n FROM user_badges GROUP BY code")
        return {r["code"]: r["n"] for r in rows}

    # ----- one person's numbers ----------------------------------------------------------------------------------

    def _progress(self, user_id: str) -> dict:
        self._db.run("INSERT INTO user_progress (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING", (user_id,))
        rows, _ = self._db.run("SELECT * FROM user_progress WHERE user_id = ?", (user_id,))
        return rows[0]

    def _totals(self, user_id: str) -> dict:
        rows, _ = self._db.run(
            """
            SELECT COALESCE(SUM(plays), 0) AS plays,
                   COALESCE(SUM(CASE WHEN plays > 0 THEN 1 ELSE 0 END), 0) AS songs,
                   COALESCE(SUM(favorite), 0) AS favorites
            FROM library_items WHERE user_id = ?
            """,
            (user_id,),
        )
        return {key: int(rows[0][key]) for key in ("plays", "songs", "favorites")}

    def levels_of(self, xps: dict[str, int]) -> dict[str, int]:
        curve = self.config()["curve"]
        return {user: level_for_xp(xp, curve) for user, xp in xps.items()}

    def xp_of(self, user_ids: list[str]) -> dict[str, int]:
        if not user_ids:
            return {}
        marks = ",".join("?" * len(user_ids))
        rows, _ = self._db.run(f"SELECT user_id, xp FROM user_progress WHERE user_id IN ({marks})", tuple(user_ids))
        return {r["user_id"]: r["xp"] for r in rows}

    def snapshot(self, user_id: str) -> dict:
        """Where a person stands: XP, level and the way to the next one, title, ring, stars, streak and totals."""
        cfg = self.config()
        prog = self._progress(user_id)
        level = level_for_xp(prog["xp"], cfg["curve"])
        floor, ceiling = xp_for_level(level, cfg["curve"]), xp_for_level(level + 1, cfg["curve"])
        return {
            "xp": prog["xp"], "level": level, "title": title_for(level, cfg), "ring": ring_for(level, cfg), "stars": stars_for(level, cfg),
            "levelStartXp": floor, "nextLevelXp": ceiling, "intoLevel": prog["xp"] - floor, "levelSpan": ceiling - floor,
            "streak": prog["streak"], "bestStreak": prog["best_streak"], **self._totals(user_id),
        }

    def profile(self, user_id: str) -> dict:
        cfg = self.config()
        snap = self.snapshot(user_id)
        level = snap["level"]
        rows, _ = self._db.run("SELECT code, earned_at FROM user_badges WHERE user_id = ?", (user_id,))
        earned = {r["code"]: r["earned_at"] for r in rows}
        values = {**snap, "streak": max(snap["streak"], snap["bestStreak"]), "songs": snap["songs"]}
        badges = [
            {**b, "earned": b["code"] in earned, "earnedAt": earned.get(b["code"]), "progress": min(values.get(b["rule"], 0), b["threshold"])}
            for b in cfg["badges"]
        ]
        rewards = [
            {**r, "unlocked": reward_count(r, level) > 0, "count": reward_count(r, level), "nextAt": next_unlock_level(r, level)}
            for r in cfg["rewards"]
        ]
        upcoming = [r for r in rewards if r["nextAt"] > 0]
        return {
            **snap, "badges": badges, "rewards": rewards,
            "nextReward": min(upcoming, key=lambda r: r["nextAt"]) if upcoming else None,
        }

    # ----- the library -------------------------------------------------------------------------------------------

    def list_items(self, user_id: str, tab: str, limit: int, offset: int) -> tuple[list[dict], int]:
        if tab == "favorites":
            where, order = "favorite = 1", "favorited_at DESC"
        else:
            where, order = "plays > 0", "last_played_at DESC"
        total, _ = self._db.run(f"SELECT COUNT(*) AS n FROM library_items WHERE user_id = ? AND {where}", (user_id,))
        rows, _ = self._db.run(
            f"SELECT * FROM library_items WHERE user_id = ? AND {where} ORDER BY {order} LIMIT ? OFFSET ?", (user_id, limit, offset)
        )
        return [self._item(r) for r in rows], total[0]["n"]

    def favorite_keys(self, user_id: str) -> list[str]:
        rows, _ = self._db.run("SELECT session_id FROM library_items WHERE user_id = ? AND favorite = 1", (user_id,))
        return [r["session_id"] for r in rows]

    @staticmethod
    def _item(row: dict) -> dict:
        return {
            "sessionId": row["session_id"], "videoId": row["video_id"], "title": row["title"], "artist": row["artist"],
            "thumbnail": row["thumbnail"], "duration": row["duration"], "chords": json.loads(row["chords"] or "[]"),
            "plays": row["plays"], "favorite": bool(row["favorite"]), "lastPlayedAt": row["last_played_at"] or None,
            "favoritedAt": row["favorited_at"] or None,
        }

    def _get_item(self, user_id: str, session_id: str) -> Optional[dict]:
        rows, _ = self._db.run("SELECT * FROM library_items WHERE user_id = ? AND session_id = ?", (user_id, session_id))
        return rows[0] if rows else None

    @staticmethod
    def _meta_values(meta: dict) -> tuple:
        return (
            meta.get("videoId", ""), meta.get("title", ""), meta.get("artist", ""), meta.get("thumbnail", ""),
            float(meta.get("duration") or 0), json.dumps(meta.get("chords") or []),
        )

    # ----- earning -----------------------------------------------------------------------------------------------

    def _day(self, now: float, cfg: dict) -> int:
        return int((now + cfg["timezoneOffsetMinutes"] * 60) // 86400)

    def _award_badges(self, user_id: str) -> tuple[list[dict], int]:
        """Gives out every badge whose target has been reached. Returns the new ones and the bonus XP they brought."""
        cfg = self.config()
        new_badges: list[dict] = []
        bonus = 0
        for _ in range(4):  # a bonus can lift the level or XP past another target
            snap = self.snapshot(user_id)
            values = {**snap, "streak": max(snap["streak"], snap["bestStreak"])}
            rows, _ = self._db.run("SELECT code FROM user_badges WHERE user_id = ?", (user_id,))
            have = {r["code"] for r in rows}
            fresh = [b for b in cfg["badges"] if b["code"] not in have and values.get(b["rule"], 0) >= b["threshold"]]
            if not fresh:
                break
            now = time.time()
            for badge in fresh:
                self._db.run("INSERT INTO user_badges (user_id, code, earned_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", (user_id, badge["code"], now))
                new_badges.append({k: badge[k] for k in ("code", "name", "icon", "description", "bonusXp")})
                bonus += badge["bonusXp"]
            if bonus:
                self._db.run("UPDATE user_progress SET xp = xp + ? WHERE user_id = ?", (sum(b["bonusXp"] for b in fresh), user_id))
        return new_badges, bonus

    def _finish(self, user_id: str, before: dict, gained: int) -> dict:
        """After XP was added: hand out badges, then describe what changed for the toast the person sees."""
        new_badges, bonus = self._award_badges(user_id)
        after = self.snapshot(user_id)
        return {
            "xpGained": gained + bonus, "newBadges": new_badges, "levelUp": after["level"] > before["level"],
            "previousLevel": before["level"], **after,
        }

    def delete_user(self, user_id: str) -> list[str]:
        """Removes a person's library, favourites, XP, streak and badges. Returns the songs they uploaded that nobody else has in a
        library, whose audio and results can go with them."""
        rows, _ = self._db.run("SELECT session_id, video_id FROM library_items WHERE user_id = ?", (user_id,))
        uploads = [r["session_id"] for r in rows if not r["video_id"]]
        for table in ("library_items", "user_progress", "user_badges"):
            self._db.run(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
        alone = []
        for session_id in uploads:
            held, _ = self._db.run("SELECT COUNT(*) AS n FROM library_items WHERE session_id = ?", (session_id,))
            if int(held[0]["n"]) == 0:
                alone.append(session_id)
        return alone

    def record_play(self, user_id: str, session_id: str, meta: dict) -> dict:
        """A person pressed play on a song. Counts it (unless it is the same song again too soon) and pays out XP."""
        cfg, rules = self.config(), self.config()["xp"]
        now = time.time()
        before = self.snapshot(user_id)
        prior = self._get_item(user_id, session_id)
        if prior and prior["plays"] > 0 and now - prior["last_played_at"] < rules["repeatCooldownMinutes"] * 60:
            return {"counted": False, "xpGained": 0, "newBadges": [], "levelUp": False, "previousLevel": before["level"], **before}

        self._db.run(
            """
            INSERT INTO library_items (user_id, session_id, video_id, title, artist, thumbnail, duration, chords, plays, first_played_at, last_played_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(user_id, session_id) DO UPDATE SET
                plays = library_items.plays + 1,
                last_played_at = excluded.last_played_at,
                first_played_at = CASE WHEN library_items.first_played_at = 0 THEN excluded.first_played_at ELSE library_items.first_played_at END,
                video_id = excluded.video_id, title = excluded.title, artist = excluded.artist, duration = excluded.duration, chords = excluded.chords,
                thumbnail = CASE WHEN excluded.thumbnail != '' THEN excluded.thumbnail ELSE library_items.thumbnail END
            """,
            (user_id, session_id, *self._meta_values(meta), now, now),
        )
        is_new = prior is None or prior["plays"] == 0

        prog = self._progress(user_id)
        day = self._day(now, cfg)
        gained = rules["play"] + (rules["newSong"] if is_new else 0)
        streak, best = prog["streak"], prog["best_streak"]
        if prog["last_day"] != day:  # the first play of this day
            streak = streak + 1 if prog["last_day"] == day - 1 else 1
            best = max(best, streak)
            gained += rules["dailyFirst"] + rules["streakPerDay"] * (min(streak, rules["streakMaxDays"]) - 1)
        xp_today = prog["xp_today"] if prog["xp_day"] == day else 0
        if rules["dailyCap"] > 0:
            gained = max(0, min(gained, rules["dailyCap"] - xp_today))
        self._db.run(
            "UPDATE user_progress SET xp = xp + ?, streak = ?, best_streak = ?, last_day = ?, xp_day = ?, xp_today = ? WHERE user_id = ?",
            (gained, streak, best, day, day, xp_today + gained, user_id),
        )
        return {"counted": True, "firstTime": is_new, **self._finish(user_id, before, gained)}

    def set_favorite(self, user_id: str, session_id: str, meta: dict, on: bool, pays_xp: bool) -> dict:
        """Adds or removes a favourite. The first time a song is ever favourited it can pay a little XP."""
        before = self.snapshot(user_id)
        prior = self._get_item(user_id, session_id)
        gained = 0
        now = time.time()
        if on:
            first_time = prior is None or prior["favorited_at"] == 0
            self._db.run(
                """
                INSERT INTO library_items (user_id, session_id, video_id, title, artist, thumbnail, duration, chords, favorite, favorited_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                ON CONFLICT(user_id, session_id) DO UPDATE SET
                    favorite = 1,
                    favorited_at = CASE WHEN library_items.favorited_at = 0 THEN excluded.favorited_at ELSE library_items.favorited_at END
                """,
                (user_id, session_id, *self._meta_values(meta), now),
            )
            if first_time and pays_xp:
                prog = self._progress(user_id)
                day = self._day(now, self.config())
                rules = self.config()["xp"]
                xp_today = prog["xp_today"] if prog["xp_day"] == day else 0
                gained = rules["favorite"]
                if rules["dailyCap"] > 0:
                    gained = max(0, min(gained, rules["dailyCap"] - xp_today))
                self._db.run(
                    "UPDATE user_progress SET xp = xp + ?, xp_day = ?, xp_today = ? WHERE user_id = ?", (gained, day, xp_today + gained, user_id)
                )
        elif prior:
            if prior["plays"] == 0:
                self._db.run("DELETE FROM library_items WHERE user_id = ? AND session_id = ?", (user_id, session_id))
            else:
                self._db.run("UPDATE library_items SET favorite = 0 WHERE user_id = ? AND session_id = ?", (user_id, session_id))
        return {"favorite": on, **self._finish(user_id, before, gained)}
