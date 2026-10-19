import { NextResponse } from "next/server";
import { startSingleScan, type JobMode } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const b = body as { company?: unknown; limit?: unknown; mode?: unknown };
  const company = typeof b.company === "string" ? b.company : "";
  if (!company.trim()) {
    return NextResponse.json({ error: "company fehlt" }, { status: 400 });
  }
  const limit = typeof b.limit === "number" ? b.limit : 5;
  const mode: JobMode = b.mode === "broad" ? "broad" : "focused";

  try {
    const job = startSingleScan({ company, limit, mode });
    return NextResponse.json(job, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unbekannter Fehler" },
      { status: 400 },
    );
  }
}
