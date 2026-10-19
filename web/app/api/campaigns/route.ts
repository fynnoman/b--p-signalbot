import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAMPAIGN_STATUS = new Set(["Entwurf", "Aktiv", "Pausiert", "Abgeschlossen", "Abgebrochen"]);
const CAMPAIGN_KIND = new Set(["outreach", "email", "event", "content", "sonstiges"]);

export async function GET() {
  const pool = getPool();
  const res = await pool.query(
    `SELECT id, name, description, kind, status, start_date, end_date, assigned_to,
            filter_signal_ids, filter_case_class, hubspot_list_id, hubspot_campaign_id,
            notes, created_at, updated_at
     FROM campaigns
     ORDER BY (CASE status
                 WHEN 'Aktiv' THEN 0
                 WHEN 'Entwurf' THEN 1
                 WHEN 'Pausiert' THEN 2
                 WHEN 'Abgeschlossen' THEN 3
                 ELSE 4 END),
              updated_at DESC`,
  );
  return NextResponse.json({ rows: res.rows });
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name fehlt" }, { status: 400 });
  const description = typeof b.description === "string" ? b.description : null;
  const kind = typeof b.kind === "string" && CAMPAIGN_KIND.has(b.kind) ? b.kind : "outreach";
  const status = typeof b.status === "string" && CAMPAIGN_STATUS.has(b.status) ? b.status : "Entwurf";
  const startDate = typeof b.start_date === "string" && b.start_date ? b.start_date : null;
  const endDate = typeof b.end_date === "string" && b.end_date ? b.end_date : null;
  const assignedTo = typeof b.assigned_to === "string" ? b.assigned_to : null;
  const signalIds = Array.isArray(b.filter_signal_ids) ? b.filter_signal_ids.filter((x) => typeof x === "string") : [];
  const caseClasses = Array.isArray(b.filter_case_class) ? b.filter_case_class.filter((x) => typeof x === "string") : [];
  const notes = typeof b.notes === "string" ? b.notes : null;

  const pool = getPool();
  const res = await pool.query(
    `INSERT INTO campaigns (
       name, description, kind, status, start_date, end_date, assigned_to,
       filter_signal_ids, filter_case_class, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [name, description, kind, status, startDate, endDate, assignedTo, signalIds, caseClasses, notes],
  );
  return NextResponse.json(res.rows[0], { status: 201 });
}
