// Fetch layer: URL -> Klartext.
// Nutzt Jina Reader (r.jina.ai/<url>), da dort bereits Reader-Mode + Anti-Bot-Handling passiert.
// Kein Key noetig; mit JINA_API_KEY hoehere Rate-Limits.

const JINA_BASE = "https://r.jina.ai/";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ url:string, text:string, fetched_at:string, char_count:number }>}
 */
export async function fetchPageText(url, opts = {}) {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error(`Ungueltige URL: ${url}`);
  }

  const readerUrl = `${JINA_BASE}${url}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    Accept: "text/plain",
    "User-Agent": "b+p-mandate-radar/0.1 (+prototype)",
  };
  if (process.env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  }

  let response;
  try {
    response = await fetch(readerUrl, { headers, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`Fetch fehlgeschlagen (${url}): ${err.message}`);
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new Error(`Reader-Antwort ${response.status} fuer ${url}`);
  }

  const text = await response.text();
  const trimmed = text.trim();
  if (trimmed.length < 50) {
    throw new Error(`Zu wenig lesbarer Inhalt (${trimmed.length} Zeichen) fuer ${url}`);
  }

  return {
    url,
    text: trimmed,
    fetched_at: new Date().toISOString(),
    char_count: trimmed.length,
  };
}
