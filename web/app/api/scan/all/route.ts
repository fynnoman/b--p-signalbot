import { NextResponse } from "next/server";
import { startBatchScan, type JobMode } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    if (request.headers.get("content-length")) {
      body = await request.json();
    }
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const b = body as { limitCompanies?: unknown; perCompany?: unknown; mode?: unknown; concurrency?: unknown };
  const limitCompanies =
    typeof b.limitCompanies === "number" ? b.limitCompanies : null;
  const perCompany = typeof b.perCompany === "number" ? b.perCompany : 1;
  const mode: JobMode = b.mode === "broad" ? "broad" : "focused";
  const concurrency = typeof b.concurrency === "number" ? b.concurrency : 5;

  try {
    const job = startBatchScan({ limitCompanies, perCompany, mode, concurrency });
    return NextResponse.json(job, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unbekannter Fehler" },
      { status: 400 },
    );
  }
}
