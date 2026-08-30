import { getCollection, type CollectionEntry } from "astro:content";
import type { APIRoute } from "astro";
import { withBase } from "../lib/urls";

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const GET: APIRoute = async ({ site }) => {
  const entries = (await getCollection("writing")) as CollectionEntry<"writing">[];
  const origin = site ?? new URL("https://example.invalid");
  const items = entries
    .filter((entry) => entry.data.locale === "zh-CN" && !entry.data.draft)
    .map((entry) => {
      const link = new URL(withBase(`/writing/${entry.data.routeSlug}/`), origin).toString();
      const date =
        entry.data.publishedAt?.toUTCString() ?? new Date("2026-08-30T00:00:00Z").toUTCString();
      return `<item><title>${escapeXml(entry.data.title)}</title><description>${escapeXml(entry.data.description)}</description><link>${link}</link><guid>${link}</guid><pubDate>${date}</pubDate></item>`;
    })
    .join("");

  const feedUrl = new URL(withBase("/rss.xml"), origin).toString();
  const homeUrl = new URL(withBase("/"), origin).toString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Graphics Systems Workbench</title><description>Rendering, engine architecture, GPU compute, multimedia and neural graphics.</description><link>${homeUrl}</link><atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${feedUrl}" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
