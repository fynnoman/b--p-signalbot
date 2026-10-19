// CLI-Entry.
//
// Subcommands:
//   run     <url> <company>            -> Pipeline auf eine bekannte URL
//   discover <company>                 -> Kandidaten-URLs listen (kein LLM)
//   scan    <company>                  -> Discover + Pipeline auf jede Kandidatin
//
// Beispiele:
//   node --env-file=.env src/index.js run "https://..." "Ford-Werke GmbH"
//   node --env-file=.env src/index.js discover "Ford-Werke GmbH"
//   node --env-file=.env src/index.js scan "Ford-Werke GmbH" --limit=5 --mode=focused

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { fetchPageText } from "./fetch.js";
import { extractSignals } from "./extract.js";
import { scoreSignal, aggregateCase } from "./score.js";
import { discoverBingNews, TRADE_SITES_DE } from "./discover-bing.js";
import { persistPipelineResult, closePool, getPool } from "./db.js";
import { resolveCompanyContext } from "./context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAXONOMY_PATH = resolve(__dirname, "../data/signal-taxonomy.json");

async function loadTaxonomy() {
  return JSON.parse(await readFile(TAXONOMY_PATH, "utf8"));
}

export async function runPipeline({ url, companyHint, accountFit = null, actionability = null, taxonomy, companyContext = null }) {
  const tax = taxonomy ?? (await loadTaxonomy());
  const ctx = companyContext ?? (await resolveCompanyContext(companyHint));
  const fit = accountFit ?? ctx.account_fit;
  const act = actionability ?? ctx.actionability;

  const fetched = await fetchPageText(url);
  const { model, usage, result } = await extractSignals({
    text: fetched.text,
    url,
    companyHint,
    taxonomy: tax,
  });

  const scored = result.detected_signals.map((sig) => ({
    ...sig,
    scoring: scoreSignal(sig, {
      account_fit: fit,
      actionability: act,
      reference_date: fetched.fetched_at,
    }),
  }));

  const caseScore = aggregateCase(scored.map((s) => s.scoring));

  return {
    meta: {
      url,
      company_hint: companyHint,
      fetched_at: fetched.fetched_at,
      source_char_count: fetched.char_count,
      model,
      llm_usage: usage,
      account_fit: fit,
      actionability: act,
      company_context: ctx,
    },
    extraction: {
      company_name: result.company_name,
      language: result.language,
      publication_date: result.publication_date,
      no_signal_found: result.no_signal_found,
      summary: result.summary,
      source_quality: result.source_quality,
    },
    signals: scored,
    opportunity_case: caseScore,
  };
}

