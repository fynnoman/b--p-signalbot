// Kontext-Layer: liefert Account Fit + Actionability fuer eine Firma.
// Konzept Kap. 3: getrennte Dimensionen, nachvollziehbar begruendet.
//
// Datenquelle im Prototyp: target_companies (HubSpot-Export).
//   - Firma in Zielunternehmensliste vorhanden       -> account_fit-Basiswert
//   - Kontaktzahl (contact_count)                     -> naeherungsweise Retainer-/Beziehungspotenzial
//   - contact_count = 0                              -> account_fit 40 (Zielkunde, keine Beziehung)
//   - contact_count 1-2                              -> 60 (schwaches Netzwerk)
//   - contact_count 3-5                              -> 75 (bekannter Account)
//   - contact_count >= 6                             -> 90 (Bestandskunde / Retainer-Naehe)
//   - Firma nicht in Liste                            -> 20 (nicht Zielkunde)
//
// Actionability (Kap. 3): bekannter Entscheider + gemeinsamer Kontakt.
//   Ohne LinkedIn/HubSpot-API rechnen wir konservativ:
//   contact_count = 0 -> 25, 1-2 -> 50, 3-5 -> 70, >=6 -> 85.

import { getPool } from "./db.js";

/**
 * @param {string} companyHint
 * @returns {Promise<{ account_fit:number, actionability:number, contact_count:number, is_target:boolean, matched_name:string|null }>}
 */
export async function resolveCompanyContext(companyHint) {
  const hint = companyHint.trim();
  if (!hint) return defaults(0, false, null);
  if (!process.env.DATABASE_URL) return defaults(0, false, null);

  const pool = await getPool();

  // 1. exakter Match
  const exact = await pool.query(
    `SELECT name, contact_count FROM target_companies WHERE lower(name) = lower($1) LIMIT 1`,
    [hint],
  );
  if (exact.rowCount > 0) {
    const { name, contact_count } = exact.rows[0];
    return scored(contact_count, true, name);
  }

  // 2. fuzzy: enthaelt Firmenkern
  const core = hint
    .replace(/\b(GmbH|AG|SE|KG|KGaA|Co\.?\s*KG|Holding|Group|Werke)\b\.?/gi, "")
    .replace(/\s+&\s+/g, " ")
    .trim();
  if (core.length >= 3) {
    const fuzzy = await pool.query(
      `SELECT name, contact_count FROM target_companies
       WHERE lower(name) LIKE lower($1)
       ORDER BY contact_count DESC
       LIMIT 1`,
      [`%${core}%`],
    );
    if (fuzzy.rowCount > 0) {
      const { name, contact_count } = fuzzy.rows[0];
      return scored(contact_count, true, name);
    }
  }

  return defaults(0, false, null);
}

function scored(contactCount, isTarget, matched) {
  const c = Number(contactCount) || 0;
  let accountFit;
  let actionability;

  if (!isTarget) {
    accountFit = 20;
    actionability = 15;
  } else if (c === 0) {
    accountFit = 40;
    actionability = 25;
  } else if (c <= 2) {
    accountFit = 60;
    actionability = 50;
  } else if (c <= 5) {
    accountFit = 75;
    actionability = 70;
  } else {
    accountFit = 90;
    actionability = 85;
  }

  return {
    account_fit: accountFit,
    actionability,
    contact_count: c,
    is_target: isTarget,
    matched_name: matched,
  };
}

function defaults(contactCount, isTarget, matched) {
  return scored(contactCount, isTarget, matched);
}
