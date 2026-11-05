// A glossy guitar pick drawn as SVG, in the colour of a reward and with the look of what the pick is made of (tortoiseshell mottling, brushed
// metal, cut crystal, woven carbon...). The material is read from the reward's name ("Jade pick", "Gold pick"); a name it does not know gets a
// plain glossy pick. Used for the rewards in the library; nothing here needs the network or an image file.

let counter = 0;

const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
/** Mixes two #rrggbb colours: 0 is all `a`, 1 is all `b`. */
export function mix(a: string, b: string, t: number): string {
  const part = (i: number) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t).toString(16).padStart(2, "0");
  return `#${part(1)}${part(3)}${part(5)}`;
}
export const lighten = (hex: string, t: number) => mix(hex, "#ffffff", t);
export const darken = (hex: string, t: number) => mix(hex, "#000000", t);

// the outline of a pick: wide shoulders, a rounded point
const OUTLINE = "M32 60.5C26 58.5 7 41 7 22.5C7 12 17 5.5 32 5.5C47 5.5 57 12 57 22.5C57 41 38 58.5 32 60.5Z";

export type Material = "tortoise" | "nylon" | "jade" | "metal" | "bone" | "abalone" | "carbon" | "crystal" | "holo" | "plain";

export const MATERIALS: [RegExp, Material][] = [
  [/tortoise/, "tortoise"],
  [/nylon/, "nylon"],
  [/jade/, "jade"],
  [/bronze|copper|brass|gold|silver|platinum/, "metal"],
  [/bone/, "bone"],
  [/abalone/, "abalone"],
  [/carbon/, "carbon"],
  [/amethyst|sapphire|ruby|diamond|emerald/, "crystal"],
  [/eternal/, "holo"],
];

/** Whether a reward is drawn as a pick: its name says so. */
export const isPick = (name: string) => /\bpick\b/i.test(name);

