// Bing News RSS Discovery.
// Vorteil ggu. Google News: liefert direkte Publisher-URLs, kein Redirect-Resolver noetig.
//
// Erweiterungen:
//  - maxAgeMonths: Kandidaten aelter als N Monate werden verworfen (Default 12).
//  - sites: optional site:x.de-Restriktion fuer Fachmedien.

import { XMLParser } from "fast-xml-parser";

const FOCUSED_TERMS_DE = [
  "CEO",
  "CFO",
  "COO",
  "Vorstand",
  "Geschaeftsfuehrer",
  "Aufsichtsrat",
  "Nachfolger",
  "Nachfolge",
  "Ruecktritt",
  "Uebernahme",
  "Investor",
  "Private Equity",
  "Restrukturierung",
  "Sanierung",
  "Stellenabbau",
  "Insolvenz",
];

// Kuratierte deutsche Wirtschafts- und Fachmedien (Konzept Kap. 1).
export const TRADE_SITES_DE = [
  "handelsblatt.com",
  "faz.net",
  "sueddeutsche.de",
  "manager-magazin.de",
  "wiwo.de",
  "capital.de",
  "boersen-zeitung.de",
  "markt-und-mittelstand.de",
  "mm.de",
  "finance-magazin.de",
  "der-treasurer.de",
  "personalwirtschaft.de",
  "haufe.de",
  "personalmagazin.de",
  "lebensmittelzeitung.net",
  "textilwirtschaft.de",
  "absatzwirtschaft.de",
  "horizont.net",
  "produktion.de",
  "vdi-nachrichten.com",
  "automobil-produktion.de",
  "automobilwoche.de",
  "logistik-heute.de",
  "dvz.de",
  "chemietechnik.de",
  "process.vogel.de",
  "aerzteblatt.de",
  "pharmazeutische-zeitung.de",
  "baublatt.de",
  "immobilien-zeitung.de",
  "sr.de",
  "saarbruecker-zeitung.de",
  "volksfreund.de",
  "swr.de",
  "sr-mediathek.de",
  "presseportal.de",
];

/**
 * @param {string} companyHint
 * @param {object} [opts]
 * @param {"focused"|"broad"} [opts.mode]
 * @param {number} [opts.limit]
 * @param {string} [opts.lang]
 * @param {number} [opts.maxAgeMonths] Default 12. Kandidaten aelter werden verworfen.
 * @param {string[]} [opts.sites] site:x-Filter fuer Fachmedien.
 */
export async function discoverBingNews(companyHint, opts = {}) {
  const mode = opts.mode === "broad" ? "broad" : "focused";
  const limit = Number.isFinite(opts.limit) ? Number(opts.limit) : 30;
  const lang = opts.lang ?? "de";
  const maxAgeMonths = Number.isFinite(opts.maxAgeMonths) ? Number(opts.maxAgeMonths) : 12;
  const sites = Array.isArray(opts.sites) ? opts.sites : null;

  const query = buildQuery(companyHint, mode, sites);
  const feedUrl = buildFeedUrl(query, lang);

  const res = await fetch(feedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; b+p-mandate-radar/0.2; +prototype)",
      Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
      "Accept-Language": `${lang};q=1.0,en;q=0.8`,
    },
  });
  if (!res.ok) {
    throw new Error(`Bing News Feed ${res.status} fuer Query: ${query}`);
  }
  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const parsed = parser.parse(xml);
  const rawItems = parsed?.rss?.channel?.item ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  const candidates = items
    .slice(0, limit)
    .map((item) => {
      const rawLink = typeof item.link === "string" ? item.link : item.link?.["#text"] ?? null;
      const publisherUrl = extractPublisherUrl(rawLink);
      const title = typeof item.title === "string" ? item.title : item.title?.["#text"] ?? null;
      // Publisher aus URL-Domain ableiten (fallback: null).
      let publisher = null;
      if (publisherUrl) {
        try { publisher = new URL(publisherUrl).host.replace(/^www\./, ""); } catch {}
      }
      return {
        url: publisherUrl ?? rawLink,
        title: title,
        source: publisher,
        published_at: item.pubDate ?? null,
        guid: typeof item.guid === "string" ? item.guid : item.guid?.["#text"] ?? null,
      };
    })
    .filter((c) => c.url && /^https?:\/\//i.test(c.url));

  // Recency-Filter (STRIKT): Kandidaten ohne Datum oder aelter als maxAgeMonths werden verworfen.
  const cutoff = Date.now() - maxAgeMonths * 30 * 24 * 60 * 60 * 1000;
  const fresh = candidates.filter((c) => {
    if (!c.published_at) return false;
    const t = new Date(c.published_at).getTime();
    if (!Number.isFinite(t)) return false;
    return t >= cutoff;
  });

  return {
    query,
    feed_url: feedUrl,
    fetched_at: new Date().toISOString(),
    total: fresh.length,
    total_before_recency: candidates.length,
    max_age_months: maxAgeMonths,
    candidates: fresh,
  };
}

function extractPublisherUrl(rawUrl) {
  if (!rawUrl) return null;
  if (!/^https?:\/\/(www\.)?bing\.com\/news\/apiclick\.aspx/i.test(rawUrl)) {
    return rawUrl;
  }
  try {
    const u = new URL(rawUrl);
    const target = u.searchParams.get("url");
    if (target && /^https?:\/\//i.test(target)) return target;
  } catch {}
  return rawUrl;
}

function buildQuery(companyHint, mode, sites) {
  const quoted = `"${companyHint.replace(/"/g, "").trim()}"`;
  const base = mode === "broad"
    ? quoted
    : `${quoted} (${FOCUSED_TERMS_DE.join(" OR ")})`;
  if (!sites || sites.length === 0) return base;
  const siteFilter = sites.map((s) => `site:${s}`).join(" OR ");
  return `${base} (${siteFilter})`;
}

function buildFeedUrl(query, lang) {
  const url = new URL("https://www.bing.com/news/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");
  url.searchParams.set("setlang", lang);
  url.searchParams.set("cc", "de");
  return url.toString();
}
