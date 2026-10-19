import { NextResponse } from "next/server";
import { fetchSignalsForCase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const caseId = Number(id);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    return NextResponse.json({ error: "invalid case id" }, { status: 400 });
  }
  const signals = await fetchSignalsForCase(caseId);
  return NextResponse.json({ signals });
}
