// HubSpot -> Neon Sync, in-process (ohne Child-Prozess).
// Importiert Firmen und Kontakte in die lokalen Tabellen hs_companies und hubspot_contacts.
// Danach wird target_companies.contact_count neu abgeleitet.

import { getPool } from "./db";
import { hsFetch } from "./hubspot";

const COMPANY_PROPS = [
  "name", "domain", "type", "industry", "city", "country",
  "numberofemployees", "annualrevenue", "lifecyclestage",
  "hs_object_id", "hubspot_owner_id",
  "createdate", "hs_lastmodifieddate",
];

const CONTACT_PROPS = [
  "firstname", "lastname", "email", "phone", "company",
  "hs_lead_status", "hs_marketable_status",
  "hubspot_owner_id", "lastmodifieddate", "createdate",
  "notes_last_activity_date",
];

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toIso(v: unknown): string | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

type HsRecord = { id: string; properties: Record<string, string | null | undefined> };
type HsPage = { results?: HsRecord[]; paging?: { next?: { after?: string } } };

async function* hsPaginate(path: string, query: Record<string, string> = {}, limit = 100): AsyncGenerator<HsRecord> {
  let after: string | undefined = undefined;
  for (;;) {
    const params = new URLSearchParams({ ...query, limit: String(limit) });
    if (after) params.set("after", after);
    const data = await hsFetch<HsPage>(`${path}?${params.toString()}`);
    const results = Array.isArray(data.results) ? data.results : [];
    for (const r of results) yield r;
    after = data?.paging?.next?.after;
    if (!after) break;
  }
}

async function* searchCompaniesByType(acceptedTypes: string[], properties: string[]): AsyncGenerator<HsRecord> {
  let after: string | undefined = undefined;
  const limit = 100;
  for (;;) {
    const payload: Record<string, unknown> = {
      filterGroups: [{ filters: [{ propertyName: "type", operator: "IN", values: acceptedTypes }] }],
      properties,
      limit,
    };
    if (after) payload.after = after;
    const page = await hsFetch<HsPage>("/crm/v3/objects/companies/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const results = Array.isArray(page.results) ? page.results : [];
    for (const r of results) yield r;
    after = page?.paging?.next?.after;
    if (!after) break;
  }
}

export type SyncProgress = { inserted: number; skipped: number };

export async function syncCompanies(opts: {
  acceptedTypes?: string[] | null;
  onProgress?: (p: SyncProgress) => void;
} = {}): Promise<{ inserted: number; skipped: number }> {
  const pool = getPool();
  const acceptedTypes = opts.acceptedTypes && opts.acceptedTypes.length > 0 ? opts.acceptedTypes : null;
  let inserted = 0;
  let skipped = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const iter = acceptedTypes
      ? searchCompaniesByType(acceptedTypes, COMPANY_PROPS)
      : hsPaginate("/crm/v3/objects/companies", { properties: COMPANY_PROPS.join(",") });
    for await (const c of iter) {
      const p = c.properties ?? {};
      const typ = p.type ?? null;
      if (acceptedTypes && !acceptedTypes.includes(typ ?? "")) {
        skipped += 1;
        continue;
      }
      await client.query(
        `INSERT INTO hs_companies (
           hubspot_id, name, domain, typ, industry, city, country,
           employees, annual_revenue, lifecycle_stage, owner_id,
           created_at, updated_at, raw
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (hubspot_id) DO UPDATE SET
           name = EXCLUDED.name, domain = EXCLUDED.domain, typ = EXCLUDED.typ,
           industry = EXCLUDED.industry, city = EXCLUDED.city, country = EXCLUDED.country,
           employees = EXCLUDED.employees, annual_revenue = EXCLUDED.annual_revenue,
           lifecycle_stage = EXCLUDED.lifecycle_stage, owner_id = EXCLUDED.owner_id,
           updated_at = EXCLUDED.updated_at, raw = EXCLUDED.raw, imported_at = now()`,
        [
          c.id, p.name ?? null, p.domain ?? null, typ, p.industry ?? null,
          p.city ?? null, p.country ?? null,
          toNumber(p.numberofemployees), toNumber(p.annualrevenue),
          p.lifecyclestage ?? null, p.hubspot_owner_id ?? null,
          toIso(p.createdate), toIso(p.hs_lastmodifieddate),
          JSON.stringify(p),
        ],
      );
      inserted += 1;
      if (opts.onProgress && (inserted + skipped) % 25 === 0) {
        opts.onProgress({ inserted, skipped });
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
  opts.onProgress?.({ inserted, skipped });
  return { inserted, skipped };
}

export async function syncContacts(opts: {
  onProgress?: (p: { inserted: number }) => void;
} = {}): Promise<{ inserted: number; refreshed_targets: number }> {
  const pool = getPool();
  let inserted = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for await (const c of hsPaginate("/crm/v3/objects/contacts", { properties: CONTACT_PROPS.join(",") })) {
      const p = c.properties ?? {};
      await client.query(
        `INSERT INTO hubspot_contacts (
           hubspot_id, first_name, last_name, email, phone,
           company_name, owner, lead_status, marketing_status,
           last_activity, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (hubspot_id) DO UPDATE SET
           first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
           email = EXCLUDED.email, phone = EXCLUDED.phone,
           company_name = EXCLUDED.company_name, owner = EXCLUDED.owner,
           lead_status = EXCLUDED.lead_status, marketing_status = EXCLUDED.marketing_status,
           last_activity = EXCLUDED.last_activity,
           created_at = COALESCE(EXCLUDED.created_at, hubspot_contacts.created_at),
           imported_at = now()`,
        [
          c.id, p.firstname ?? null, p.lastname ?? null, p.email ?? null, p.phone ?? null,
          p.company ?? null, p.hubspot_owner_id ?? null,
          p.hs_lead_status ?? null, p.hs_marketable_status ?? null,
          toIso(p.notes_last_activity_date) ?? toIso(p.lastmodifieddate),
          toIso(p.createdate),
        ],
      );
      inserted += 1;
      if (opts.onProgress && inserted % 50 === 0) {
        opts.onProgress({ inserted });
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }

  opts.onProgress?.({ inserted });

  const refresh = await pool.query(
    `UPDATE target_companies tc
       SET contact_count = sub.n
      FROM (
        SELECT lower(trim(company_name)) AS key, COUNT(*)::int AS n
        FROM hubspot_contacts
        WHERE company_name IS NOT NULL AND trim(company_name) <> ''
        GROUP BY lower(trim(company_name))
      ) sub
      WHERE lower(tc.name) = sub.key
        AND tc.contact_count IS DISTINCT FROM sub.n`,
  );
  return { inserted, refreshed_targets: refresh.rowCount ?? 0 };
}
