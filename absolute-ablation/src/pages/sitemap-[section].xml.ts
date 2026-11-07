// One sitemap file for each part of the site: /sitemap-pages.xml, /sitemap-guitar.xml and so on (the list is in lib/sitemap.ts).
import type { APIRoute, GetStaticPaths } from "astro";
import { SECTIONS, sitemapFile, type Section } from "../lib/sitemap";

export const getStaticPaths = (() => SECTIONS.map((section) => ({ params: { section } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) =>
  new Response(sitemapFile(params.section as Section), { headers: { "Content-Type": "application/xml; charset=utf-8" } });
