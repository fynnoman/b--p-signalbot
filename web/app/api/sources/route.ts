import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  const pool = getPool();
  const params: unknown[] = [];
  let where = "";
  if (q) {
    params.push(`%${q}%`);
    where = `WHERE (
      lower(s.title)      LIKE lower($${params.length})
      OR lower(s.publisher) LIKE lower($${params.length})
      OR lower(s.url)      LIKE lower($${params.length})
      OR lower(c.name)     LIKE lower($${params.length})
    )`;
  }
  const [rowsRes, totalRes] = await Promise.all([
    pool.query(
      `SELECT
         s.id,
         s.url,
         s.title,
         s.publisher,
         s.published_at,
         s.fetched_at,
         s.language,
         s.source_quality,
         s.discovered_via,
         c.name           AS company,
         oc.case_class    AS case_class,
         oc.case_priority AS case_priority,
         oc.id            AS case_id,
         oc.no_signal_found AS no_signal_found
       FROM sources s
       LEFT JOIN opportunity_cases oc ON oc.source_id = s.id
       LEFT JOIN companies c ON c.id = oc.company_id
       ${where}
       ORDER BY s.fetched_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM sources s
       LEFT JOIN opportunity_cases oc ON oc.source_id = s.id
       LEFT JOIN companies c ON c.id = oc.company_id
       ${where}`,
      params,
    ),
  ]);
  return NextResponse.json({ rows: rowsRes.rows, total: totalRes.rows[0].n });
}
