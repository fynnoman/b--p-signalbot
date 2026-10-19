import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const pool = getPool();
  const params: unknown[] = [];
  let where = "";
  if (q) {
    params.push(`%${q}%`);
    where = `WHERE lower(name) LIKE lower($${params.length})`;
  }
  const [rowsRes, totalRes] = await Promise.all([
    pool.query(
      `SELECT id, name, contact_count, active, last_scanned_at
       FROM target_companies
       ${where}
       ORDER BY contact_count DESC, name ASC
       LIMIT 300`,
      params,
    ),
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM target_companies ${where}`,
      params,
    ),
  ]);
  return NextResponse.json({ rows: rowsRes.rows, total: totalRes.rows[0].n });
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const b = body as { name?: unknown };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 200) {
    return NextResponse.json({ error: "name fehlt oder zu lang" }, { status: 400 });
  }
  const pool = getPool();
  const res = await pool.query(
    `INSERT INTO target_companies (name, contact_count, active, source_csv)
     VALUES ($1, 0, true, 'manual')
     ON CONFLICT (name) DO UPDATE SET active = true
     RETURNING id, name, contact_count, active, last_scanned_at`,
    [name],
  );
  return NextResponse.json(res.rows[0], { status: 201 });
}
