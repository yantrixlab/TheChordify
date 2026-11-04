// The sitemap search engines read to find the public pages. Pages are listed here; add new public pages to the list.
import type { APIRoute } from "astro";
import { business } from "../lib/business";
import { chartUrls } from "../lib/chordCatalog";
import { LESSONS } from "../lib/lessons";

const pages: { path: string; priority: string; changefreq: string }[] = [
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
];

export const GET: APIRoute = () => {
  const today = new Date().toISOString().slice(0, 10);
  const urls = pages
    .map(
      (p) =>
        `  <url><loc>${business.site}${p.path}</loc><lastmod>${today}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`,
    )
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
