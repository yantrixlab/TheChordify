// Glossy artwork for the rewards in the library, drawn as SVG in code (no image files): an avatar ring (a metal or gemstone ring around a small
// avatar), a prestige star (a faceted star with a halo) and, in pickArt.ts, a guitar pick. Each takes the reward's colour, and the name tells the
// material ("Gold ring", "Ruby star", "Eternal star"), so a reward looks like what it is called.
import { darken, isPick, lighten, MATERIALS, pickSvg, type Material } from "./pickArt";

let counter = 0;

/** What colour a reward is when its Value does not say (a star has no colour field): from a word in the name, else gold. */
const NAMED: [RegExp, string][] = [
  [/bronze/, "#cd7f32"],
  [/copper/, "#b87333"],
  [/silver/, "#c0c7d1"],
  [/platinum/, "#e5e7eb"],
  [/ruby/, "#dc2626"],
  [/sapphire/, "#2563eb"],
  [/emerald/, "#10b981"],
  [/amethyst/, "#7c3aed"],
  [/diamond/, "#b9f2ff"],
  [/eternal/, "#ff3fa4"],
  [/gold/, "#f5b82e"],
];

export function rewardColor(name: string, value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  return NAMED.find(([word]) => word.test(name.toLowerCase()))?.[1] ?? "#f5b82e";
}

