import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampInt(v: string | null, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = clampInt(url.searchParams.get("limit"), 1, 500, 100);
  const offset = clampInt(url.searchParams.get("offset"), 0, 1_000_000, 0);
  const pool = getPool();
  const whereParams: unknown[] = [];
  let where = "WHERE company_name IS NOT NULL AND company_name <> ''";
  if (q) {
    whereParams.push(`%${q}%`);
    where += ` AND lower(company_name) LIKE lower($${whereParams.length})`;
  }
  const pageParams = [...whereParams, limit, offset];
  const limitIdx = pageParams.length - 1;
  const offsetIdx = pageParams.length;
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
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    pageParams,
  );
  const totalRes = await pool.query<{ n: number }>(
    `SELECT COUNT(DISTINCT company_name)::int AS n
     FROM hubspot_contacts
     ${where}`,
    whereParams,
  );
  return NextResponse.json({ companies: res.rows, total: totalRes.rows[0].n, limit, offset });
}
