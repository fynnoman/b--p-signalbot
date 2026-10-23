// Duenner HubSpot-Client fuer den Next.js-Server. Kein Rate-Limiting hier,
// weil die Routen aus der UI nur punktuell aufgerufen werden
// (fuer bulk-Sync wird weiterhin src/hubspot/client.js via scripts/ genutzt).

const BASE = "https://api.hubapi.com";

export function requireToken(): string {
  const t = process.env.HUBSPOT_TOKEN;
  if (!t) throw new Error("HUBSPOT_TOKEN nicht gesetzt");
  return t;
}

export async function hsFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = requireToken();
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}
