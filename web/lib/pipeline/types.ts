// Gemeinsame Pipeline-Typen.

export type SignalId = "C_LEVEL_DEPARTURE" | "PE_TRANSACTION" | "RESTRUCTURING";
export type EventStatus = "confirmed" | "reported" | "rumored" | "hypothesis";

export type FetchedPage = {
  url: string;
  text: string;
  fetched_at: string;
  char_count: number;
};

export type DetectedSignal = {
  signal_id: SignalId;
  subtype: string;
  affected_function: string | null;
  affected_person: string | null;
  event_date: string | null;
  event_status: EventStatus;
  evidence_quote: string;
  signal_strength: number;
  confidence: number;
  urgency: number;
  search_relevance: number;
  likely_search_window: string;
  reasoning: string;
  counter_arguments: string | null;
  recommended_action: string;
};

export type ExtractionResult = {
  company_name: string;
  language: string;
  publication_date: string | null;
  no_signal_found: boolean;
  summary: string;
  source_quality: number;
  detected_signals: DetectedSignal[];
};

export type ScoringDimensions = {
  signal_strength: number | null;
  account_fit: number | null;
  actionability: number | null;
  confidence: number | null;
  recency: number | null;
};

export type ScoredSignal = DetectedSignal & {
  scoring: {
    priority_score: number;
    priority_class: string;
    dimensions: ScoringDimensions;
    missing_dimensions: string[];
    weights: Record<string, number>;
  };
};

export type OpportunityCaseScore = {
  case_priority: number;
  case_class: string;
  supporting_signals: number;
  bonus_applied?: number;
};

export type CompanyContext = {
  account_fit: number;
  actionability: number;
  contact_count: number;
  is_target: boolean;
  matched_name: string | null;
};

export type PipelineResult = {
  meta: {
    url: string;
    company_hint: string;
    fetched_at: string;
    source_char_count: number;
    model: string;
    llm_usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
    account_fit: number | null;
    actionability: number | null;
    company_context: CompanyContext;
  };
  extraction: {
    company_name: string;
    language: string;
    publication_date: string | null;
    no_signal_found: boolean;
    summary: string;
    source_quality: number;
  };
  signals: ScoredSignal[];
  opportunity_case: OpportunityCaseScore;
};

export type BingCandidate = {
  url: string;
  title: string | null;
  source: string | null;
  published_at: string | null;
  guid: string | null;
};
