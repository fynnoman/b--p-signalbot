// Multi-Strategie-Scan einer Firma: discover + pipeline + persist.
// Entspricht funktional dem CLI-Kommando `scan` aus src/index.js, nur in-process.

import { discoverBingNews, TRADE_SITES_DE } from "./discover-bing";
import { runPipeline } from "./index";
import { persistPipelineResult } from "./persist";
import type { BingCandidate, PipelineResult } from "./types";

export type ScanLogEntry = { ts: string; message: string };

export type ScanHit = {
  strategy: string;
  url: string;
  title: string | null;
  source: string | null;
  published_at: string | null;
  case_priority: number;
  case_class: string;
  top_signal: string | null;
  case_id: number | null;
};

export type ScanResult = {
  company: string;
  strategies_run: string[];
  discovered_total: number;
  processed: number;
  hits: ScanHit[];
  errors: { url: string; message: string }[];
  logs: ScanLogEntry[];
  persisted: boolean;
};

export async function scanCompany(input: {
  company: string;
  limit?: number;
  mode?: "focused" | "broad";
  maxAgeMonths?: number;
  hitTarget?: number;
  persist?: boolean;
}): Promise<ScanResult> {
  const company = input.company.trim();
  if (!company) throw new Error("company fehlt");

  const limit = Math.max(1, Math.min(30, input.limit ?? 5));
  const mode = input.mode === "broad" ? "broad" : "focused";
  const maxAge = Math.max(1, Math.min(60, input.maxAgeMonths ?? 12));
  const hitTarget = Math.max(1, input.hitTarget ?? 2);
  const persist = input.persist !== false && !!process.env.DATABASE_URL;

  const strategies: { name: string; opts: Parameters<typeof discoverBingNews>[1] }[] = [
    { name: "bing-broad",     opts: { mode: "broad",   limit, maxAgeMonths: maxAge } },
    { name: "bing-focused",   opts: { mode: "focused", limit, maxAgeMonths: maxAge } },
    { name: "bing-trade",     opts: { mode: "focused", limit, maxAgeMonths: maxAge, sites: TRADE_SITES_DE } },
    { name: "bing-broad-old", opts: { mode: "broad",   limit, maxAgeMonths: maxAge * 2 } },
  ];
  if (mode === "focused") {
    strategies.unshift({ name: "bing-focused-first", opts: { mode: "focused", limit, maxAgeMonths: maxAge } });
  }

  const logs: ScanLogEntry[] = [];
  const log = (message: string) => logs.push({ ts: new Date().toISOString(), message });

  const seen = new Set<string>();
  const hits: ScanHit[] = [];
  const errors: { url: string; message: string }[] = [];
  const strategiesRun: string[] = [];
  let discoveredTotal = 0;
  let processed = 0;

  for (const strat of strategies) {
    if (hits.length >= hitTarget) {
      log(`hit target ${hitTarget} erreicht - stoppe vor Strategie ${strat.name}`);
      break;
    }
    strategiesRun.push(strat.name);
    log(`Strategie ${strat.name} start`);

    let discovery;
    try {
      discovery = await discoverBingNews(company, { ...strat.opts, lang: "de" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Strategie ${strat.name} discover-error: ${msg}`);
      continue;
    }
    discoveredTotal += discovery.total;
    log(`Strategie ${strat.name} candidates=${discovery.total}`);

    for (const candidate of discovery.candidates) {
      if (hits.length >= hitTarget) break;
      const url = candidate.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      processed += 1;
      log(`-> ${url}`);
      try {
        const result = await runPipeline({ url, companyHint: company });
        let caseId: number | null = null;
        if (persist) {
          try {
            const persisted = await persistPipelineResult({
              url, companyHint: company, discoveredVia: "bing-news",
              candidate, resolveMethod: "bing-direct", result,
            });
            caseId = persisted.case_id;
            log(`db-ok case=${caseId} signals=${result.signals.length}`);
          } catch (dbErr) {
            const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
            log(`db-error ${msg}`);
          }
        }
        if (!result.extraction.no_signal_found) {
          hits.push(buildHit(strat.name, candidate, result, caseId));
        }
      } catch (pipeErr) {
        const msg = pipeErr instanceof Error ? pipeErr.message : String(pipeErr);
        log(`pipe-error ${msg}`);
        errors.push({ url, message: msg });
      }
    }
  }

  return {
    company,
    strategies_run: strategiesRun,
    discovered_total: discoveredTotal,
    processed,
    hits,
    errors,
    logs,
    persisted: persist,
  };
}

function buildHit(
  strategy: string,
  candidate: BingCandidate,
  result: PipelineResult,
  caseId: number | null,
): ScanHit {
  return {
    strategy,
    url: candidate.url,
    title: candidate.title,
    source: candidate.source,
    published_at: candidate.published_at,
    case_priority: result.opportunity_case.case_priority,
    case_class: result.opportunity_case.case_class,
    top_signal: result.signals[0]?.signal_id ?? null,
    case_id: caseId,
  };
}
