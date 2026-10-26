// The search bar in the top toolbar. Focus it and it offers what this browser looked for lately (songs to open again, and
// searches); type and it offers songs that can be opened straight away plus likely searches. Up and down move through the
// list, Enter opens the highlighted one (or searches for what was typed), Escape closes, and "/" jumps to the bar.
// On a phone the bar is a button that opens a full-width search at the top of the screen.
import { getApiErrorMessage, getPopularSongs, startExtractFromYoutube, suggestSongs } from "./api";
import type { SongHit } from "./api";
import { jamLabel } from "./format";
import { clearRecents, forget, getRecents, rememberQuery, rememberSong } from "./recent";
import type { Recent } from "./recent";
import { goToProcessing } from "./backNav";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const ICON = {
  search: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="5.8" stroke="currentColor" stroke-width="1.8"/><path d="m13.5 13.5 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  clock: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M10 6v4.2l2.8 1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  spin: '<svg class="ns-spin" width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.7" stroke-opacity="0.3"/><path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

/** The text with the words that were typed picked out, built from nodes (never from markup). */
function highlight(text: string, query: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2))].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) {
    fragment.append(text);
    return fragment;
  }
  text.split(new RegExp(`(${words.join("|")})`, "ig")).forEach((part, index) => {
    if (index % 2 === 1) fragment.append(el("mark", "", part));
    else if (part) fragment.append(part);
  });
  return fragment;
}

interface Option {
  node: HTMLElement;
  run: () => void;
}

