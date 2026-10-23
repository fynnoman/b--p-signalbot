// Aufruf:
//   node --env-file=.env scripts/hubspot-sync.mjs
//   node --env-file=.env scripts/hubspot-sync.mjs --only=companies --types="Kunde,nicht aktiver Kunde"
//   node --env-file=.env scripts/hubspot-sync.mjs --only=lists

import {
  syncAll, syncCompanies, syncContacts, syncLists, syncDeals,
} from "../src/hubspot/sync.js";
import { hsWhoami } from "../src/hubspot/client.js";
import { closePool } from "../src/db.js";

function parseFlags(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1);
    else out[a.slice(2)] = true;
  }
  return out;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const acceptedTypes = typeof flags.types === "string" && flags.types
    ? flags.types.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  // whoami braucht account-info-Scope, den wir nicht angefragt haben. Skip.
  process.stderr.write(`[hubspot] start\n`);

  const only = typeof flags.only === "string" ? flags.only : "all";
  const results = {};
  try {
    if (only === "all" || only === "both" || only === "companies") {
      console.log("[hubspot] sync companies", acceptedTypes ? `(types=${acceptedTypes.join(",")})` : "");
      results.companies = await syncCompanies({ acceptedTypes });
    }
    if (only === "all" || only === "both" || only === "contacts") {
      console.log("[hubspot] sync contacts...");
      results.contacts = await syncContacts();
    }
    if (only === "all" || only === "lists") {
      console.log("[hubspot] sync lists...");
      results.lists = await syncLists();
    }
    if (only === "all" || only === "deals") {
      console.log("[hubspot] sync deals...");
      results.deals = await syncDeals();
    }
    console.log("[hubspot] fertig:", results);
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error("FEHLER:", err.message);
  process.exit(1);
});
