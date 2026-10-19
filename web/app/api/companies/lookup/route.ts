import { NextResponse } from "next/server";
import { lookupContactsForCompany } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get("name") ?? "";
  if (!name.trim()) {
    return NextResponse.json({ contacts: [] });
  }
  const contacts = await lookupContactsForCompany(name);
  return NextResponse.json({ contacts, company: name });
}