/** The artwork of the material, drawn over the base colour and clipped to the pick. */
function surface(material: Material, color: string, id: string): string {
  const light = lighten(color, 0.55);
  const dark = darken(color, 0.45);
  switch (material) {
    case "tortoise": {
      const amber = "#e0a040";
      const brown = "#3a1b08";
      return [
        `<g opacity="0.9">`,
        `<ellipse cx="22" cy="20" rx="9" ry="6" fill="${amber}" opacity="0.65" transform="rotate(-25 22 20)"/>`,
        `<ellipse cx="42" cy="17" rx="8" ry="5" fill="${brown}" opacity="0.6" transform="rotate(20 42 17)"/>`,
        `<ellipse cx="33" cy="31" rx="10" ry="6" fill="${brown}" opacity="0.5" transform="rotate(-10 33 31)"/>`,
        `<ellipse cx="19" cy="34" rx="6" ry="4" fill="${amber}" opacity="0.55" transform="rotate(30 19 34)"/>`,
        `<ellipse cx="45" cy="34" rx="6" ry="4.5" fill="${amber}" opacity="0.6" transform="rotate(-30 45 34)"/>`,
        `<ellipse cx="32" cy="46" rx="5" ry="3.5" fill="${brown}" opacity="0.55"/>`,
        `<circle cx="27" cy="26" r="1.4" fill="${brown}" opacity="0.6"/><circle cx="38" cy="24" r="1.1" fill="${amber}" opacity="0.7"/><circle cx="30" cy="40" r="1.2" fill="${amber}" opacity="0.6"/><circle cx="14" cy="25" r="1" fill="${brown}" opacity="0.5"/>`,
        `</g>`,
      ].join("");
    }
    case "nylon":
      return [
        `<pattern id="${id}n" width="3.2" height="3.2" patternUnits="userSpaceOnUse"><circle cx="1.6" cy="1.6" r="0.7" fill="#fff" opacity="0.28"/><circle cx="0" cy="0" r="0.5" fill="#000" opacity="0.12"/></pattern>`,
        `<rect width="64" height="64" fill="url(#${id}n)"/>`,
      ].join("");
    case "jade":
      return [
        `<path d="M6 24C18 14 26 30 36 22S52 14 60 24" fill="none" stroke="${light}" stroke-width="4" opacity="0.28" stroke-linecap="round"/>`,
        `<path d="M4 36C16 28 28 44 40 34S54 30 62 38" fill="none" stroke="${light}" stroke-width="3.5" opacity="0.22" stroke-linecap="round"/>`,
        `<path d="M14 52C24 42 34 56 44 46" fill="none" stroke="${dark}" stroke-width="3" opacity="0.25" stroke-linecap="round"/>`,
        `<ellipse cx="40" cy="14" rx="9" ry="4" fill="#fff" opacity="0.14"/>`,
      ].join("");
    case "metal":
      return [
        `<linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lighten(color, 0.7)}"/><stop offset="0.28" stop-color="${color}"/><stop offset="0.52" stop-color="${darken(color, 0.38)}"/><stop offset="0.74" stop-color="${lighten(color, 0.45)}"/><stop offset="1" stop-color="${darken(color, 0.3)}"/></linearGradient>`,
        `<rect width="64" height="64" fill="url(#${id}m)"/>`,
        `<pattern id="${id}b" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(32)"><rect width="2" height="0.7" fill="#fff" opacity="0.16"/></pattern>`,
        `<rect width="64" height="64" fill="url(#${id}b)"/>`,
      ].join("");
    case "bone": {
      const vein = mix(color, "#6b5a3a", 0.6);
      return [
        `<path d="M14 18C22 24 20 34 28 38S34 50 30 56" fill="none" stroke="${vein}" stroke-width="0.9" opacity="0.4"/>`,
        `<path d="M42 12C38 22 46 28 42 38S48 48 44 54" fill="none" stroke="${vein}" stroke-width="0.8" opacity="0.35"/>`,
        `<path d="M24 14C28 20 24 26 30 30" fill="none" stroke="${vein}" stroke-width="0.7" opacity="0.3"/>`,
        `<circle cx="20" cy="40" r="0.9" fill="${vein}" opacity="0.4"/><circle cx="46" cy="26" r="0.8" fill="${vein}" opacity="0.4"/><circle cx="33" cy="22" r="0.7" fill="${vein}" opacity="0.35"/>`,
      ].join("");
    }
    case "abalone":
      return [
        `<linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="0.3" stop-color="#60a5fa"/><stop offset="0.55" stop-color="#c084fc"/><stop offset="0.8" stop-color="#f472b6"/><stop offset="1" stop-color="#2dd4bf"/></linearGradient>`,
        `<rect width="64" height="64" fill="url(#${id}a)" opacity="0.7"/>`,
        `<path d="M6 26C18 14 28 34 40 24S54 20 62 28" fill="none" stroke="#fff" stroke-width="3" opacity="0.22" stroke-linecap="round"/>`,
        `<path d="M4 42C16 32 30 50 42 40S56 36 62 44" fill="none" stroke="#fff" stroke-width="2.5" opacity="0.18" stroke-linecap="round"/>`,
      ].join("");
    case "carbon":
      return [
        `<pattern id="${id}c" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#0a0f1a"/><rect width="3" height="3" fill="#2b3647"/><rect x="3" y="3" width="3" height="3" fill="#2b3647"/><rect width="3" height="3" fill="#fff" opacity="0.05"/></pattern>`,
        `<rect width="64" height="64" fill="url(#${id}c)"/>`,
      ].join("");
    case "crystal": {
      // facets fanned out from the middle: some catch the light, some are in shadow
      const c = [32, 30];
      const edge = [[8, 22], [14, 10], [32, 5], [50, 10], [56, 22], [50, 40], [32, 61], [14, 40]];
      const tones = [0.34, 0, 0.5, 0.12, 0.42, 0.04, 0.3, 0.1];
      const facets = edge.map((p, i) => {
        const q = edge[(i + 1) % edge.length];
        const fill = tones[i] > 0.2 ? "#fff" : "#000";
        const opacity = tones[i] > 0.2 ? tones[i] : 0.22 + tones[i];
        return `<polygon points="${c[0]},${c[1]} ${p[0]},${p[1]} ${q[0]},${q[1]}" fill="${fill}" opacity="${opacity}"/>`;
      });
      const glint = `<path d="M46 13l1.7 4.3 4.3 1.7-4.3 1.7-1.7 4.3-1.7-4.3-4.3-1.7 4.3-1.7z" fill="#fff" opacity="0.95"/>`;
      return `<g>${facets.join("")}</g><polygon points="32,30 22,16 42,16" fill="#fff" opacity="0.18"/><g stroke="#fff" stroke-width="0.6" opacity="0.4" fill="none"><path d="M32 30L8 22M32 30L32 5M32 30L56 22M32 30L50 40M32 30L14 40"/></g>${glint}`;
    }
    case "holo":
      return [
        `<linearGradient id="${id}h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3fa4"/><stop offset="0.25" stop-color="#ffb347"/><stop offset="0.5" stop-color="#5eead4"/><stop offset="0.75" stop-color="#a78bfa"/><stop offset="1" stop-color="#ff3fa4"/></linearGradient>`,
        `<rect width="64" height="64" fill="url(#${id}h)" opacity="0.75"/>`,
        `<path d="M6 30C18 18 30 40 42 28S54 24 62 32" fill="none" stroke="#fff" stroke-width="3" opacity="0.25" stroke-linecap="round"/>`,
        `<path d="M44 12l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="#fff" opacity="0.9"/>`,
        `<path d="M20 36l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z" fill="#fff" opacity="0.85"/>`,
        `<path d="M38 46l0.8 2 2 0.8-2 0.8-0.8 2-0.8-2-2-0.8 2-0.8z" fill="#fff" opacity="0.8"/>`,
      ].join("");
    default:
      return `<path d="M10 28C22 20 34 34 46 26" fill="none" stroke="${light}" stroke-width="3" opacity="0.18" stroke-linecap="round"/>`;
  }
}

