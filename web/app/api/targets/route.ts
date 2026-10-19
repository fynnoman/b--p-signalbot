import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const pool = getPool();
  const res = await pool.query<{
    total: number;
    scanned: number;
    last_scan: string | null;
  }>(`
    SELECT
      COUNT(*)::int                                           AS total,
      COUNT(*) FILTER (WHERE last_scanned_at IS NOT NULL)::int AS scanned,
      MAX(last_scanned_at)                                    AS last_scan
    FROM target_companies
    WHERE active = true
  `);
  return NextResponse.json(res.rows[0]);
}
