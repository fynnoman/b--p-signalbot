// Pipeline-Entry: URL -> Fetch -> Extract -> Score -> Aggregate.

import { resolveCompanyContext } from "./context";
import { extractSignals, type TaxonomyFile } from "./extract";
import { fetchPageText } from "./fetch";
import { aggregateCase, scoreSignal } from "./score";
import type { CompanyContext, PipelineResult, ScoredSignal } from "./types";
import taxonomyRaw from "./signal-taxonomy.json";

const TAXONOMY = taxonomyRaw as TaxonomyFile;

export async function runPipeline(input: {
  url: string;
  companyHint: string;
  companyContext?: CompanyContext | null;
}): Promise<PipelineResult> {
  const ctx = input.companyContext ?? (await resolveCompanyContext(input.companyHint));
  const fit = ctx.account_fit;
  const act = ctx.actionability;

  const fetched = await fetchPageText(input.url);
  const { model, usage, result } = await extractSignals({
    text: fetched.text,
    url: input.url,
    companyHint: input.companyHint,
    taxonomy: TAXONOMY,
  });

  const scored: ScoredSignal[] = result.detected_signals.map((sig) => ({
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
      url: input.url,
      company_hint: input.companyHint,
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
