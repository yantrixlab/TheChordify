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
from html.parser import HTMLParser
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


# ---- the admin's own words for a song page: their HTML, with its own CSS, kept to what is safe -------------------------------
#
# Only admins can write this. It is still cleaned, so a page can carry a full design (headings, tables, FAQs, icons, a <style>
# block with classes) but never run code: scripts, iframes, forms, event handlers and unsafe addresses are removed, and the
# page's CSS is fenced into its own block (every rule is prefixed with .sp-custom) so it cannot restyle the site around it.

_ALLOWED_TAGS = {
    "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "a", "blockquote",
    "code", "pre", "img", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
    "span", "div", "details", "summary", "sub", "sup", "small", "mark", "kbd", "abbr", "cite", "q", "del", "ins", "time", "wbr",
    "dl", "dt", "dd", "section", "article", "header", "footer", "nav", "aside", "main", "address",
}
_SVG_TAGS = {
    "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "defs", "lineargradient", "radialgradient", "stop",
    "title", "text", "tspan",
}
_VOID_TAGS = {"br", "hr", "img", "wbr", "col"}
_DROP_WITH_CONTENT = {"script", "iframe", "object", "embed", "noscript", "template", "math", "form", "textarea", "select", "button", "input"}
_GLOBAL_ATTRS = {"class", "id", "style", "title", "role", "lang", "dir", "itemscope", "itemtype", "itemprop"}
_TAG_ATTRS = {
    "a": {"href"},
    "img": {"src", "alt", "width", "height"},
    "td": {"colspan", "rowspan", "scope"},
    "th": {"colspan", "rowspan", "scope"},
    "ol": {"start", "type"},
    "col": {"span", "width"},
    "colgroup": {"span"},
    "time": {"datetime"},
    "details": {"open"},
}
_SVG_ATTRS = {
    "viewbox", "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-opacity",
    "fill-opacity", "opacity", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "points", "transform", "offset",
    "stop-color", "stop-opacity", "fill-rule", "clip-rule", "xmlns", "preserveaspectratio", "font-size", "text-anchor",
    "font-weight", "gradientunits", "gradienttransform", "stroke-dasharray", "stroke-dashoffset", "dominant-baseline",
}
_MAX_RICH = 200000
_SCOPE = ".sp-custom"
_BAD_CSS = re.compile(r"expression\s*\(|javascript:|vbscript:|@import|-moz-binding|behavior\s*:", re.I)


def _safe_url(value: str, allow_mailto: bool) -> str:
    v = value.strip()
    low = re.sub(r"[\s\x00-\x1f]+", "", v).lower()
    if low.startswith(("https://", "http://", "/", "#")) and not low.startswith("//"):
        return v
    if allow_mailto and low.startswith("mailto:"):
        return v
    return ""


def _split_top(text: str, sep: str) -> list[str]:
    """Splits at `sep` outside brackets and quotes."""
    parts, depth, quote, start = [], 0, "", 0
    for i, ch in enumerate(text):
        if quote:
            if ch == quote:
                quote = ""
        elif ch in "\"'":
            quote = ch
        elif ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(depth - 1, 0)
        elif ch == sep and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    return parts


def _url_ok(raw: str) -> bool:
    u = raw.strip().strip("'\"").strip()
    low = re.sub(r"\s+", "", u).lower()
    return (low.startswith(("https://", "/")) and not low.startswith("//")) or bool(re.match(r"data:image/(png|jpe?g|gif|webp|svg\+xml)[;,]", low))


def _clean_decls(text: str) -> str:
    """CSS declarations without anything that runs code or fetches from an unsafe address."""
    out = []
    for decl in _split_top(text, ";"):
        if ":" not in decl:
            continue
        prop, value = decl.split(":", 1)
        prop, value = prop.strip().lower(), value.strip().replace("<", "").replace(">", "")
        if not (re.fullmatch(r"-?[a-z][a-z0-9-]*", prop) or re.fullmatch(r"--[\w-]+", prop)):
            continue
        if _BAD_CSS.search(prop) or _BAD_CSS.search(value):
            continue
        if any(not _url_ok(u) for u in re.findall(r"url\(\s*([^)]*?)\s*\)", value, flags=re.I)):
            continue
        if prop == "position" and value.lower().startswith("fixed"):
            value = "absolute"  # nothing may be pinned over the site's own menu
        out.append(f"{prop}:{value}")
    return ";".join(out)


