import { NextResponse } from "next/server";
import { fetchEmergingCompanies } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await fetchEmergingCompanies();
  return NextResponse.json({ companies: rows });
}
