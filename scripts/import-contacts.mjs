// Import HubSpot-Kontakte-CSV -> Neon hubspot_contacts.
//
// Idempotent: hubspot_id ist UNIQUE, doppelte Zeilen werden aktualisiert.
//
// Aufruf:
//   node --env-file=.env scripts/import-contacts.mjs "<pfad-zur-csv>"

import { readFile } from "node:fs/promises";
import pg from "pg";

function unwrap(line) {
  let out = line.replace(/\r?\n$/, "");
  if (out.endsWith(";;")) out = out.slice(0, -2);
  if (out.startsWith('"') && out.endsWith('"')) out = out.slice(1, -1);
  return out.replace(/""/g, '"');
}

function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === ",") { cells.push(cur); cur = ""; }
      else if (ch === '"') inQ = true;
      else cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function parseHubspotDate(value) {
  if (!value || typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  // HubSpot Format: "2026-09-13 22:47" oder "2026-09-13"
  const d = new Date(s.replace(" ", "T"));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) throw new Error("CSV-Pfad fehlt.");
  const raw = await readFile(csvPath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean).map(unwrap);
  const header = parseCsvLine(lines[0]);
  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());

  const idx = {
    id: col("Datensatz-ID"),
    firstName: col("Vorname"),
    lastName: col("Nachname"),
    email: col("E-Mail"),
    phone: col("Telefonnummer"),
    owner: col("Für Kontakt zuständiger Mitarbeiter") >= 0
      ? col("Für Kontakt zuständiger Mitarbeiter")
      : col("Für Kontakt zuständiger Mitarbeiter "),
    lastActivity: col("Datum der letzten Aktivität"),
    leadStatus: col("Leadstatus"),
    marketingStatus: col("Marketingkontaktstatus"),
    createdAt: col("Erstellungsdatum"),
    company: col("Associated Company"),
  };

  const missing = Object.entries(idx).filter(([, v]) => v < 0);
  if (missing.length) {
    console.error("Fehlende Spalten:", missing.map(([k]) => k));
    console.error("Vorhandener Header:", header);
    throw new Error("Header passt nicht.");
  }

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL fehlt.");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

  // Batch-Insert: alle Zeilen in einen Multi-Row-INSERT packen (Chunks von 500).
  const client = await pool.connect();
  let inserted = 0;
  const BATCH_SIZE = 500;
  try {
    await client.query("BEGIN");
    const buffer = [];
    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      const get = (k) => (row[idx[k]] ?? "").trim();
      const hubspotId = get("id");
      if (!hubspotId) continue;
      buffer.push([
        hubspotId,
        get("firstName") || null,
        get("lastName") || null,
        get("email") || null,
        get("phone") || null,
        get("company") || null,
        get("owner") || null,
        get("leadStatus") || null,
        get("marketingStatus") || null,
        parseHubspotDate(get("lastActivity")),
        parseHubspotDate(get("createdAt")),
      ]);
      if (buffer.length >= BATCH_SIZE) {
        await flushBatch(client, buffer);
        inserted += buffer.length;
        buffer.length = 0;
        process.stderr.write(`... ${inserted} Kontakte...\n`);
      }
    }
    if (buffer.length > 0) {
      await flushBatch(client, buffer);
      inserted += buffer.length;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const res = await pool.query(
    `SELECT COUNT(*)::int AS n, COUNT(DISTINCT company_name)::int AS distinct_companies
     FROM hubspot_contacts`,
  );
  console.log("Import fertig:", { inserted, ...res.rows[0] });
  await pool.end();
}

async function flushBatch(client, rows) {
  const cols = 11;
  const values = [];
  const params = [];
  rows.forEach((r, idx) => {
    const base = idx * cols;
    values.push(`(${Array.from({length: cols}, (_, k) => `$${base + k + 1}`).join(",")})`);
    params.push(...r);
  });
  await client.query(
    `INSERT INTO hubspot_contacts (
       hubspot_id, first_name, last_name, email, phone,
       company_name, owner, lead_status, marketing_status,
       last_activity, created_at
     ) VALUES ${values.join(",")}
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
    params,
  );
}

main().catch((err) => {
  console.error("FEHLER:", err.message);
  process.exit(1);
});
