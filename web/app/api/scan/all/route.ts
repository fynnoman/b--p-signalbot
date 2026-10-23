import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Batch-Scan läuft wegen Function-Timeouts nicht im Dashboard. " +
        "Bitte lokal ausführen: `node --env-file=.env src/index.js scan-batch`.",
    },
    { status: 501 },
  );
}