def _scope_css(css: str, depth: int = 0) -> str:
    """The page's own CSS with every rule fenced into .sp-custom (html, body and :root become the block itself)."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"@(?:import|charset|namespace)[^;]*;", "", css, flags=re.I)
    out: list[str] = []
    i, n = 0, len(css)
    while i < n:
        j = css.find("{", i)
        if j == -1:
            break
        head = css[i:j].strip()
        level, k = 1, j + 1
        while k < n and level:
            level += (css[k] == "{") - (css[k] == "}")
            k += 1
        body = css[j + 1 : k - 1]
        i = k
        if not head:
            continue
        low = head.lower()
        if low.startswith("@"):
            if re.match(r"@(media|supports|container|layer)\b", low) and depth < 3:
                inner = _scope_css(body, depth + 1)
                if inner:
                    out.append(f"{head}{{{inner}}}")
            elif re.match(r"@(-webkit-)?keyframes\b", low):
                out.append(head + "{" + re.sub(r"\{([^{}]*)\}", lambda m: "{" + _clean_decls(m.group(1)) + "}", body) + "}")
            continue  # @font-face, @page and the rest are not carried over
        scoped = []
        for sel in _split_top(head, ","):
            sel = sel.strip()
            if not sel or not re.fullmatch(r"[\w\s.#:>+~*\[\]=\"'^$|()\-%,!\\]+", sel):
                continue
            root = re.match(r"(?:html|body|:root)(?![\w-])\s*", sel, re.I)
            if root:
                rest = sel[root.end() :]
                scoped.append(_SCOPE + (rest if rest[:1] in (".", ":", "[", "#") else (" " + rest if rest else "")))
            elif sel == "*":
                scoped.append(f"{_SCOPE}, {_SCOPE} *")
            else:
                scoped.append(f"{_SCOPE} {sel}")
        decls = _clean_decls(body)
        if scoped and decls:
            out.append(f"{', '.join(scoped)}{{{decls}}}")
    return "".join(out)


class _Cleaner(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.out: list[str] = []
        self.open: list[str] = []
        self.skip = 0  # inside a tag whose content is thrown away
        self.svg = 0  # inside an inline picture
        self.css: list[str] = []
        self.style: Optional[list[str]] = None  # the text of the <style> being read

    def _attrs(self, tag: str, attrs: list) -> str:
        kept = []
        in_svg = self.svg > 0 or tag == "svg"
        allowed = _GLOBAL_ATTRS | _TAG_ATTRS.get(tag, set()) | (_SVG_ATTRS if in_svg else set())
        for name, value in attrs:
            value = "" if value is None else value
            if name.startswith("aria-"):
                value = re.sub(r"[<>\"']", "", value)[:200]
            elif name not in allowed:
                continue
            elif name == "href":
                value = _safe_url(value, True)
                if not value:
                    continue
                if value.startswith("#"):
                    value = "#c-" + re.sub(r"[^\w\-:.]", "", value[1:])  # the ids are prefixed, so the links are too
            elif name == "src":
                value = _safe_url(value, False)
                if not value or value.startswith("#"):
                    continue
            elif name == "id":
                value = "c-" + re.sub(r"[^\w\-:.]", "", value)
            elif name == "class":
                value = re.sub(r"[^\w\- ]", "", value)
            elif name == "style":
                value = _clean_decls(value)
                if not value:
                    continue
            elif name in ("width", "height", "colspan", "rowspan", "start", "span") and tag not in ("svg", "col") and not in_svg:
                if not re.fullmatch(r"\d{1,4}", value.strip()):
                    continue
            elif name in ("open", "itemscope"):
                value = name
            elif in_svg and name not in _GLOBAL_ATTRS:
                if _BAD_CSS.search(value) or "<" in value:
                    continue
            kept.append(f' {name}="{html.escape(value, quote=True)}"')
        return "".join(kept)

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag == "style":
            if not self.skip:
                self.style = []
            return
        if tag in _DROP_WITH_CONTENT or (tag == "title" and self.svg == 0):
            self.skip += 1
            return
        if self.skip or self.style is not None:
            return
        if not (tag in _ALLOWED_TAGS or tag == "svg" or (tag in _SVG_TAGS and self.svg > 0)):
            return
        extra = ""
        if tag == "a":
            href = next((v for n, v in attrs if n == "href" and v), "")
            external = href.strip().lower().startswith(("http://", "https://")) and "chordsuno.com" not in href.lower()
            extra = ' rel="noopener nofollow ugc" target="_blank"' if external else ' rel="noopener"'
        built = self._attrs(tag, attrs)
        if tag == "img":
            if " src=" not in built:
                return  # a picture with no safe address is dropped
            extra = ' loading="lazy"'
        self.out.append(f"<{tag}{built}{extra}>")
        if tag not in _VOID_TAGS:
            self.open.append(tag)
            if tag == "svg":
                self.svg += 1

    def handle_startendtag(self, tag: str, attrs: list) -> None:
        if tag in _DROP_WITH_CONTENT or tag == "style":
            return  # <script/> and the like: nothing to skip
        self.handle_starttag(tag, attrs)
        if tag not in _VOID_TAGS and tag in self.open:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag == "style":
            if self.style is not None:
                self.css.append("".join(self.style))
                self.style = None
            return
        if tag in _DROP_WITH_CONTENT or (tag == "title" and self.svg == 0):
            self.skip = max(self.skip - 1, 0)
            return
        if self.skip or tag in _VOID_TAGS or tag not in self.open:
            return
        while self.open:  # close anything left open inside it
            top = self.open.pop()
            self.out.append(f"</{top}>")
            if top == "svg":
                self.svg = max(self.svg - 1, 0)
            if top == tag:
                break

    def handle_data(self, data: str) -> None:
        if self.style is not None:
            self.style.append(data)
        elif not self.skip:
            self.out.append(html.escape(data, quote=False))

    def handle_entityref(self, name: str) -> None:
        if self.style is None and not self.skip:
            self.out.append(f"&{name};" if re.fullmatch(r"[a-zA-Z0-9]{1,12}", name) else "")

    def handle_charref(self, name: str) -> None:
        if self.style is None and not self.skip:
            self.out.append(f"&#{name};" if re.fullmatch(r"x?[0-9a-fA-F]{1,6}", name) else "")

    def result(self) -> tuple[str, bool]:
        if self.style is not None:
            self.css.append("".join(self.style))
            self.style = None
        while self.open:
            self.out.append(f"</{self.open.pop()}>")
        css = _scope_css("\n".join(self.css)) if self.css else ""
        body = "".join(self.out)
        return (f"<style>{css}</style>" if css else "") + body, bool(css)


def render_rich(text: str) -> tuple[str, bool]:
    """(safe HTML, whether it brings its own styles). Text with no tags at all (older pages) becomes paragraphs."""
    text = (text or "").strip()[:_MAX_RICH]
    if not text:
        return "", False
    if "<" not in text:
        return "".join(f"<p>{html.escape(part.strip())}</p>" for part in re.split(r"\n\s*\n", text) if part.strip()), False
    cleaner = _Cleaner()
    cleaner.feed(text)
    cleaner.close()
    return cleaner.result()


def clean_rich(text: str) -> str:
    return render_rich(text)[0]


def _chart_html(result: dict) -> str:
    """The whole song as the player's chords grid: sections, rows of bars, one cell per beat with the chord written in the
    cell where it starts (the cell the analysis chose for it). Plain HTML, so it is text a search engine can read."""
    bars = result.get("bars") or []
    chords = result.get("chords") or []
    if not bars or not chords:
        return ""
    per_bar = int(result.get("beatsPerBar") or max((len(b.get("beats") or []) - 1 for b in bars), default=4) or 4)
    per_bar = min(max(per_bar, 2), 12)
    duration = float(result.get("duration") or 0)
    first_sound = next((i for i, c in enumerate(chords) if c.get("chord") != "N"), len(chords))
    placed = [
        (c["chord"], float(c["gridStart"] if c.get("gridStart") is not None else c["start"]))
        for i, c in enumerate(chords)
        if c.get("gridStart") is not None and not (c.get("chord") == "N" and i < first_sound)
    ]

    # the chord written in each beat cell: the one whose cell time is nearest, within half a beat
    written: list[list] = []
    nxt = 0
    for bar in bars:
        beats = list(bar.get("beats") or [])
        cells = []
        for k in range(per_bar):
            t0 = beats[k] if k < len(beats) else None
            if t0 is None:
                cells.append(None)
                continue
            t1 = next((b for b in beats[k + 1 :] if b is not None), duration or t0 + 0.5)
            half = max(float(t1) - float(t0), 0.05) / 2
            while nxt < len(placed) and placed[nxt][1] < float(t0) - half:
                nxt += 1
            if nxt < len(placed) and placed[nxt][1] < float(t0) + half:
                cells.append(placed[nxt][0])
                nxt += 1
            else:
                cells.append("")
        written.append(cells)

    sections = [s for s in (result.get("sections") or []) if s.get("startBar") is not None]
    if not sections:
        sections = [{"label": "", "startBar": 0, "endBar": len(bars) - 1}]
    per_row = 2 if per_bar >= 6 else 4

    def kind(label: str) -> str:
        word = (label.split(" ")[0] if label else "").lower()
        return word if word in ("intro", "verse", "chorus", "bridge", "outro", "instrumental", "break") else "part"

    out = [f'<div class="sg"{" data-wide" if per_bar >= 5 else ""} style="--bpb:{per_bar};--rb:{per_row}">']
    for si, sec in enumerate(sections):
        start = 0 if si == 0 else int(sec["startBar"])
        end = len(bars) - 1 if si == len(sections) - 1 else int(sec.get("endBar") if sec.get("endBar") is not None else sec["startBar"])
        end = min(end, len(bars) - 1)
        if end < start:
            continue
        label = sec.get("label") or ""
        out.append(f'<section class="sg-sec is-{kind(label)}">')
        if label:
            out.append(f'<h3 class="sg-tag">{_esc(label)}</h3>')
        out.append('<div class="sg-body">')
        for row_start in range(start, end + 1, per_row):
            out.append('<div class="sg-row">')
            for b in range(row_start, min(row_start + per_row, end + 1)):
                cells = "".join(
                    '<span class="sg-c is-empty"></span>'
                    if c is None
                    else f'<span class="sg-c{" has" if c else ""}">{_esc("—" if c == "N" else c)}</span>'
                    for c in written[b]
                )
                out.append(f'<div class="sg-bar">{cells}</div>')
            out.append("</div>")
        out.append("</div></section>")
    out.append("</div>")
    return "".join(out)


_ARROW_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15M6 13l6 6 6-6"/></svg>'
_ARROW_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5M6 11l6-6 6 6"/></svg>'


def _strum_tiles(pattern: list, sub: int) -> str:
    names = ["", "&"] if sub == 2 else ["", "e", "&", "a"]
    out = []
    for i, kind in enumerate(pattern):
        within = i % sub
        count = str(i // sub + 1) if within == 0 else names[within]
        words = "down-strum" if kind == "D" else "up-strum" if kind == "U" else "no strum"
        out.append(
            f'<div class="sm-tile {"is-rest" if kind == "-" else "is-down" if kind == "D" else "is-up"}" role="listitem" aria-label="{count}: {words}">'
            f'<span class="sm-ar">{_ARROW_DOWN if kind == "D" else _ARROW_UP if kind == "U" else "<span aria-hidden=true>·</span>"}</span>'
            f'<small>{count.replace("&", "&amp;")}</small></div>'
        )
    return "".join(out)


def _strum_html(strum: Optional[dict], title: str) -> str:
    """The strumming patterns as the player shows them (arrows over a count), for a song page."""
    if not isinstance(strum, dict) or int(strum.get("v") or 1) < 2:
        return ""
    found = strum.get("patterns") or [
        {"pattern": strum.get("pattern"), "sub": strum.get("sub") or 2, "kind": strum.get("kind") or ("heard" if strum.get("detected") else "typical"), "where": []}
    ]
    per_bar = int(strum.get("perBar") or 4)
    bpm = int(round(float(strum.get("bpm") or 0)))
    feel = "slow, relaxed" if bpm < 80 else "easy" if bpm < 110 else "upbeat" if bpm < 140 else "fast"
    counts = ", ".join(str(i + 1) for i in range(per_bar))
    blocks = []
    for n, p in enumerate(found[:3]):
        pattern = p.get("pattern") or []
        sub = 4 if p.get("sub") == 4 else 2
        if not isinstance(pattern, list) or len(pattern) < 4 or any(c not in ("D", "U", "-") for c in pattern):
            continue
        kind = p.get("kind") or "typical"
        where = " and ".join(_esc(w) for w in (p.get("where") or []))
        shown = " ".join("–" if c == "-" else c for c in pattern)
        word = "MAIN PATTERN" if kind == "heard" else "BEST GUESS" if kind == "guess" else "SUGGESTED PATTERN"
        if len(found) > 1:
            word = f"PATTERN {n + 1}"
        pill = "Heard in the song" if kind == "heard" else "Best guess" if kind == "guess" else "Suggested"
        intro = (
            (f"Played in the {where}, at the song's {feel} {bpm} BPM groove." if where else f"The pattern the recording keeps coming back to, at the song's {feel} {bpm} BPM groove.")
            if kind == "heard"
            else (
                f"The strumming here is not steady enough to be sure, so this is our best guess from the beats that stand out, at the song's {feel} {bpm} BPM feel."
                if kind == "guess"
                else f"We could not hear one clear strum, so this is a typical {per_bar}-beat pattern for the song's {feel} {bpm} BPM feel."
            )
        )
        blocks.append(
            f'<div class="sm-one"><div class="sm-ttl"><span class="sm-pill{" is-heard" if kind == "heard" else ""}">{pill}</span></div>'
            f'<p class="sm-label">{word}{" · " + where.upper() if where else ""}  ·  {_esc(shown)}</p>'
            f'<div class="sm-tiles" style="--cols:{min(len(pattern), 8)}" role="list" aria-label="Strums in one bar">{_strum_tiles(pattern, sub)}</div>'
            f'<p class="sm-text">{intro}</p></div>'
        )
    if not blocks:
        return ""
    kinds = {p.get("kind") for p in found}
    note = (
        "A suggestion for this time signature, not a pattern heard in the song."
        if kinds == {"typical"}
        else "Worked out from the recording. Down and up strokes cannot be heard, so the usual picture is shown: the hand keeps moving down and up, so strokes on the beat are down-strums and strokes on the &ldquo;&amp;&rdquo; up-strums. Lighter and muted strokes may be missing."
    )
    return (
        '<section class="sp-block" id="strumming"><h2>Strumming pattern' + ("s" if len(blocks) > 1 else "") + "</h2>"
        '<div class="sm-card">'
        + "".join(blocks)
        + '<details class="sm-how"><summary>How to play it</summary><div>'
        "<p>↓ is a down-strum, ↑ an up-strum, and a dim tile is a beat you let ring or skip. Count along: the numbers are the beats, &ldquo;&amp;&rdquo; is the half beat between them (and &ldquo;e&rdquo; and &ldquo;a&rdquo; the quick strokes either side of it).</p>"
        f"<p><b>Just starting out?</b> Play steady down-strums on every beat ({counts}) until the chord changes of {_esc(title)} feel comfortable, then add the other strokes.</p>"
        "</div></details>"
        f'<p class="sm-note">{note}</p>'
        "</div></section>"
    )


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

    def admin_list(
        self, search: str = "", page: int = 1, size: int = 25, status: str = "all", since: float = 0.0, until: float = 0.0
    ) -> dict:
        """The catalog for the admin. `status` is all, published or unpublished; `since`/`until` (seconds, 0 = open) limit it to
        songs first chordified in that stretch of time."""

        where, params = [], []
        if search:
            where.append("(LOWER(s.title) LIKE ? OR LOWER(s.artist) LIKE ?)")
            like = f"%{search.lower()}%"
            params += [like, like]
        if status == "published":
            where.append("p.video_id IS NOT NULL")
        elif status == "unpublished":
            where.append("p.video_id IS NULL")
        if since > 0:
            where.append("s.created_at >= ?")
            params.append(since)
        if until > 0:
            where.append("s.created_at < ?")
            params.append(until)
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
            (video_id, final, title, artist, intro.strip()[:_MAX_RICH], now, now),
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
        chips = "".join(f"<span>{_esc(c)}</span>" for c in used[:24])
        # the diagrams are drawn in the browser (the same shapes as the player); the name is here for everyone else
        diagrams = "".join(
            f'<figure class="sp-dg" data-chord="{_esc(c)}"><div class="sp-dg-art" aria-hidden="true"></div>'
            f'<figcaption><strong>{_esc(c)}</strong><small class="sp-dg-notes"></small></figcaption>'
            '<div class="sp-dg-nav" hidden><button type="button" data-step="-1" aria-label="Previous way to play">‹</button>'
            '<span></span><button type="button" data-step="1" aria-label="Next way to play">›</button></div></figure>'
            for c in used[:24]
        )
        diagrams_html = (
            f'<section class="sp-block" id="diagrams"><h2>Chord diagrams</h2>'
            f'<p class="sp-sub">Every chord in {_esc(title)}, as it is fingered on guitar. Use the arrows on a chord to see other ways to play it.</p>'
            f'<div class="sp-dgs">{diagrams}</div></section>'
            if used
            else ""
        )

        chart = _chart_html(result)
        chart_html = (
            '<section class="sp-block" id="chart"><h2>Chord chart</h2>'
            f'<p class="sp-sub">The whole of {_esc(title)}, bar by bar and beat by beat. A chord is written on the beat where it starts and carries on until the next one.</p>'
            f"{chart}"
            f'<p class="sp-chart-cta"><a class="sp-play" href="/play?session={_esc(row["session_id"])}">▶ Play along with the chords</a></p></section>'
            if chart
            else ""
        )

        strum_html = _strum_html(result.get("strum"), title)
        intro, custom = render_rich(row["intro"])
        if intro and custom:
            about = ""  # a designed page: shown as it is, with its own headings and no extra text around it
        elif intro:
            about = f'<div class="sp-rich">{intro}</div>'
        else:
            about = (
                f"<p>{_esc(title)}{(' by ' + _esc(artist)) if artist else ''} is in the key of {_esc(key)} at about {tempo} BPM, "
                f"counted in {_time_signature(per_bar)}.</p>"
                if key and tempo
                else f"<p>Chords for {_esc(name)}.</p>"
            )
        if not (intro and custom):
            about += (
                f"<p>These chords were worked out automatically from the song's audio, with the chord changes placed on the beat. "
                f"Open the player to follow {_esc(title)} chord by chord, slow it down, loop a section, transpose it, or see it for "
                f"piano, ukulele and mandolin. Real recordings differ a little from any chart, so use your ear as the last word.</p>"
            )
        about_html = (
            f'<section class="sp-custom-wrap" id="about"><div class="sp-custom">{intro}</div></section>'
            if intro and custom
            else f'<section class="sp-block" id="about"><h2>About these chords</h2>{about}</section>'
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
            '<header class="sp-hero">'
            f'<img src="https://i.ytimg.com/vi/{_esc(row["video_id"])}/hqdefault.jpg" alt="{_esc(name)}" width="480" height="360" />'
            f'<div class="sp-hero-text"><p class="sp-eyebrow">Chords</p><h1>{_esc(title)} chords</h1>'
            f'{f"<p class=sp-by>{_esc(artist)}</p>" if artist else ""}'
            f'<div class="sp-cta"><a class="sp-play" href="/play?session={_esc(row["session_id"])}">▶ Play along with the chords</a>'
            f'{"<a class=sp-ghost href=#diagrams>Chord diagrams</a>" if used else ""}</div>'
            "<small>Synced to the beat · chord diagrams for guitar, piano, ukulele &amp; mandolin</small></div></header>"
            f'<dl class="sp-facts">{facts_html}</dl>'
            f'<section class="sp-block"><h2>Chords used in {_esc(title)}</h2><div class="sp-chips">{chips}</div></section>'
            f"{diagrams_html}"
            f"{chart_html}"
            f"{strum_html}"
            f"{about_html}"
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