const materialOf = (name: string): Material => MATERIALS.find(([pattern]) => pattern.test(name.toLowerCase()))?.[1] ?? "plain";
const safe = (text: string) => text.replace(/[<>&"]/g, "");

/** The body gradient of a ring or star: bright metal bands for a metal, the rainbow for the holographic one, otherwise the colour lit from the top left. */
function body(id: string, material: Material, color: string): string {
  if (material === "metal") {
    return `<linearGradient id="${id}b" x1="0.1" y1="0" x2="0.9" y2="1"><stop offset="0" stop-color="${lighten(color, 0.72)}"/><stop offset="0.3" stop-color="${color}"/><stop offset="0.55" stop-color="${darken(color, 0.4)}"/><stop offset="0.78" stop-color="${lighten(color, 0.5)}"/><stop offset="1" stop-color="${darken(color, 0.32)}"/></linearGradient>`;
  }
  if (material === "holo") {
    return `<linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3fa4"/><stop offset="0.28" stop-color="#ffb347"/><stop offset="0.52" stop-color="#5eead4"/><stop offset="0.76" stop-color="#a78bfa"/><stop offset="1" stop-color="#ff3fa4"/></linearGradient>`;
  }
  return `<linearGradient id="${id}b" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="${lighten(color, 0.5)}"/><stop offset="0.45" stop-color="${color}"/><stop offset="1" stop-color="${darken(color, 0.42)}"/></linearGradient>`;
}

const sparkle = (x: number, y: number, r: number, opacity = 0.95) =>
  `<path d="M${x} ${y - r}l${r * 0.34} ${r * 0.66} ${r * 0.66} ${r * 0.34}-${r * 0.66} ${r * 0.34}-${r * 0.34} ${r * 0.66}-${r * 0.34}-${r * 0.66}-${r * 0.66}-${r * 0.34} ${r * 0.66}-${r * 0.34}z" fill="#fff" opacity="${opacity}"/>`;

const shadow = (id: string) =>
  `<filter id="${id}d" x="-25%" y="-25%" width="150%" height="160%"><feDropShadow dx="0" dy="2.4" stdDeviation="2.2" flood-color="#000" flood-opacity="0.45"/></filter>`;

/** An avatar ring: a glossy metal or gemstone ring around a small avatar, with a gem set at the top for the stone names. */
export function ringSvg(name: string, value: string, size = 46): string {
  const color = rewardColor(name, value);
  const material = materialOf(name);
  const id = `rg${++counter}`;
  const R = 28;
  const r = 18.6;
  // the ring is the area between two circles (even-odd), so the avatar shows through the middle
  const ring = `M32 ${32 - R}a${R} ${R} 0 1 0 0 ${2 * R}a${R} ${R} 0 1 0 0-${2 * R}ZM32 ${32 - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0-${2 * r}Z`;
  const gem = material === "crystal";
  const gemColor = lighten(color, 0.15);
  return (
    `<svg viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${safe(name)}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>${body(id, material, color)}${shadow(id)}` +
    `<radialGradient id="${id}a" cx="0.5" cy="0.35" r="0.8"><stop offset="0" stop-color="#6d5aa8"/><stop offset="1" stop-color="#241440"/></radialGradient>` +
    `<clipPath id="${id}c"><circle cx="32" cy="32" r="${r}"/></clipPath>` +
    `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `</defs>` +
    `<g filter="url(#${id}d)">` +
    // the avatar: a round picture of a person, in the dark colours of the site
    `<circle cx="32" cy="32" r="${r + 1}" fill="url(#${id}a)"/>` +
    `<g clip-path="url(#${id}c)"><circle cx="32" cy="27" r="6.6" fill="#c9bde8" opacity="0.9"/><path d="M16 52c1-10 7-14 16-14s15 4 16 14z" fill="#c9bde8" opacity="0.85"/></g>` +
    `<circle cx="32" cy="32" r="${r + 0.6}" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="2"/>` +
    // the ring itself: dark edge, body, light bevel, and a gloss along the top left
    `<path d="${ring}" fill-rule="evenodd" fill="${darken(color, 0.45)}"/>` +
    `<path d="${ring}" fill-rule="evenodd" fill="url(#${id}b)" transform="translate(32 32) scale(0.975) translate(-32 -32)"/>` +
    `<circle cx="32" cy="32" r="${R - 0.6}" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="1"/>` +
    `<circle cx="32" cy="32" r="${r + 1.2}" fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="0.9"/>` +
    `<path d="M11.5 38A23.4 23.4 0 0 1 24 11.4" fill="none" stroke="url(#${id}s)" stroke-width="4.2" stroke-linecap="round" opacity="0.85"/>` +
    `<path d="M52.6 28A23.4 23.4 0 0 1 49 46" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.3"/>` +
    (material === "metal" ? `<circle cx="32" cy="32" r="23.3" fill="none" stroke="#fff" stroke-width="0.6" stroke-dasharray="0.8 1.6" opacity="0.35"/>` : "") +
    (gem
      ? `<g><polygon points="32,1.2 38.4,6.2 32,12.2 25.6,6.2" fill="${gemColor}" stroke="${darken(color, 0.5)}" stroke-width="0.7" stroke-linejoin="round"/><polygon points="32,1.2 38.4,6.2 32,6.2" fill="#fff" opacity="0.55"/><polygon points="32,6.2 38.4,6.2 32,12.2" fill="#000" opacity="0.22"/><polygon points="25.6,6.2 32,6.2 32,12.2" fill="#000" opacity="0.1"/></g>`
      : "") +
    (material === "holo" ? sparkle(48, 14, 4.5) + sparkle(16, 50, 3.4, 0.85) : sparkle(20.5, 15.5, 3.2, 0.9)) +
    `</g></svg>`
  );
}

/** A prestige star: a five-point faceted star with a rounded edge, a gloss and a halo behind it. */
export function starSvg(name: string, value: string, size = 46): string {
  const color = rewardColor(name, value);
  const material = materialOf(name);
  const id = `st${++counter}`;
  const cx = 32;
  const cy = 34;
  const outer = 27;
  const inner = 12.2;
  const tip = (i: number, radius: number) => {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as const;
  };
  const points = Array.from({ length: 10 }, (_, i) => tip(i, i % 2 === 0 ? outer : inner));
  const polygon = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const middle = `${cx},${cy}`;
  // ten facets from the middle: those on the lit side (upper left) are light, the others dark
  const facets = points
    .map(([x, y], i) => {
      const [x2, y2] = points[(i + 1) % 10];
      const lit = i % 2 === 0 ? x <= cx + 1 : x < cx - 1;
      return `<polygon points="${middle} ${x.toFixed(2)},${y.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}" fill="${lit ? "#fff" : "#000"}" opacity="${lit ? 0.26 : i % 2 === 0 ? 0.2 : 0.3}"/>`;
    })
    .join("");
  return (
    `<svg viewBox="0 0 64 66" width="${size}" height="${Math.round((size * 66) / 64)}" role="img" aria-label="${safe(name)}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>${body(id, material, color)}${shadow(id)}` +
    `<radialGradient id="${id}h" cx="0.5" cy="0.5" r="0.5"><stop offset="0.3" stop-color="${color}" stop-opacity="0.5"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="${id}k"><polygon points="${polygon}"/></clipPath>` +
    `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `</defs>` +
    `<circle cx="${cx}" cy="${cy}" r="31" fill="url(#${id}h)"/>` +
    `<g filter="url(#${id}d)">` +
    `<polygon points="${polygon}" fill="${darken(color, 0.42)}" stroke="${darken(color, 0.42)}" stroke-width="5" stroke-linejoin="round"/>` +
    `<polygon points="${polygon}" fill="url(#${id}b)" stroke="url(#${id}b)" stroke-width="3" stroke-linejoin="round"/>` +
    `<g clip-path="url(#${id}k)">${facets}` +
    `<ellipse cx="25" cy="22" rx="14" ry="7" fill="url(#${id}s)" opacity="0.65" transform="rotate(-28 25 22)"/></g>` +
    `<polygon points="${polygon}" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="0.9" stroke-linejoin="round"/>` +
    `</g>` +
    sparkle(cx - 9, cy - 9, 3.4) +
    (material === "holo" ? sparkle(48, 14, 4.2) + sparkle(14, 46, 3) : sparkle(50, 18, 2.4, 0.8)) +
    `</svg>`
  );
}

/** The artwork for a reward of a kind, or "" for a kind that has none (a perk). A ring named "… pick" is a guitar pick. */
export function rewardSvg(kind: string, name: string, value: string, size: number): string {
  if (kind === "ring") return isPick(name) ? pickSvg(name, rewardColor(name, value), size) : ringSvg(name, value, size);
  if (kind === "star") return starSvg(name, value, size);
  return "";
}
