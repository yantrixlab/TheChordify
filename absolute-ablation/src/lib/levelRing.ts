// A profile picture inside a ring that fills as a person gets to their next level, with their level on a small gold
// badge, like the player portrait in a game. Used in the menu bar, the account menu and the library page. `update` moves
// the ring when XP is earned, so it fills in front of the person's eyes.

export interface RingUser {
  name?: string;
  email?: string;
  picture?: string;
  level?: number;
  ring?: string; // a colour earned at a level: tints the empty part of the ring
  intoLevel?: number; // XP earned since the level began
  levelSpan?: number; // XP the whole level takes
}

const SVG = "http://www.w3.org/2000/svg";
let counter = 0;

const initials = (user: RingUser) =>
  (user.name || user.email || "?")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const levelFraction = (user: RingUser): number =>
  user.levelSpan && user.levelSpan > 0 ? Math.min(1, Math.max(0, (user.intoLevel ?? 0) / user.levelSpan)) : 0;

export function levelRing(user: RingUser, size: number, options: { chip?: boolean } = {}) {
  const stroke = Math.max(3, Math.round(size * 0.085));
  const gap = size >= 80 ? 4 : 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const id = `lr-${++counter}`;

  const wrap = document.createElement("span");
  wrap.className = "lr";
  wrap.style.width = wrap.style.height = `${size}px`;

  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "lr-svg");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="0.55" stop-color="#ec4899"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs>`;
  const track = document.createElementNS(SVG, "circle");
  const arc = document.createElementNS(SVG, "circle");
  for (const circle of [track, arc]) {
    circle.setAttribute("cx", String(size / 2));
    circle.setAttribute("cy", String(size / 2));
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke-width", String(stroke));
  }
  track.setAttribute("class", "lr-track");
  arc.setAttribute("class", "lr-arc");
  arc.setAttribute("stroke", `url(#${id})`);
  arc.setAttribute("stroke-linecap", "round");
  arc.setAttribute("stroke-dasharray", String(circumference));
  arc.setAttribute("stroke-dashoffset", String(circumference)); // empty, then it fills
  arc.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
  svg.append(track, arc);

  const face = document.createElement("span");
  face.className = "lr-face";
  face.style.inset = `${stroke + gap}px`;
  face.style.fontSize = `${Math.round(size * 0.3)}px`;
  if (user.picture) {
    const img = document.createElement("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.src = user.picture;
    img.addEventListener("error", () => img.replaceWith(document.createTextNode(initials(user))));
    face.append(img);
  } else {
    face.textContent = initials(user);
  }

  const chip = document.createElement("span");
  chip.className = "lr-lv";
  chip.style.fontSize = `${Math.max(10, Math.round(size * 0.22))}px`;
  chip.hidden = options.chip === false;

  wrap.append(svg, face, chip);

  let shownLevel = 0;
  const update = (next: RingUser) => {
    arc.setAttribute("stroke-dashoffset", String(circumference * (1 - levelFraction(next))));
    track.setAttribute("stroke", next.ring ? `${next.ring}66` : "");
    track.style.stroke = next.ring ? `${next.ring}66` : "";
    wrap.style.setProperty("--lr-ring", next.ring || "transparent");
    if (next.level) {
      chip.textContent = String(next.level);
      if (shownLevel && next.level > shownLevel) {
        chip.classList.remove("pop");
        void chip.offsetWidth; // restart the animation
        chip.classList.add("pop");
      }
      shownLevel = next.level;
    }
    chip.hidden = options.chip === false || !next.level;
  };
  update(user);
  // let the empty ring paint first so the fill is seen
  arc.style.transition = "none";
  arc.setAttribute("stroke-dashoffset", String(circumference));
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      arc.style.transition = "";
      arc.setAttribute("stroke-dashoffset", String(circumference * (1 - levelFraction(user))));
    }),
  );
  return { el: wrap, update };
}
