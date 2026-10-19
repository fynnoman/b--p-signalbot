// HubSpot -> Neon Sync-Layer.
// Zieht Companies, Contacts, Lists und Deals in die hs_*-Tabellen bzw. hubspot_contacts.

import { hsPaginate, hsFetch, hsWhoami } from "./client.js";
import { getPool } from "../db.js";

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

const DEAL_PROPS = [
  "dealname", "pipeline", "dealstage", "amount", "closedate",
  "hubspot_owner_id", "createdate", "hs_lastmodifieddate",
];

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toIso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * Server-side Filter via /crm/v3/objects/companies/search - viel schneller als
 * alle Firmen zu ziehen und lokal zu filtern.
 */
async function* searchCompaniesByType(acceptedTypes, properties) {
  let after = undefined;
  const limit = 100;
  for (;;) {
    const body = {
      filterGroups: [
        {
          filters: [
            { propertyName: "type", operator: "IN", values: acceptedTypes },
          ],
        },
      ],
      properties,
      limit,
      ...(after ? { after } : {}),
    };
    const data = await hsFetch("/crm/v3/objects/companies/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const results = Array.isArray(data.results) ? data.results : [];
    for (const r of results) yield r;
    after = data?.paging?.next?.after;
    if (!after) break;
  }
}

/**
 * Pullt alle Companies. Filter (optional): nur bestimmte "type"-Werte behalten.
 * @param {object} opts
 * @param {string[]} [opts.acceptedTypes] z.B. ["Kunde", "nicht aktiver Kunde"]
 */
export async function syncCompanies({ acceptedTypes = null } = {}) {
  const pool = await getPool();
  let inserted = 0;
  let skipped = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Bei acceptedTypes nutzen wir die Search-API mit Filter (viel schneller).
    const iter = acceptedTypes
      ? searchCompaniesByType(acceptedTypes, COMPANY_PROPS)
      : hsPaginate("/crm/v3/objects/companies", { properties: COMPANY_PROPS.join(",") });
    for await (const c of iter) {
      const p = c.properties ?? {};
      const typ = p.type ?? null;
      if (acceptedTypes && !acceptedTypes.includes(typ)) {
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
           name            = EXCLUDED.name,
           domain          = EXCLUDED.domain,
           typ             = EXCLUDED.typ,
           industry        = EXCLUDED.industry,
           city            = EXCLUDED.city,
           country         = EXCLUDED.country,
           employees       = EXCLUDED.employees,
           annual_revenue  = EXCLUDED.annual_revenue,
           lifecycle_stage = EXCLUDED.lifecycle_stage,
           owner_id        = EXCLUDED.owner_id,
           updated_at      = EXCLUDED.updated_at,
           raw             = EXCLUDED.raw,
           imported_at     = now()`,
        [
          c.id,
          p.name ?? null,
          p.domain ?? null,
          typ,
          p.industry ?? null,
          p.city ?? null,
          p.country ?? null,
          toNumber(p.numberofemployees),
          toNumber(p.annualrevenue),
          p.lifecyclestage ?? null,
          p.hubspot_owner_id ?? null,
          toIso(p.createdate),
          toIso(p.hs_lastmodifieddate),
          JSON.stringify(p),
        ],
      );
      inserted += 1;
      if (inserted % 100 === 0) process.stderr.write(`[hubspot] companies ... ${inserted}\n`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
  return { inserted, skipped };
}

/**
 * Pullt alle Contacts und aktualisiert die vorhandene hubspot_contacts-Tabelle.
 */
export async function syncContacts() {
  const pool = await getPool();
  let inserted = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for await (const c of hsPaginate(
      "/crm/v3/objects/contacts",
      { properties: CONTACT_PROPS.join(",") },
    )) {
      const p = c.properties ?? {};
      await client.query(
        `INSERT INTO hubspot_contacts (
           hubspot_id, first_name, last_name, email, phone,
           company_name, owner, lead_status, marketing_status,
           last_activity, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (hubspot_id) DO UPDATE SET
           first_name       = EXCLUDED.first_name,
           last_name        = EXCLUDED.last_name,
           email            = EXCLUDED.email,
           phone            = EXCLUDED.phone,
           company_name     = EXCLUDED.company_name,
           owner            = EXCLUDED.owner,
           lead_status      = EXCLUDED.lead_status,
           marketing_status = EXCLUDED.marketing_status,
           last_activity    = EXCLUDED.last_activity,
           created_at       = COALESCE(EXCLUDED.created_at, hubspot_contacts.created_at),
           imported_at      = now()`,
        [
          c.id,
          p.firstname ?? null,
          p.lastname ?? null,
          p.email ?? null,
          p.phone ?? null,
          p.company ?? null,
          p.hubspot_owner_id ?? null,
          p.hs_lead_status ?? null,
          p.hs_marketable_status ?? null,
          toIso(p.notes_last_activity_date) ?? toIso(p.lastmodifieddate),
          toIso(p.createdate),
        ],
      );
      inserted += 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
  return { inserted };
}

export async function syncDeals() {
  const pool = await getPool();
  let inserted = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for await (const d of hsPaginate(
      "/crm/v3/objects/deals",
      { properties: DEAL_PROPS.join(","), associations: "companies" },
    )) {
      const p = d.properties ?? {};
      const primaryCompanyId = d.associations?.companies?.results?.[0]?.id ?? null;
      await client.query(
        `INSERT INTO hs_deals (
           hubspot_id, name, pipeline, stage, amount, close_date,
           owner_id, primary_company_id, created_at, updated_at, raw
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (hubspot_id) DO UPDATE SET
           name              = EXCLUDED.name,
           pipeline          = EXCLUDED.pipeline,
           stage             = EXCLUDED.stage,
           amount            = EXCLUDED.amount,
           close_date        = EXCLUDED.close_date,
           owner_id          = EXCLUDED.owner_id,
           primary_company_id = EXCLUDED.primary_company_id,
           updated_at        = EXCLUDED.updated_at,
           raw               = EXCLUDED.raw,
           imported_at       = now()`,
        [
          d.id,
          p.dealname ?? null,
          p.pipeline ?? null,
          p.dealstage ?? null,
          toNumber(p.amount),
          toIso(p.closedate),
          p.hubspot_owner_id ?? null,
          primaryCompanyId,
          toIso(p.createdate),
          toIso(p.hs_lastmodifieddate),
          JSON.stringify(p),
        ],
      );
      inserted += 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
  return { inserted };
}

/**
 * Pullt alle Listen (Segmente). Nutzt /crm/v3/lists/search POST.
 */
export async function syncLists() {
  const pool = await getPool();
  let inserted = 0;
  let offset = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (;;) {
      const data = await hsFetch("/crm/v3/lists/search", {
        method: "POST",
        body: JSON.stringify({ count: 100, offset }),
      });
      const results = Array.isArray(data.lists) ? data.lists : [];
      if (results.length === 0) break;
      for (const l of results) {
        await client.query(
          `INSERT INTO hs_lists (
             hubspot_id, name, processing_type, object_type, size,
             created_at, updated_at, raw
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (hubspot_id) DO UPDATE SET
             name            = EXCLUDED.name,
             processing_type = EXCLUDED.processing_type,
             object_type     = EXCLUDED.object_type,
             size            = EXCLUDED.size,
             updated_at      = EXCLUDED.updated_at,
             raw             = EXCLUDED.raw,
             imported_at     = now()`,
          [
            String(l.listId ?? l.id),
            l.name ?? null,
            l.processingType ?? null,
            l.objectTypeId ?? l.objectType ?? null,
            toNumber(l.additionalProperties?.hs_list_size ?? l.size),
            toIso(l.createdAt),
            toIso(l.updatedAt),
            JSON.stringify(l),
          ],
        );
        inserted += 1;
      }
      offset += results.length;
      if (!data.hasMore) break;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
  return { inserted };
}

/**
 * Full-Sync mit optionalem Firmen-Typ-Filter.
 */
export async function syncAll({ acceptedTypes = null } = {}) {
  const companies = await syncCompanies({ acceptedTypes });
  const contacts  = await syncContacts();
  const lists     = await syncLists();
  const deals     = await syncDeals();
  return { companies, contacts, lists, deals };
}
