// Persistenz-Layer: schreibt Pipeline-Ergebnisse in Neon-Postgres.
//
// Schema: db/schema.sql (companies -> sources -> opportunity_cases -> signals).
// Ein Fall pro Source-URL: erneutes Scannen derselben URL aktualisiert Case+Signals.

import pg from "pg";

let poolPromise = null;

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL ist nicht gesetzt. Siehe .env.");
  }
  if (!poolPromise) {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
    });
    poolPromise = Promise.resolve(pool);
  }
  return poolPromise;
}

export async function closePool() {
  if (!poolPromise) return;
  const pool = await poolPromise;
  poolPromise = null;
  await pool.end();
}

function toTimestamp(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function deriveCaseTitle(result) {
  // Konzept Kap. 4: Case-Titel als kompakte Bedarfshypothese.
  const company = result.extraction?.company_name ?? "Unbekannt";
  const top = result.signals?.[0];
  if (!top) return `${company} - keine Vakanzhypothese`;
  const roleLabel = top.affected_function || labelForSignal(top.signal_id);
  const status =
    top.event_status === "confirmed" ? "bestaetigt"
    : top.event_status === "reported" ? "gemeldet"
    : top.event_status === "rumored"  ? "unbestaetigt"
    : "Hypothese";
  return `${company} - ${roleLabel} (${status})`;
}

function labelForSignal(id) {
  switch (id) {
    case "C_LEVEL_DEPARTURE": return "Konkreter Besetzungsanlass";
    case "PE_TRANSACTION":    return "Eigentuemerwechsel / PE";
    case "RESTRUCTURING":     return "Restrukturierung";
    default: return id;
  }
}

/**
 * @param {object} input
 * @param {string} input.url                - aufgeloeste Publisher-URL (dedupe key)
 * @param {string} input.companyHint        - urspruenglicher Firmen-Hint
 * @param {"manual"|"bing-news"} input.discoveredVia
 * @param {object} input.result             - Rueckgabe von runPipeline
 * @param {object} [input.candidate]        - Bing-News-Kandidat (bei scan)
 * @param {string} [input.resolveMethod]    - z.B. "bing-direct"
 * @returns {Promise<{case_id:number, company_id:number, source_id:number}>}
 */
export async function persistPipelineResult(input) {
  const { url, companyHint, discoveredVia, result, candidate, resolveMethod } = input;
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const companyName = (result.extraction.company_name || companyHint).trim();
    const companyRes = await client.query(
      `INSERT INTO companies (name)
       VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [companyName],
    );
    const companyId = companyRes.rows[0].id;

    const sourceRes = await client.query(
      `INSERT INTO sources (
         url, title, publisher, discovered_via, google_news_url, resolve_method,
         publication_date, published_at, fetched_at, char_count, language, source_quality
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (url) DO UPDATE SET
         title            = COALESCE(EXCLUDED.title, sources.title),
         publisher        = COALESCE(EXCLUDED.publisher, sources.publisher),
         discovered_via   = EXCLUDED.discovered_via,
         google_news_url  = COALESCE(EXCLUDED.google_news_url, sources.google_news_url),
         resolve_method   = COALESCE(EXCLUDED.resolve_method, sources.resolve_method),
         publication_date = COALESCE(EXCLUDED.publication_date, sources.publication_date),
         published_at     = COALESCE(EXCLUDED.published_at, sources.published_at),
         fetched_at       = EXCLUDED.fetched_at,
         char_count       = EXCLUDED.char_count,
         language         = COALESCE(EXCLUDED.language, sources.language),
         source_quality   = COALESCE(EXCLUDED.source_quality, sources.source_quality)
       RETURNING id`,
      [
        url,
        candidate?.title ?? null,
        candidate?.source ?? null,
        discoveredVia,
        candidate?.url ?? null,
        resolveMethod ?? null,
        result.extraction.publication_date ?? null,
        toTimestamp(candidate?.published_at),
        result.meta.fetched_at,
        result.meta.source_char_count ?? null,
        result.extraction.language ?? null,
        result.extraction.source_quality ?? null,
      ],
    );
    const sourceId = sourceRes.rows[0].id;

    const caseScore = result.opportunity_case;
    const usage = result.meta.llm_usage ?? {};
    const caseRes = await client.query(
      `INSERT INTO opportunity_cases (
         company_id, source_id, company_hint,
         case_priority, case_class, supporting_signals, bonus_applied,
         no_signal_found, summary,
         model, llm_prompt_tokens, llm_completion_tokens, llm_total_tokens,
         account_fit, actionability, case_title, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
       ON CONFLICT (source_id) DO UPDATE SET
         company_id            = EXCLUDED.company_id,
         company_hint          = EXCLUDED.company_hint,
         case_priority         = EXCLUDED.case_priority,
         case_class            = EXCLUDED.case_class,
         supporting_signals    = EXCLUDED.supporting_signals,
         bonus_applied         = EXCLUDED.bonus_applied,
         no_signal_found       = EXCLUDED.no_signal_found,
         summary               = EXCLUDED.summary,
         model                 = EXCLUDED.model,
         llm_prompt_tokens     = EXCLUDED.llm_prompt_tokens,
         llm_completion_tokens = EXCLUDED.llm_completion_tokens,
         llm_total_tokens      = EXCLUDED.llm_total_tokens,
         account_fit           = EXCLUDED.account_fit,
         actionability         = EXCLUDED.actionability,
         case_title            = COALESCE(opportunity_cases.case_title, EXCLUDED.case_title),
         updated_at            = now()
       RETURNING id`,
      [
        companyId,
        sourceId,
        companyHint,
        caseScore.case_priority ?? 0,
        caseScore.case_class ?? "Archiv",
        caseScore.supporting_signals ?? 0,
        caseScore.bonus_applied ?? 0,
        Boolean(result.extraction.no_signal_found),
        result.extraction.summary ?? null,
        result.meta.model ?? null,
        usage.prompt_tokens ?? null,
        usage.completion_tokens ?? null,
        usage.total_tokens ?? null,
        result.meta.account_fit ?? null,
        result.meta.actionability ?? null,
        deriveCaseTitle(result) ?? null,
      ],
    );
    const caseId = caseRes.rows[0].id;

    await client.query(`DELETE FROM signals WHERE case_id = $1`, [caseId]);

    for (const sig of result.signals) {
      const dims = sig.scoring?.dimensions ?? {};
      await client.query(
        `INSERT INTO signals (
           case_id, signal_id, subtype, affected_function, affected_person,
           event_date, event_status, evidence_quote,
           signal_strength, confidence, urgency,
           search_relevance, recommended_action,
           likely_search_window, reasoning, counter_arguments,
           priority_score, priority_class,
           dim_signal_strength, dim_account_fit, dim_actionability, dim_confidence, dim_recency,
           missing_dimensions
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
         )`,
        [
          caseId,
          sig.signal_id,
          sig.subtype ?? null,
          sig.affected_function ?? null,
          sig.affected_person ?? null,
          sig.event_date ?? null,
          sig.event_status,
          sig.evidence_quote,
          sig.signal_strength,
          sig.confidence,
          sig.urgency,
          sig.search_relevance ?? null,
          sig.recommended_action ?? null,
          sig.likely_search_window ?? null,
          sig.reasoning ?? null,
          sig.counter_arguments ?? null,
          sig.scoring?.priority_score ?? 0,
          sig.scoring?.priority_class ?? "Archiv",
          dims.signal_strength ?? null,
          dims.account_fit ?? null,
          dims.actionability ?? null,
          dims.confidence ?? null,
          dims.recency ?? null,
          sig.scoring?.missing_dimensions ?? [],
        ],
      );
    }

    await client.query("COMMIT");
    return { case_id: caseId, company_id: companyId, source_id: sourceId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
