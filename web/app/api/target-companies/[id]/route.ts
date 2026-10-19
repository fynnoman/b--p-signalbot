import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const pool = getPool();
  const res = await pool.query(
    `DELETE FROM target_companies WHERE id = $1 RETURNING id`,
    [numId],
  );
  if (res.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: numId });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const b = body as { active?: unknown; name?: unknown };
  const updates: string[] = [];
  const values: unknown[] = [];
  if (typeof b.active === "boolean") {
    values.push(b.active);
    updates.push(`active = $${values.length}`);
  }
  if (typeof b.name === "string" && b.name.trim()) {
    values.push(b.name.trim());
    updates.push(`name = $${values.length}`);
  }
  if (updates.length === 0) return NextResponse.json({ error: "no updates" }, { status: 400 });
  values.push(numId);
  const pool = getPool();
  const res = await pool.query(
    `UPDATE target_companies SET ${updates.join(", ")} WHERE id = $${values.length}
     RETURNING id, name, contact_count, active, last_scanned_at`,
    values,
  );
  if (res.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(res.rows[0]);
}
