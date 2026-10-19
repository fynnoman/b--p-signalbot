import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const pool = getPool();
  const params: unknown[] = [];
  let where = "WHERE company_name IS NOT NULL AND company_name <> ''";
  if (q) {
    params.push(`%${q}%`);
    where += ` AND lower(company_name) LIKE lower($${params.length})`;
  }
  const res = await pool.query<{
    company_name: string;
    contact_count: number;
    last_activity: string | null;
    is_target: boolean;
  }>(
    `SELECT
       MAX(hc.company_name)      AS company_name,
       COUNT(*)::int             AS contact_count,
       MAX(hc.last_activity)     AS last_activity,
       bool_or(tc.id IS NOT NULL) AS is_target
     FROM hubspot_contacts hc
     LEFT JOIN target_companies tc ON lower(tc.name) = lower(trim(hc.company_name))
     ${where}
     GROUP BY lower(trim(hc.company_name))
     ORDER BY contact_count DESC, company_name ASC
     LIMIT 300`,
    params,
  );
  const totalRes = await pool.query<{ n: number }>(
    `SELECT COUNT(DISTINCT company_name)::int AS n
     FROM hubspot_contacts
     ${where}`,
    params,
  );
  return NextResponse.json({ companies: res.rows, total: totalRes.rows[0].n });
}
