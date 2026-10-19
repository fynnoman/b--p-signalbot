import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAMPAIGN_STATUS = new Set(["Entwurf", "Aktiv", "Pausiert", "Abgeschlossen", "Abgebrochen"]);
const CAMPAIGN_KIND = new Set(["outreach", "email", "event", "content", "sonstiges"]);

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const pool = getPool();
  const res = await pool.query(`DELETE FROM campaigns WHERE id = $1 RETURNING id`, [numId]);
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
  const b = body as Record<string, unknown>;
  const updates: string[] = [];
  const values: unknown[] = [];
  const set = (field: string, value: unknown) => { values.push(value); updates.push(`${field} = $${values.length}`); };

  if (typeof b.name === "string" && b.name.trim()) set("name", b.name.trim());
  if (b.description !== undefined) set("description", b.description);
  if (typeof b.kind === "string" && CAMPAIGN_KIND.has(b.kind)) set("kind", b.kind);
  if (typeof b.status === "string" && CAMPAIGN_STATUS.has(b.status)) set("status", b.status);
  if (b.start_date !== undefined) set("start_date", b.start_date === "" ? null : b.start_date);
  if (b.end_date !== undefined) set("end_date", b.end_date === "" ? null : b.end_date);
  if (b.assigned_to !== undefined) set("assigned_to", b.assigned_to);
  if (Array.isArray(b.filter_signal_ids)) set("filter_signal_ids", b.filter_signal_ids.filter((x) => typeof x === "string"));
  if (Array.isArray(b.filter_case_class)) set("filter_case_class", b.filter_case_class.filter((x) => typeof x === "string"));
  if (b.notes !== undefined) set("notes", b.notes);
  if (updates.length === 0) return NextResponse.json({ error: "no updates" }, { status: 400 });

  values.push(numId);
  const pool = getPool();
  const res = await pool.query(
    `UPDATE campaigns SET ${updates.join(", ")}, updated_at = now() WHERE id = $${values.length}
     RETURNING *`,
    values,
  );
  if (res.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(res.rows[0]);
}
