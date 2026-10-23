// Fetch layer: URL -> Klartext via Jina Reader.

import type { FetchedPage } from "./types";

const JINA_BASE = "https://r.jina.ai/";
const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchPageText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FetchedPage> {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error(`Ungueltige URL: ${url}`);
  }

  const readerUrl = `${JINA_BASE}${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    Accept: "text/plain",
    "User-Agent": "b+p-mandate-radar/0.3 (+next-server)",
  };
  if (process.env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  }

  let response: Response;
  try {
    response = await fetch(readerUrl, { headers, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`Fetch fehlgeschlagen (${url}): ${err instanceof Error ? err.message : String(err)}`);
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
