// The public pages, split into sitemap files (one for each part of the site, so Search Console shows how many pages of each part
// are indexed). Pages are listed here; add new public pages to the list. The sitemap of song pages is made by the server.
import { business } from "./business";
import { ROOTS, chartUrls } from "./chordCatalog";
import { LESSONS } from "./lessons";
import { MODES } from "./modes";
import { chordPageUrls } from "./chordPages";

type Page = { path: string; priority: string; changefreq: string };

const pages: Page[] = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/youtube-to-chords/", priority: "0.9", changefreq: "monthly" },
  { path: "/guitar-chord-finder/", priority: "0.9", changefreq: "monthly" },
  { path: "/chord-detector/", priority: "0.8", changefreq: "monthly" },
  { path: "/ukulele-chords/", priority: "0.8", changefreq: "monthly" },
  { path: "/piano-chords/", priority: "0.8", changefreq: "monthly" },
  { path: "/mandolin-chords/", priority: "0.8", changefreq: "monthly" },
  { path: "/chords/", priority: "0.9", changefreq: "monthly" },
  { path: "/guitar-chords/", priority: "0.8", changefreq: "monthly" },
  { path: "/learn/", priority: "0.8", changefreq: "monthly" },
  { path: "/modes/", priority: "0.9", changefreq: "monthly" },
  { path: "/toolkit/", priority: "0.9", changefreq: "monthly" },
  { path: "/toolkit/tuner/", priority: "0.8", changefreq: "monthly" },
  { path: "/toolkit/metronome/", priority: "0.8", changefreq: "monthly" },
  { path: "/toolkit/practice/", priority: "0.8", changefreq: "monthly" },
  { path: "/toolkit/chord-detector/", priority: "0.8", changefreq: "monthly" },
  { path: "/pricing/", priority: "0.7", changefreq: "monthly" },
  { path: "/contact/", priority: "0.4", changefreq: "yearly" },
  { path: "/terms/", priority: "0.3", changefreq: "yearly" },
  { path: "/privacy/", priority: "0.3", changefreq: "yearly" },
  { path: "/refunds/", priority: "0.3", changefreq: "yearly" },
  { path: "/delete-account/", priority: "0.3", changefreq: "yearly" },
  // the four chord charts and a page for each note of each instrument, and the lessons: made from the same lists as the pages
  ...chartUrls().map((path) => ({ path, priority: path.endsWith("-chord-chart/") ? "0.8" : "0.6", changefreq: "monthly" })),
  ...LESSONS.map((l) => ({ path: `/learn/${l.slug}/`, priority: "0.7", changefreq: "monthly" })),
  // a page for each chord on each instrument (1344 of them)
  ...chordPageUrls().map((path) => ({ path, priority: "0.6", changefreq: "monthly" })),
  // the musical modes: a page for each of the seven modes and for each of the twelve keys
  ...MODES.map((m) => ({ path: `/modes/${m.id}/`, priority: "0.8", changefreq: "monthly" })),
  ...ROOTS.map((r) => ({ path: `/modes/${r.slug}/`, priority: "0.7", changefreq: "monthly" })),
];

/** The parts of the site, each with its own sitemap file: /sitemap-<name>.xml. */
export const SECTIONS = ["pages", "guides", "guitar", "piano", "ukulele", "mandolin"] as const;
export type Section = (typeof SECTIONS)[number];

const INSTRUMENT_PAGE = /^\/(guitar|piano|ukulele|mandolin)-chord(?:s|-chart)\//;

function sectionOf(path: string): Section {
  const instrument = INSTRUMENT_PAGE.exec(path);
  if (instrument) return instrument[1] as Section;
  if (path.startsWith("/learn/") || path.startsWith("/modes/")) return "guides";
  return "pages";
}

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;

// No lastmod: every page is built from the same code on every deploy, so there is no honest date for one page.
// A date that is always today teaches Google to ignore the field.
export function sitemapFile(section: Section): string {
  const urls = pages
    .filter((p) => sectionOf(p.path) === section)
    .map((p) => `  <url><loc>${business.site}${p.path}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`)
    .join("\n");
  return xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
}

/** The list of sitemap files that /sitemap.xml serves: ours, and the server's sitemap of song pages. */
export function sitemapIndex(): string {
  const files = [...SECTIONS.map((s) => `${business.site}/sitemap-${s}.xml`), `${business.site}/sitemap-songs.xml`];
  const entries = files.map((loc) => `  <sitemap><loc>${loc}</loc></sitemap>`).join("\n");
  return xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`);
}
