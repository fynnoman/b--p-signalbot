// In-Memory-Jobstore. Scans laufen jetzt in-process (keine Child-Prozesse mehr),
// damit das Dashboard auch auf Vercel funktioniert.

import { randomUUID } from "node:crypto";
import { scanCompany } from "./pipeline/scan";

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
  discovered: number;
  persisted: number;
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

const MAX_LOG_LINES = 400;

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

function pushLog(job: Job, message: string) {
  job.logs.push(message);
  if (job.logs.length > MAX_LOG_LINES) {
    job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
  }
}

/**
 * Fuehrt einen Single-Scan synchron in-process aus. Die Pipeline (fetch + LLM
 * + persist) laeuft bis zum Hit-Target (2) oder bis alle Strategien durch sind.
 * Rueckgabe: fertiger Job mit status `done` oder `error`.
 */
export async function runSingleScan(input: { company: string; limit?: number; mode?: JobMode }): Promise<Job> {
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

  try {
    const result = await scanCompany({ company, limit, mode });
    for (const entry of result.logs) pushLog(job, entry.message);
    job.discovered = result.discovered_total;
    job.processed = result.processed;
    job.hits = result.hits.length;
    job.errors = result.errors.length;
    job.persisted = result.hits.filter((h) => h.case_id !== null).length;
    job.status = "done";
    job.exit_code = 0;
    job.ended_at = new Date().toISOString();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pushLog(job, `scan-error ${msg}`);
    job.status = "error";
    job.error = msg;
    job.exit_code = 1;
    job.ended_at = new Date().toISOString();
  }
  return job;
}

/**
 * Platzhalter fuer den Batch-Scan. Auf Vercel-Serverless laeuft das wegen
 * Function-Timeouts nicht sicher durch. Bis zu einem externen Worker /
 * Queue bleibt der Batch-Scan dem CLI vorbehalten.
 */
export async function runBatchScan(_input: {
  limitCompanies?: number | null;
  perCompany?: number;
  mode?: JobMode;
  concurrency?: number;
}): Promise<never> {
  throw new Error(
    "Batch-Scan ist in der aktuellen Deployment-Umgebung nicht verfuegbar. " +
      "Bitte lokal ausfuehren: `node --env-file=.env src/index.js scan-batch`.",
  );
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
