// Duenner HTTP-Wrapper um HubSpot v3 CRM API und ausgewaehlte Marketing-Endpoints.
// Auth: Private App Token in HUBSPOT_TOKEN (Bearer).
// Rate-Limits: HubSpot Standard Tier = 100 req/10s. Wir throttlen konservativ auf 5/s.

const BASE = "https://api.hubapi.com";
const MIN_INTERVAL_MS = 220; // ca. 4.5 req/sec

let lastCall = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL_MS - (now - lastCall));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

function requireToken() {
  const t = process.env.HUBSPOT_TOKEN;
  if (!t) throw new Error("HUBSPOT_TOKEN nicht gesetzt (siehe .env).");
  return t;
}

/**
 * @param {string} path z.B. "/crm/v3/objects/companies"
 * @param {object} [opts]
 */
export async function hsFetch(path, opts = {}) {
  await throttle();
  const token = requireToken();
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 429) {
    // Backoff und einmal retry
    await new Promise((r) => setTimeout(r, 5000));
    return hsFetch(path, opts);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Blaettert durch alle Seiten eines Listen-Endpoints und liefert alle Ergebnisse.
 * @param {string} path
 * @param {object} query zusaetzliche Query-Parameter
 * @param {number} [limit] pro Seite (max 100 bei HubSpot)
 */
export async function* hsPaginate(path, query = {}, limit = 100) {
  let after = undefined;
  for (;;) {
    const params = new URLSearchParams({ ...query, limit: String(limit) });
    if (after) params.set("after", after);
    const data = await hsFetch(`${path}?${params.toString()}`);
    const results = Array.isArray(data.results) ? data.results : [];
    for (const r of results) yield r;
    after = data?.paging?.next?.after;
    if (!after) break;
  }
}

/**
 * Sanity: prueft ob der Token gueltig ist und liefert das eigene Portal.
 */
export async function hsWhoami() {
  return hsFetch("/account-info/v3/details");
}
