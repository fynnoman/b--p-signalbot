import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const hasToken = !!process.env.HUBSPOT_TOKEN;
  const pool = getPool();
  const [companies, contacts, deals, lists] = await Promise.all([
    pool.query<{ n: number; last: string | null }>(
      `SELECT COUNT(*)::int AS n, MAX(imported_at) AS last FROM hs_companies`,
    ),
    pool.query<{ n: number; last: string | null }>(
      `SELECT COUNT(*)::int AS n, MAX(imported_at) AS last FROM hubspot_contacts`,
    ),
    pool.query<{ n: number; last: string | null }>(
      `SELECT COUNT(*)::int AS n, MAX(imported_at) AS last FROM hs_deals`,
    ),
    pool.query<{ n: number; last: string | null }>(
      `SELECT COUNT(*)::int AS n, MAX(imported_at) AS last FROM hs_lists`,
    ),
  ]);
  return NextResponse.json({
    token_present: hasToken,
    companies: companies.rows[0],
    contacts:  contacts.rows[0],
    deals:     deals.rows[0],
    lists:     lists.rows[0],
  });
}
