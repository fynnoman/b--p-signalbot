// Import HubSpot-Kontakte-CSV -> Neon target_companies.
//
// Aggregiert nach der Spalte "Associated Company" und speichert distinct company + contact_count.
// Idempotent: mehrfaches Aufrufen aktualisiert nur die contact_counts.
//
// Aufruf:
//   node --env-file=.env scripts/import-targets.mjs "<pfad-zur-csv>"

import { readFile } from "node:fs/promises";
import pg from "pg";

const NOISE_NAMES = new Set([
  "-",
  "n/a",
  "na",
  "unbekannt",
  "test",
]);

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

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) throw new Error("CSV-Pfad fehlt.");
  const raw = await readFile(csvPath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean).map(unwrap);
  const header = parseCsvLine(lines[0]);
  const companyIdx = header.findIndex(
    (h) => h.trim().toLowerCase() === "associated company",
  );
  if (companyIdx < 0) throw new Error("Spalte 'Associated Company' fehlt.");

  const counts = new Map();
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    const name = (row[companyIdx] ?? "").trim();
    if (!name) continue;
    if (NOISE_NAMES.has(name.toLowerCase())) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  console.log(`CSV: ${lines.length - 1} Zeilen, ${counts.size} distinkte Firmen.`);

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL fehlt.");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const csvBase = csvPath.split("/").pop() ?? csvPath;
    for (const [name, n] of counts) {
      await client.query(
        `INSERT INTO target_companies (name, contact_count, source_csv, active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (name) DO UPDATE SET
           contact_count = EXCLUDED.contact_count,
           source_csv    = COALESCE(target_companies.source_csv, EXCLUDED.source_csv),
           active        = true`,
        [name, n, csvBase],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const res = await pool.query(
    `SELECT COUNT(*)::int AS n, SUM(contact_count)::int AS contacts
     FROM target_companies WHERE active = true`,
  );
  console.log("Neon:", res.rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error("FEHLER:", err.message);
  process.exit(1);
});