export function initNavSearch() {
  const root = document.getElementById("ns");
  const input = document.getElementById("ns-input") as HTMLInputElement | null;
  const panel = document.getElementById("ns-panel");
  const openButton = document.getElementById("ns-open");
  const closeButton = document.getElementById("ns-close");
  if (!root || !input || !panel || !openButton || !closeButton) return;

  let options: Option[] = [];
  let active = -1;
  let controller: AbortController | null = null;
  let timer: number | undefined;
  let latest = 0;
  let popular: SongHit[] | null = null;

  // ---- opening and closing ------------------------------------------------------------------------------------------

  function openPanel() {
    panel!.hidden = false;
    root!.classList.add("is-focus");
    input!.setAttribute("aria-expanded", "true");
  }

  function closePanel() {
    panel!.hidden = true;
    root!.classList.remove("is-focus", "is-sheet");
    input!.setAttribute("aria-expanded", "false");
    input!.removeAttribute("aria-activedescendant");
    document.body.style.overflow = "";
    active = -1;
  }

  function openSheet() {
    root!.classList.add("is-sheet");
    document.body.style.overflow = "hidden";
    input!.focus();
  }

  // ---- the list -----------------------------------------------------------------------------------------------------

  function setActive(next: number) {
    options[active]?.node.classList.remove("is-active");
    options[active]?.node.setAttribute("aria-selected", "false");
    active = next;
    const option = options[active];
    if (option) {
      option.node.classList.add("is-active");
      option.node.setAttribute("aria-selected", "true");
      option.node.scrollIntoView({ block: "nearest" });
      input!.setAttribute("aria-activedescendant", option.node.id);
    } else {
      input!.removeAttribute("aria-activedescendant");
    }
  }

  function show(parts: HTMLElement[], list: Option[]) {
    panel!.replaceChildren(...parts);
    options = list;
    active = -1;
    input!.removeAttribute("aria-activedescendant");
    openPanel();
  }

  /** Marks `node` as a choice in the list: it can be clicked, or reached with the arrow keys. */
  function choice(node: HTMLElement, collected: Option[], run: () => void) {
    node.id = `ns-opt-${collected.length}`;
    node.setAttribute("role", "option");
    node.setAttribute("aria-selected", "false");
    const index = collected.length;
    collected.push({ node, run });
    node.addEventListener("click", run);
    node.addEventListener("mousemove", () => active !== index && setActive(index));
    return node;
  }

  const heading = (label: string, action?: { text: string; run: () => void }) => {
    const row = el("div", "ns-head");
    row.append(el("span", "", label));
    if (action) {
      const button = el("button", "ns-link", action.text);
      button.type = "button";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        action.run();
      });
      row.append(button);
    }
    return row;
  };

  const message = (text: string) => el("p", "ns-empty", text);

  function songRow(song: { videoId: string; title: string; artist: string; thumbnail?: string; duration?: number; chords?: string[]; jams?: number }, query: string, collected: Option[], recent?: Recent) {
    const row = el("div", "ns-row");
    const art = el("span", "ns-art");
    if (song.thumbnail) {
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.src = song.thumbnail;
      art.append(img);
    }
    const text = el("span", "ns-text");
    const title = el("span", "ns-title");
    title.append(highlight(song.title, query));
    const sub = el("span", "ns-sub");
    sub.append(song.artist || "Song");
    text.append(title, sub);
    if (song.chords && song.chords.length > 0) {
      const ready = el("span", "ns-ready");
      song.chords.slice(0, 3).forEach((chord) => ready.append(el("b", "", chord)));
      if (song.jams) ready.append(el("em", "", jamLabel(song.jams)));
      text.append(ready);
    }
    row.append(art, text);
    if (recent) {
      const remove = el("button", "ns-x");
      remove.type = "button";
      remove.innerHTML = ICON.close;
      remove.setAttribute("aria-label", `Remove ${song.title} from recent searches`);
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        forget(recent);
        showIdle();
      });
      row.append(remove);
    } else {
      const go = el("span", "ns-go");
      go.innerHTML = song.chords && song.chords.length > 0 ? `Open ${ICON.arrow}` : `Get chords ${ICON.arrow}`;
      row.append(go);
    }
    return choice(row, collected, () => pickSong(song, row));
  }

  function queryRow(text: string, query: string, icon: "clock" | "search", collected: Option[], recent?: Recent) {
    const row = el("div", "ns-row ns-row-query");
    const mark = el("span", "ns-mark");
    mark.innerHTML = ICON[icon];
    const label = el("span", "ns-title");
    label.append(highlight(text, query));
    row.append(mark, label);
    if (recent) {
      const remove = el("button", "ns-x");
      remove.type = "button";
      remove.innerHTML = ICON.close;
      remove.setAttribute("aria-label", `Remove ${text} from recent searches`);
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        forget(recent);
        showIdle();
      });
      row.append(remove);
    }
    return choice(row, collected, () => searchFor(text));
  }

  function seeAll(query: string, collected: Option[]) {
    const row = el("div", "ns-row ns-all");
    const mark = el("span", "ns-mark");
    mark.innerHTML = ICON.search;
    const label = el("span", "ns-title");
    label.append("See all results for ", el("strong", "", `“${query}”`));
    const go = el("span", "ns-go");
    go.innerHTML = ICON.arrow;
    row.append(mark, label, go);
    return choice(row, collected, () => searchFor(query));
  }

  // ---- what to show -------------------------------------------------------------------------------------------------

  async function showIdle() {
    const mine = ++latest;
    controller?.abort();
    const recents = getRecents();
    const collected: Option[] = [];
    if (recents.length > 0) {
      const rows = recents.map((r) =>
        r.type === "song"
          ? songRow(r, "", collected, r)
          : queryRow(r.q, "", "clock", collected, r),
      );
      show([heading("Recent searches", { text: "Clear all", run: () => { clearRecents(); showIdle(); } }), ...rows], collected);
      return;
    }
    // Nothing yet: the songs people are playing most, so the list is never an empty box.
    if (popular === null) {
      show([heading("Popular on Chord Suno"), ...Array.from({ length: 4 }, () => el("div", "ns-ghost"))], []);
      popular = await getPopularSongs().catch(() => []);
      if (mine !== latest || input!.value.trim().length >= 2) return;
    }
    if (popular.length > 0) {
      const rows = popular.slice(0, 8).map((s) => songRow(s, "", collected));
      show([heading("Popular on Chord Suno"), ...rows], collected);
    } else {
      show([message("Search for any song or artist, and pick one to get its chords.")], []);
    }
  }

  async function lookup(query: string) {
    const mine = ++latest;
    controller?.abort();
    controller = new AbortController();
    show([heading("Songs"), ...Array.from({ length: 3 }, () => el("div", "ns-ghost"))], []);
    try {
      const found = await suggestSongs(query, controller.signal);
      if (mine !== latest) return;
      const collected: Option[] = [];
      const parts: HTMLElement[] = [];
      if (found.songs.length > 0) {
        parts.push(heading("Songs"), ...found.songs.map((s) => songRow(s, query, collected)));
      }
      if (found.queries.length > 0) {
        parts.push(heading("Related searches"), ...found.queries.map((q) => queryRow(q, query, "search", collected)));
      }
      if (parts.length === 0) parts.push(message(`No suggestions for “${query}”.`));
      parts.push(seeAll(query, collected));
      show(parts, collected);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // a newer keystroke replaced this one
      if (mine !== latest) return;
      const collected: Option[] = [];
      show([message("Suggestions are not available right now, but you can still search."), seeAll(query, collected)], collected);
    }
  }

  // ---- doing something with a choice --------------------------------------------------------------------------------

  function searchFor(query: string) {
    rememberQuery(query);
    window.location.href = `/search?q=${encodeURIComponent(query)}`;
  }

  async function pickSong(song: { videoId: string; title: string; artist: string; thumbnail?: string; duration?: number }, row: HTMLElement) {
    rememberSong(song);
    row.classList.add("is-busy");
    const slot = row.querySelector(".ns-go, .ns-x");
    if (slot) slot.innerHTML = ICON.spin;
    try {
      const { sessionId } = await startExtractFromYoutube(`https://www.youtube.com/watch?v=${song.videoId}`, {
        title: song.title,
        artist: song.artist,
        thumbnail: song.thumbnail,
        duration: song.duration,
      });
      goToProcessing(sessionId);
    } catch (err) {
      row.classList.remove("is-busy");
      panel!.prepend(el("p", "ns-error", getApiErrorMessage(err, "Could not start that song. Please try again.")));
      if (slot) slot.innerHTML = ICON.arrow;
    }
  }

  // ---- wiring -------------------------------------------------------------------------------------------------------

  const refresh = () => {
    const query = input.value.trim().replace(/\s+/g, " ");
    window.clearTimeout(timer);
    if (query.length < 2) {
      void showIdle();
      return;
    }
    timer = window.setTimeout(() => void lookup(query), 220);
  };

  input.addEventListener("focus", refresh);
  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (panel.hidden) refresh();
      if (options.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(active === -1 ? (step === 1 ? 0 : options.length - 1) : (active + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0) options[active].run();
      else if (input.value.trim().length >= 2) searchFor(input.value.trim());
    } else if (event.key === "Escape") {
      closePanel();
      input.blur();
    }
  });
  // The search button: a search for what was typed (a suggestion the pointer happens to rest on is not what was asked for).
  (document.getElementById("ns-form") as HTMLFormElement).addEventListener("submit", (event) => {
    event.preventDefault();
    if (input.value.trim().length >= 2) searchFor(input.value.trim());
    else input.focus(); // nothing to search for yet
  });
  openButton.addEventListener("click", openSheet);
  closeButton.addEventListener("click", () => {
    closePanel();
    input.blur();
  });
  document.addEventListener("mousedown", (event) => {
    const target = event.target as Node;
    if (!root.contains(target) && !openButton.contains(target)) closePanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = (document.activeElement?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || (document.activeElement as HTMLElement | null)?.isContentEditable) return;
    event.preventDefault();
    if (getComputedStyle(root).display === "none") openSheet();
    else input.focus();
  });
}