// Sehr kleiner Flag-Parser: --key=value, --flag.
function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else flags[a.slice(2)] = true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function cmdDiscover({ positional, flags }) {
  const companyHint = positional.join(" ").trim();
  if (!companyHint) throw new Error("discover: <company> fehlt");
  const result = await discoverBingNews(companyHint, {
    mode: flags.mode === "broad" ? "broad" : "focused",
    limit: flags.limit ? Number(flags.limit) : 30,
    lang: flags.lang ?? "de",
    maxAgeMonths: flags["max-age-months"] ? Number(flags["max-age-months"]) : 12,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdScan({ positional, flags }) {
  const companyHint = positional.join(" ").trim();
  if (!companyHint) throw new Error("scan: <company> fehlt");

  const limit = flags.limit ? Number(flags.limit) : 8;
  const maxAge = flags["max-age-months"] ? Number(flags["max-age-months"]) : 12;
  const concurrency = Math.max(1, Math.min(10, Number(flags.concurrency ?? 4)));
  const hitTarget = Math.max(1, Number(flags["hit-target"] ?? 2));
  // Multi-Strategie: broad, focused und Fachmedien-Restriktion. Der Bot iteriert,
  // bis er einen Hit hat oder alle Strategien durch sind.
  const strategies = [
    { name: "bing-broad", opts: { mode: "broad",   limit, maxAgeMonths: maxAge } },
    { name: "bing-focused", opts: { mode: "focused", limit, maxAgeMonths: maxAge } },
    { name: "bing-trade", opts: { mode: "focused", limit, maxAgeMonths: maxAge, sites: TRADE_SITES_DE } },
    { name: "bing-broad-old", opts: { mode: "broad", limit, maxAgeMonths: maxAge * 2 } }, // Fallback: 24 Monate
  ];

  const dbEnabled = shouldPersist(flags);
  const taxonomy = await loadTaxonomy();
  const runs = [];
  const seenUrls = new Set();
  let hitCount = 0;
  const shouldAbort = () => hitCount >= hitTarget;

  async function processCandidate(candidate, stratName) {
    const targetUrl = candidate.url;
    if (seenUrls.has(targetUrl)) return;
    seenUrls.add(targetUrl);
    process.stderr.write(`[scan] -> ${targetUrl}\n`);
    try {
      const out = await runPipeline({ url: targetUrl, companyHint, taxonomy });
      let persisted = null;
      if (dbEnabled) {
        try {
          persisted = await persistPipelineResult({
            url: targetUrl,
            companyHint,
            discoveredVia: "bing-news",
            candidate,
            resolveMethod: "bing-direct",
            result: out,
          });
          process.stderr.write(
            `[scan] db-ok case=${persisted.case_id} signals=${out.signals.length}\n`,
          );
        } catch (dbErr) {
          process.stderr.write(`[scan] db-error ${dbErr.message}\n`);
        }
      }
      if (!out.extraction.no_signal_found) hitCount += 1;
      runs.push({
        strategy: stratName,
        candidate,
        resolved_url: targetUrl,
        resolve_method: "bing-direct",
        result: out,
        persisted,
      });
    } catch (err) {
      runs.push({
        strategy: stratName,
        candidate,
        resolved_url: targetUrl,
        resolve_method: "bing-direct",
        error: err.message,
      });
    }
  }

  for (const strat of strategies) {
    if (shouldAbort()) {
      process.stderr.write(`[scan] hitCount=${hitCount} reached before strategy=${strat.name} -> stop\n`);
      break;
    }
    process.stderr.write(`[scan] strategy=${strat.name} start\n`);
    let discovery;
    try {
      discovery = await discoverBingNews(companyHint, { ...strat.opts, lang: "de" });
    } catch (err) {
      process.stderr.write(`[scan] strategy=${strat.name} discover-error ${err.message}\n`);
      continue;
    }
    process.stderr.write(
      `[scan] strategy=${strat.name} candidates=${discovery.total} concurrency=${concurrency}\n`,
    );

    await runPool(
      discovery.candidates,
      concurrency,
      (candidate) => processCandidate(candidate, strat.name),
      shouldAbort,
    );

    if (shouldAbort()) {
      process.stderr.write(`[scan] hitCount=${hitCount} -> stop\n`);
      break;
    }
  }

  // Kontakte matchen (Konzept Kap. 7 "HubSpot-Abgleich").
  let contactMatches = [];
  if (dbEnabled) {
    try {
      contactMatches = await lookupHubspotContacts(companyHint);
      process.stderr.write(`[scan] contact-matches=${contactMatches.length}\n`);
    } catch (err) {
      process.stderr.write(`[scan] contact-lookup-error ${err.message}\n`);
    }
  }

  const summary = {
    company_hint: companyHint,
    strategies: strategies.map((s) => s.name),
    total_hits: hitCount,
    contact_matches: contactMatches,
    hits: runs
      .filter((r) => r.result && !r.result.extraction.no_signal_found)
      .map((r) => ({
        strategy: r.strategy,
        url: r.resolved_url,
        title: r.candidate?.title,
        source: r.candidate?.source,
        published_at: r.candidate?.published_at,
        case_priority: r.result.opportunity_case.case_priority,
        case_class: r.result.opportunity_case.case_class,
        top_signal: r.result.signals[0]?.signal_id ?? null,
      })),
    runs,
  };
  console.log(JSON.stringify(summary, null, 2));
}

async function lookupHubspotContacts(companyHint) {
  const pool = await getPool();
  const hint = companyHint.trim();
  const core = hint
    .replace(/\b(GmbH|AG|SE|KG|KGaA|Co\.?\s*KG|Holding|Group|Werke)\b\.?/gi, "")
    .replace(/\s+&\s+/g, " ")
    .trim();
  const like = core.length >= 3 ? `%${core}%` : `%${hint}%`;
  const res = await pool.query(
    `SELECT first_name, last_name, email, phone, owner, company_name, last_activity, lead_status
     FROM hubspot_contacts
     WHERE lower(company_name) LIKE lower($1) OR lower(company_name) = lower($2)
     ORDER BY last_activity DESC NULLS LAST, id ASC
     LIMIT 25`,
    [like, hint],
  );
  return res.rows;
}

async function cmdRun({ positional, flags }) {
  const [url, ...rest] = positional;
  const companyHint = rest.join(" ").trim();
  if (!url || !companyHint) throw new Error("run: <url> <company>");
  const out = await runPipeline({ url, companyHint });
  if (shouldPersist(flags)) {
    try {
      const persisted = await persistPipelineResult({
        url,
        companyHint,
        discoveredVia: "manual",
        result: out,
      });
      out.persisted = persisted;
      process.stderr.write(
        `[run] db-ok case=${persisted.case_id} signals=${out.signals.length}\n`,
      );
    } catch (dbErr) {
      process.stderr.write(`[run] db-error ${dbErr.message}\n`);
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

async function cmdScanBatch({ flags }) {
  const limitCompanies = flags["limit-companies"] ? Number(flags["limit-companies"]) : 0;
  const perCompany = flags["per-company"] ? Number(flags["per-company"]) : 1;
  const mode = flags.mode === "broad" ? "broad" : "focused";
  const onlyIfStale = flags["only-stale"] ? Number(flags["only-stale"]) : null;
  const concurrency = Math.max(1, Math.min(20, Number(flags.concurrency ?? 5)));

  if (!shouldPersist(flags)) {
    throw new Error("DATABASE_URL noetig fuer scan-batch.");
  }

  const pool = await getPool();
  const where = ["active = true"];
  const params = [];
  if (onlyIfStale !== null) {
    params.push(onlyIfStale);
    where.push(`(last_scanned_at IS NULL OR last_scanned_at < now() - ($${params.length} || ' hours')::interval)`);
  }
  const limitSql = limitCompanies > 0 ? `LIMIT ${limitCompanies}` : "";
  const listRes = await pool.query(
    `SELECT id, name, contact_count
     FROM target_companies
     WHERE ${where.join(" AND ")}
     ORDER BY contact_count DESC, name ASC
     ${limitSql}`,
    params,
  );
  const targets = listRes.rows;
  const total = targets.length;
  process.stderr.write(
    `[batch] start total=${total} per_company=${perCompany} mode=${mode} concurrency=${concurrency}\n`,
  );

  const taxonomy = await loadTaxonomy();
  let processed = 0;
  let hits = 0;
  let persisted = 0;
  let errors = 0;

  async function processTarget(target) {
    const companyHint = target.name;
    const contactCount = Number(target.contact_count) || 0;
    const fit = fitFromCount(contactCount, true);
    const companyContext = {
      account_fit: fit.account_fit,
      actionability: fit.actionability,
      contact_count: contactCount,
      is_target: true,
      matched_name: target.name,
    };
    try {
      const discovery = await discoverBingNews(companyHint, { mode, limit: perCompany, lang: "de" });
      for (const candidate of discovery.candidates) {
        const targetUrl = candidate.url;
        try {
          const out = await runPipeline({ url: targetUrl, companyHint, taxonomy, companyContext });
          if (!out.extraction.no_signal_found) hits += 1;
          try {
            await persistPipelineResult({
              url: targetUrl,
              companyHint,
              discoveredVia: "bing-news",
              candidate,
              resolveMethod: "bing-direct",
              result: out,
            });
            persisted += 1;
          } catch (dbErr) {
            errors += 1;
            process.stderr.write(`[batch] db-error ${dbErr.message}\n`);
          }
        } catch (pipeErr) {
          errors += 1;
          process.stderr.write(`[batch] pipe-error ${pipeErr.message}\n`);
        }
      }
      await pool.query(
        `UPDATE target_companies SET last_scanned_at = now() WHERE id = $1`,
        [target.id],
      );
    } catch (err) {
      errors += 1;
      process.stderr.write(`[batch] company-error ${err.message}\n`);
    }
    processed += 1;
    process.stderr.write(
      `[batch] progress=${processed}/${total} company="${companyHint}"\n`,
    );
    process.stderr.write(
      `[batch] stats processed=${processed} persisted=${persisted} hits=${hits} errors=${errors}\n`,
    );
  }

  await runPool(targets, concurrency, processTarget);

  process.stderr.write(
    `[batch] done total=${total} persisted=${persisted} hits=${hits} errors=${errors}\n`,
  );
}

async function runPool(items, concurrency, workerFn, shouldAbort) {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      if (shouldAbort && shouldAbort()) return;
      const i = idx++;
      await workerFn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

function fitFromCount(count, isTarget) {
  const c = Number(count) || 0;
  if (!isTarget) return { account_fit: 20, actionability: 15 };
  if (c === 0) return { account_fit: 40, actionability: 25 };
  if (c <= 2) return { account_fit: 60, actionability: 50 };
  if (c <= 5) return { account_fit: 75, actionability: 70 };
  return { account_fit: 90, actionability: 85 };
}

function shouldPersist(flags) {
  if (flags && flags["no-db"]) return false;
  if (!process.env.DATABASE_URL) {
    process.stderr.write(
      "[db] DATABASE_URL nicht gesetzt - ueberspringe Neon-Persistenz.\n",
    );
    return false;
  }
  return true;
}

function usage() {
  console.error(
    [
      "Verwendung:",
      "  node --env-file=.env src/index.js run <url> <company> [--no-db]",
      "  node --env-file=.env src/index.js discover <company> [--mode=focused|broad] [--limit=30]",
      "  node --env-file=.env src/index.js scan <company> [--limit=8] [--concurrency=4] [--hit-target=2] [--max-age-months=12] [--no-db]",
      "  node --env-file=.env src/index.js scan-batch [--limit-companies=N] [--per-company=1] [--mode=focused|broad] [--concurrency=5] [--only-stale=H]",
    ].join("\n"),
  );
}

async function main() {
  const [, , sub, ...rest] = process.argv;
  if (!sub) {
    usage();
    process.exit(1);
  }
  const { flags, positional } = parseFlags(rest);

  try {
    switch (sub) {
      case "run":
        await cmdRun({ positional, flags });
        break;
      case "discover":
        await cmdDiscover({ positional, flags });
        break;
      case "scan":
        await cmdScan({ positional, flags });
        break;
      case "scan-batch":
        await cmdScanBatch({ flags });
        break;
      default:
        if (/^https?:\/\//i.test(sub)) {
          await cmdRun({ positional: [sub, ...positional], flags });
        } else {
          usage();
          process.exit(1);
        }
    }
  } catch (err) {
    console.error(`Fehler: ${err.message}`);
    process.exit(1);
  } finally {
    await closePool();
  }
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main();
}
