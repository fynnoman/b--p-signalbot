import type { CaseRow, SignalRow, EmergingCompanyRow } from "@/lib/db";

export type UsageTotal = {
  prompt: number;
  completion: number;
  tokens: number;
  cost_usd: number;
  cases: number;
};
export type UsageByModel = {
  model: string | null;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  cases_with_llm: number;
  cost_usd: number | null;
};
export type UsagePayload = { by_model: UsageByModel[]; total: UsageTotal };

export type TabKey = "hot" | "emerging" | "watchlist" | "companies" | "hubspot" | "campaigns";
export type TabGroup = "faelle" | "stamm" | "konfig";

export type TargetsInfo = { total: number; scanned: number; last_scan: string | null };

export type DashboardContextValue = {
  cases: CaseRow[];
  emerging: EmergingCompanyRow[];
  companyFilter: string;
  expanded: Record<number, SignalRow[] | "loading" | undefined>;
  toggleExpand: (id: number) => void;
  patchCase: (id: number, patch: Record<string, unknown>) => void;
  openDossier: (name: string) => void;
  setCampaignCount: (n: number) => void;
  hubspotQuery: string;
  setHubspotQuery: (q: string) => void;
};

export type Campaign = {
  id: number;
  name: string;
  description: string | null;
  kind: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  assigned_to: string | null;
  filter_signal_ids: string[];
  filter_case_class: string[];
  hubspot_list_id: string | null;
  hubspot_campaign_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type HsStatus = {
  token_present: boolean;
  companies: { n: number; last: string | null };
  contacts:  { n: number; last: string | null };
  deals:     { n: number; last: string | null };
  lists:     { n: number; last: string | null };
};

export type HubspotCompanyTypeOption = { label: string; value: string };
export type SyncPhase = "companies" | "contacts";
export type SyncProgressState = {
  phase: SyncPhase | null;
  phaseLabel: string;
  companiesInserted: number;
  companiesSkipped: number;
  contactsInserted: number;
  refreshedTargets: number | null;
  startedAt: number | null;
  elapsedMs: number;
  status: "idle" | "running" | "done" | "error";
  error: string | null;
};

export type SourceRow = {
  id: number;
  url: string;
  title: string | null;
  publisher: string | null;
  published_at: string | null;
  fetched_at: string;
  language: string | null;
  source_quality: number | null;
  discovered_via: string;
  company: string | null;
  case_class: string | null;
  case_priority: number | null;
  case_id: number | null;
  no_signal_found: boolean | null;
};
