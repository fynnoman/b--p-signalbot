import { NextResponse } from "next/server";
import { hsFetch } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HubspotPropertyOption = {
  label: string;
  value: string;
  hidden?: boolean;
  displayOrder?: number;
};

type HubspotProperty = {
  name: string;
  label: string;
  options?: HubspotPropertyOption[];
};

export async function GET() {
  if (!process.env.HUBSPOT_TOKEN) {
    return NextResponse.json({ options: [], token_present: false });
  }
  try {
    const prop = await hsFetch<HubspotProperty>("/crm/v3/properties/companies/type");
    const options = (prop.options ?? [])
      .filter((o) => !o.hidden && o.value)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((o) => ({ label: o.label, value: o.value }));
    return NextResponse.json({ options, token_present: true });
  } catch (err) {
    return NextResponse.json(
      { options: [], token_present: true, error: err instanceof Error ? err.message : "HubSpot-Fehler" },
      { status: 502 },
    );
  }
}