/** The pick for a reward as an SVG string: `name` decides the material, `color` is the #rrggbb of the reward. */
export function pickSvg(name: string, color: string, size = 44): string {
  const base = /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#f59e0b";
  const material = MATERIALS.find(([pattern]) => pattern.test(name.toLowerCase()))?.[1] ?? "plain";
  const id = `pk${++counter}`;
  const hasOwnBase = material === "metal" || material === "carbon" || material === "abalone" || material === "holo";
  return (
    `<svg viewBox="0 0 64 66" width="${size}" height="${Math.round((size * 66) / 64)}" role="img" aria-label="${name.replace(/[<>&"]/g, "")}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>` +
    `<clipPath id="${id}k"><path d="${OUTLINE}"/></clipPath>` +
    `<linearGradient id="${id}g" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="${lighten(base, 0.38)}"/><stop offset="0.5" stop-color="${base}"/><stop offset="1" stop-color="${darken(base, 0.4)}"/></linearGradient>` +
    `<radialGradient id="${id}v" cx="0.5" cy="0.36" r="0.72"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.38"/></radialGradient>` +
    `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<filter id="${id}d" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2.2" stdDeviation="2" flood-color="#000" flood-opacity="0.45"/></filter>` +
    `</defs>` +
    `<g filter="url(#${id}d)">` +
    `<path d="${OUTLINE}" fill="${darken(base, 0.35)}"/>` +
    `<g clip-path="url(#${id}k)">` +
    (hasOwnBase ? "" : `<rect width="64" height="66" fill="url(#${id}g)"/>`) +
    surface(material, base, id) +
    `<rect width="64" height="66" fill="url(#${id}v)"/>` +
    // the gloss: a bright crescent along the top, a soft sheen across the lower half and a glint
    `<ellipse cx="27" cy="16" rx="19" ry="9.5" fill="url(#${id}s)" opacity="0.7" transform="rotate(-18 27 16)"/>` +
    `<path d="M14 50C22 44 40 44 52 34C50 44 42 54 32 60.5C26 58 18 54 14 50Z" fill="#fff" opacity="0.1"/>` +
    `<circle cx="18.5" cy="14.5" r="2.4" fill="#fff" opacity="0.95"/><circle cx="23.5" cy="11.5" r="1" fill="#fff" opacity="0.8"/>` +
    `</g>` +
    // a bevelled edge: light on the upper left, shade on the lower right
    `<path d="${OUTLINE}" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="1.1" clip-path="url(#${id}k)"/>` +
    `<path d="${OUTLINE}" fill="none" stroke="${darken(base, 0.55)}" stroke-opacity="0.7" stroke-width="0.8"/>` +
    `</g></svg>`
  );
}
