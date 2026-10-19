import { NextResponse } from "next/server";
import { fetchCases, fetchStats, type CaseClass } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawClass = url.searchParams.get("class") ?? "all";
  const company = url.searchParams.get("company") ?? "";
  const caseClass = (["Hot", "Warm", "Watchlist", "Archiv", "all"].includes(rawClass)
    ? rawClass
    : "all") as CaseClass | "all";

  const [cases, stats] = await Promise.all([
    fetchCases({ caseClass, company }),
    fetchStats(),
  ]);
  return NextResponse.json({ cases, stats });
}
