import { NextResponse } from "next/server";
import { getPool, CASE_STATUSES } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const caseId = Number(id);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    return NextResponse.json({ error: "invalid case id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const b = body as {
    status?: unknown;
    assigned_to?: unknown;
    next_review_at?: unknown;
    case_title?: unknown;
  };

  const updates: string[] = [];
  const values: unknown[] = [];

  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !CASE_STATUSES.includes(b.status as (typeof CASE_STATUSES)[number])) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    values.push(b.status);
    updates.push(`status = $${values.length}`);
  }
  if (b.assigned_to !== undefined) {
    if (b.assigned_to !== null && typeof b.assigned_to !== "string") {
      return NextResponse.json({ error: "invalid assigned_to" }, { status: 400 });
    }
    values.push(b.assigned_to);
    updates.push(`assigned_to = $${values.length}`);
  }
  if (b.next_review_at !== undefined) {
    if (b.next_review_at !== null && typeof b.next_review_at !== "string") {
      return NextResponse.json({ error: "invalid next_review_at" }, { status: 400 });
    }
    values.push(b.next_review_at);
    updates.push(`next_review_at = $${values.length}`);
  }
  if (b.case_title !== undefined) {
    if (b.case_title !== null && typeof b.case_title !== "string") {
      return NextResponse.json({ error: "invalid case_title" }, { status: 400 });
    }
    values.push(b.case_title);
    updates.push(`case_title = $${values.length}`);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "no updates" }, { status: 400 });
  }

  values.push(caseId);
  const pool = getPool();
  const res = await pool.query(
    `UPDATE opportunity_cases SET ${updates.join(", ")}, updated_at = now()
     WHERE id = $${values.length}
     RETURNING id, status, assigned_to, next_review_at, case_title`,
    values,
  );
  if (res.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(res.rows[0]);
}
