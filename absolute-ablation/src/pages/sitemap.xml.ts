// The list of sitemap files search engines read to find the public pages. The pages themselves are listed in lib/sitemap.ts.
import type { APIRoute } from "astro";
import { sitemapIndex } from "../lib/sitemap";

export const GET: APIRoute = () => new Response(sitemapIndex(), { headers: { "Content-Type": "application/xml; charset=utf-8" } });
