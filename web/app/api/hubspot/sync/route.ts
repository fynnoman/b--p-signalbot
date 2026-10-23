import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { syncCompanies, syncContacts } from "@/lib/hubspot-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type HsJob = {
  id: string;
  status: "running" | "done" | "error";
  started_at: string;
  ended_at: string | null;
  logs: string[];
  only: string;
  types: string | null;
  exit_code: number | null;
  error: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __hsJobs: Map<string, HsJob> | undefined;
}
function store(): Map<string, HsJob> {
  if (!global.__hsJobs) global.__hsJobs = new Map();
  return global.__hsJobs;
}

const ALLOWED_ONLY = ["all", "both", "companies", "contacts"] as const;
type OnlyMode = (typeof ALLOWED_ONLY)[number];

export async function POST(request: Request) {
  let body: unknown = {};
  try { if (request.headers.get("content-length")) body = await request.json(); }
  catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const b = body as { only?: unknown; types?: unknown };
  const onlyRaw = typeof b.only === "string" ? b.only : "both";
  if (!ALLOWED_ONLY.includes(onlyRaw as OnlyMode)) {
    return NextResponse.json({ error: `invalid only (allowed: ${ALLOWED_ONLY.join(", ")})` }, { status: 400 });
  }
  const only = onlyRaw as OnlyMode;
  const typesRaw = typeof b.types === "string" && b.types.trim() ? b.types.trim() : null;
  const types = typesRaw;
  const acceptedTypes = typesRaw ? typesRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const job: HsJob = {
    id: randomUUID(),
    status: "running",
    started_at: new Date().toISOString(),
    ended_at: null,
    logs: [],
    only,
    types,
    exit_code: null,
    error: null,
  };
  store().set(job.id, job);
  const log = (m: string) => {
    job.logs.push(m);
    if (job.logs.length > 500) job.logs.splice(0, job.logs.length - 500);
  };

  try {
    if (only === "all" || only === "both" || only === "companies") {
      log(`sync companies${acceptedTypes ? ` (types=${acceptedTypes.join(",")})` : ""}`);
      const r = await syncCompanies({ acceptedTypes });
      log(`companies: inserted=${r.inserted} skipped=${r.skipped}`);
    }
    if (only === "all" || only === "both" || only === "contacts") {
      log("sync contacts ...");
      const r = await syncContacts();
      log(`contacts: inserted=${r.inserted} refreshed_targets=${r.refreshed_targets}`);
    }
    job.status = "done";
    job.exit_code = 0;
    job.ended_at = new Date().toISOString();
    log("fertig");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`FEHLER: ${msg}`);
    job.status = "error";
    job.error = msg;
    job.exit_code = 1;
    job.ended_at = new Date().toISOString();
  }

  return NextResponse.json(job, { status: 202 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const j = store().get(id);
    if (!j) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(j);
  }
  return NextResponse.json({
    jobs: Array.from(store().values()).sort((a, b) => b.started_at.localeCompare(a.started_at)),
  });
}
