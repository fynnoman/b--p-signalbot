import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

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

const BOT_DIR = resolvePath(process.cwd(), "..");
const ENV_FILE = resolvePath(BOT_DIR, ".env");

export async function POST(request: Request) {
  let body: unknown = {};
  try { if (request.headers.get("content-length")) body = await request.json(); }
  catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const b = body as { only?: unknown; types?: unknown };
  const only = typeof b.only === "string" ? b.only : "all";
  const types = typeof b.types === "string" && b.types.trim() ? b.types.trim() : null;

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

  const args = [
    `--env-file=${ENV_FILE}`,
    "scripts/hubspot-sync.mjs",
    `--only=${only}`,
  ];
  if (types) args.push(`--types=${types}`);

  const child = spawn(process.execPath, args, { cwd: BOT_DIR, env: process.env });
  const consume = (buf: Buffer) => {
    const text = buf.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (t) job.logs.push(t);
    }
    if (job.logs.length > 500) job.logs.splice(0, job.logs.length - 500);
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  child.on("error", (err) => {
    job.status = "error";
    job.error = err.message;
    job.ended_at = new Date().toISOString();
  });
  child.on("exit", (code) => {
    job.exit_code = code ?? null;
    job.ended_at = new Date().toISOString();
    if (job.status === "running") {
      job.status = code === 0 ? "done" : "error";
      if (code !== 0) job.error = `Exit ${code}`;
    }
  });

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
