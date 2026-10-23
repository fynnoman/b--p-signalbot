import { spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { randomUUID } from "node:crypto";

export type JobStatus = "running" | "done" | "error";
export type JobMode = "focused" | "broad";
export type JobType = "single" | "batch";

export type Job = {
  id: string;
  type: JobType;
  label: string;
  company: string | null;
  limit: number;
  mode: JobMode;
  concurrency: number;
  status: JobStatus;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  error: string | null;
  logs: string[];
  // fuer single
  discovered: number;
  persisted: number;
  // fuer batch
  total: number;
  processed: number;
  hits: number;
  errors: number;
  current_company: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __jobStore: Map<string, Job> | undefined;
}

function store(): Map<string, Job> {
  if (!global.__jobStore) global.__jobStore = new Map();
  return global.__jobStore;
}

const BOT_DIR = resolvePath(process.cwd(), "..");
const ENV_FILE = resolvePath(BOT_DIR, ".env");
const MAX_LOG_LINES = 800;

export function listJobs(): Job[] {
  return Array.from(store().values()).sort((a, b) =>
    b.started_at.localeCompare(a.started_at),
  );
}

export function getJob(id: string): Job | undefined {
  return store().get(id);
}

function newJob(partial: Partial<Job>): Job {
  return {
    id: randomUUID(),
    type: "single",
    label: "",
    company: null,
    limit: 5,
    mode: "focused",
    concurrency: 1,
    status: "running",
    started_at: new Date().toISOString(),
    ended_at: null,
    exit_code: null,
    error: null,
    logs: [],
    discovered: 0,
    persisted: 0,
    total: 0,
    processed: 0,
    hits: 0,
    errors: 0,
    current_company: null,
    ...partial,
  };
}

export function startSingleScan(input: { company: string; limit?: number; mode?: JobMode }): Job {
  const company = input.company.trim();
  if (!company) throw new Error("company fehlt");
  if (company.length > 200) throw new Error("company zu lang");
  const limit = clampInt(input.limit ?? 5, 1, 30);
  const mode: JobMode = input.mode === "broad" ? "broad" : "focused";

  const job = newJob({
    type: "single",
    label: `Einzel-Scan: ${company}`,
    company,
    limit,
    mode,
  });
  store().set(job.id, job);

  const args = [
    `--env-file=${ENV_FILE}`,
    "src/index.js",
    "scan",
    company,
    `--limit=${limit}`,
    `--mode=${mode}`,
  ];
  spawnAndAttach(job, args);
  return job;
}

export function startBatchScan(input: {
  limitCompanies?: number | null;
  perCompany?: number;
  mode?: JobMode;
  concurrency?: number;
}): Job {
  const limitCompanies = input.limitCompanies == null ? 0 : clampInt(input.limitCompanies, 1, 10000);
  const perCompany = clampInt(input.perCompany ?? 1, 1, 10);
  const mode: JobMode = input.mode === "broad" ? "broad" : "focused";
  const concurrency = clampInt(input.concurrency ?? 5, 1, 20);

  const job = newJob({
    type: "batch",
    label:
      limitCompanies > 0
        ? `Batch: Top ${limitCompanies} Zielfirmen`
        : `Batch: alle Zielfirmen`,
    limit: perCompany,
    mode,
    concurrency,
  });
  store().set(job.id, job);

  const args = [
    `--env-file=${ENV_FILE}`,
    "src/index.js",
    "scan-batch",
    `--per-company=${perCompany}`,
    `--mode=${mode}`,
    `--concurrency=${concurrency}`,
  ];
  if (limitCompanies > 0) args.push(`--limit-companies=${limitCompanies}`);
  spawnAndAttach(job, args);
  return job;
}

function spawnAndAttach(job: Job, args: string[]) {
  const child = spawn(process.execPath, args, { cwd: BOT_DIR, env: process.env });

  const consume = (buf: Buffer) => {
    const text = buf.toString("utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      job.logs.push(line);
      // single-scan Zaehler
      if (line.startsWith("[scan] -> ")) job.discovered += 1;
      if (line.startsWith("[scan] db-ok")) job.persisted += 1;
      // batch Zaehler
      const startMatch = line.match(/^\[batch\] start total=(\d+)/);
      if (startMatch) job.total = Number(startMatch[1]);
      const progressMatch = line.match(/^\[batch\] progress=(\d+)\/(\d+) company="(.+)"$/);
      if (progressMatch) {
        job.processed = Number(progressMatch[1]);
        job.total = Number(progressMatch[2]);
        job.current_company = progressMatch[3];
      }
      const statsMatch = line.match(
        /^\[batch\] stats processed=(\d+) persisted=(\d+) hits=(\d+) errors=(\d+)/,
      );
      if (statsMatch) {
        job.processed = Number(statsMatch[1]);
        job.persisted = Number(statsMatch[2]);
        job.hits = Number(statsMatch[3]);
        job.errors = Number(statsMatch[4]);
      }
    }
    if (job.logs.length > MAX_LOG_LINES) {
      job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
    }
  };

  child.stderr.on("data", consume);
  child.stdout.on("data", () => {});
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
      if (code !== 0) job.error = `Bot beendet mit Exit-Code ${code}`;
    }
  });
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
