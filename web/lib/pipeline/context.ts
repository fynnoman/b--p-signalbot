// Account Fit + Actionability aus target_companies ableiten.

import { getPool } from "../db";
import type { CompanyContext } from "./types";

export async function resolveCompanyContext(companyHint: string): Promise<CompanyContext> {
  const hint = companyHint.trim();
  if (!hint || !process.env.DATABASE_URL) return scored(0, false, null);

  const pool = getPool();

  const exact = await pool.query<{ name: string; contact_count: number }>(
    `SELECT name, contact_count FROM target_companies WHERE lower(name) = lower($1) LIMIT 1`,
    [hint],
  );
  if (exact.rowCount && exact.rowCount > 0) {
    const { name, contact_count } = exact.rows[0];
    return scored(contact_count, true, name);
  }

  const core = hint
    .replace(/\b(GmbH|AG|SE|KG|KGaA|Co\.?\s*KG|Holding|Group|Werke)\b\.?/gi, "")
    .replace(/\s+&\s+/g, " ")
    .trim();
  if (core.length >= 3) {
    const fuzzy = await pool.query<{ name: string; contact_count: number }>(
      `SELECT name, contact_count FROM target_companies
       WHERE lower(name) LIKE lower($1)
       ORDER BY contact_count DESC
       LIMIT 1`,
      [`%${core}%`],
    );
    if (fuzzy.rowCount && fuzzy.rowCount > 0) {
      const { name, contact_count } = fuzzy.rows[0];
      return scored(contact_count, true, name);
    }
  }

  return scored(0, false, null);
}

function scored(contactCount: number, isTarget: boolean, matched: string | null): CompanyContext {
  const c = Number(contactCount) || 0;
  let accountFit: number;
  let actionability: number;

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
