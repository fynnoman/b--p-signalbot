import { NextResponse } from "next/server";
import { fetchContacts } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const company = url.searchParams.get("company") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const data = await fetchContacts({ query, company, limit, offset });
  return NextResponse.json(data);
}
