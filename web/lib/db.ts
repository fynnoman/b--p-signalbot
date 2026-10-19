import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL fehlt (../env pflegen via `neon env pull`).");
  }
  if (!global.__pgPool) {
    global.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
    });
  }
  return global.__pgPool;
}

export type CaseClass = "Hot" | "Warm" | "Watchlist" | "Archiv";

export type CaseRow = {
  case_id: number;
  company: string;
  company_hint: string;
  case_class: CaseClass;
  case_priority: number;
  supporting_signals: number;
  no_signal_found: boolean;
  summary: string | null;
  model: string | null;
  created_at: string;
  source_url: string;
  source_title: string | null;
  source_publisher: string | null;
  source_published_at: string | null;
  source_fetched_at: string;
  discovered_via: string;
  top_signal_id: string | null;
  top_signal_subtype: string | null;
  status: string;
  assigned_to: string | null;
  next_review_at: string | null;
  case_title: string | null;
  account_fit: number | null;
  actionability: number | null;
};

export type SignalRow = {
  id: number;
  case_id: number;
  signal_id: string;
  subtype: string | null;
  affected_function: string | null;
  affected_person: string | null;
  event_date: string | null;
  event_status: string;
  evidence_quote: string;
  signal_strength: number;
  confidence: number;
  urgency: number;
  search_relevance: number | null;
  recommended_action: string | null;
  likely_search_window: string | null;
  reasoning: string | null;
  counter_arguments: string | null;
  priority_score: number;
  priority_class: string;
};

export async function fetchCases(opts: {
  caseClass?: CaseClass | "all";
  company?: string;
  limit?: number;
} = {}): Promise<CaseRow[]> {
  const pool = getPool();
  const params: unknown[] = [];
  const where: string[] = [];

  if (opts.caseClass && opts.caseClass !== "all") {
    params.push(opts.caseClass);
    where.push(`oc.case_class = $${params.length}`);
  }
  if (opts.company && opts.company.trim().length > 0) {
    params.push(`%${opts.company.trim()}%`);
    where.push(`(c.name ILIKE $${params.length} OR oc.company_hint ILIKE $${params.length})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);

  const sql = `
    SELECT
      oc.id                                  AS case_id,
      c.name                                 AS company,
      oc.company_hint                        AS company_hint,
      oc.case_class                          AS case_class,
      oc.case_priority                       AS case_priority,
      oc.supporting_signals                  AS supporting_signals,
      oc.no_signal_found                     AS no_signal_found,
      oc.summary                             AS summary,
      oc.model                               AS model,
      oc.created_at                          AS created_at,
      s.url                                  AS source_url,
      s.title                                AS source_title,
      s.publisher                            AS source_publisher,
      s.published_at                         AS source_published_at,
      s.fetched_at                           AS source_fetched_at,
      s.discovered_via                       AS discovered_via,
      top.signal_id                          AS top_signal_id,
      top.subtype                            AS top_signal_subtype,
      oc.status                              AS status,
      oc.assigned_to                         AS assigned_to,
      oc.next_review_at                      AS next_review_at,
      oc.case_title                          AS case_title,
      oc.account_fit                         AS account_fit,
      oc.actionability                       AS actionability
    FROM opportunity_cases oc
    JOIN companies c ON c.id = oc.company_id
    JOIN sources   s ON s.id = oc.source_id
    LEFT JOIN LATERAL (
      SELECT sg.signal_id, sg.subtype
      FROM signals sg
      WHERE sg.case_id = oc.id
      ORDER BY sg.priority_score DESC
      LIMIT 1
    ) top ON true
    ${whereSql}
    ORDER BY oc.case_priority DESC, oc.created_at DESC
    LIMIT ${limit}
  `;

  const res = await pool.query<CaseRow>(sql, params);
  return res.rows;
}

export async function fetchSignalsForCase(caseId: number): Promise<SignalRow[]> {
  const pool = getPool();
  const res = await pool.query<SignalRow>(
    `SELECT
       id, case_id, signal_id, subtype, affected_function, affected_person,
       event_date, event_status, evidence_quote,
       signal_strength, confidence, urgency,
       search_relevance, recommended_action,
       likely_search_window, reasoning, counter_arguments,
       priority_score, priority_class
     FROM signals
     WHERE case_id = $1
     ORDER BY priority_score DESC, id ASC`,
    [caseId],
  );
  return res.rows;
}

export type StatsRow = {
  companies: number;
  sources: number;
  cases: number;
  signals: number;
  hot: number;
  warm: number;
  watchlist: number;
  archiv: number;
};

export { CASE_STATUSES } from "./case-status";
export type { CaseStatus } from "./case-status";

export type EmergingCompanyRow = {
  company_id: number;
  company: string;
  cases: number;
  max_priority: number;
  avg_priority: number;
  hot: number;
  warm: number;
  watchlist: number;
  archiv: number;
  distinct_signal_types: number;
  emerging_score: number;
  signal_ids: string[];
  last_case_at: string;
  account_fit: number | null;
  actionability: number | null;
  contact_count: number | null;
};

export async function fetchEmergingCompanies(): Promise<EmergingCompanyRow[]> {
  const pool = getPool();
  const res = await pool.query<EmergingCompanyRow>(`
    WITH agg AS (
      SELECT
        c.id                                                     AS company_id,
        c.name                                                   AS company,
        COUNT(*)::int                                            AS cases,
        MAX(oc.case_priority)::int                               AS max_priority,
        AVG(oc.case_priority)::float                             AS avg_priority,
        SUM(CASE WHEN oc.case_class = 'Hot'       THEN 1 ELSE 0 END)::int AS hot,
        SUM(CASE WHEN oc.case_class = 'Warm'      THEN 1 ELSE 0 END)::int AS warm,
        SUM(CASE WHEN oc.case_class = 'Watchlist' THEN 1 ELSE 0 END)::int AS watchlist,
        SUM(CASE WHEN oc.case_class = 'Archiv'    THEN 1 ELSE 0 END)::int AS archiv,
        (
          SELECT COUNT(DISTINCT s.signal_id)
          FROM signals s
          JOIN opportunity_cases oc2 ON oc2.id = s.case_id
          WHERE oc2.company_id = c.id
        )::int                                                   AS distinct_signal_types,
        (
          SELECT COALESCE(array_agg(DISTINCT s.signal_id), '{}')
          FROM signals s
          JOIN opportunity_cases oc3 ON oc3.id = s.case_id
          WHERE oc3.company_id = c.id
        )                                                        AS signal_ids,
        MAX(oc.created_at)                                       AS last_case_at,
        MAX(oc.account_fit)::int                                 AS account_fit,
        MAX(oc.actionability)::int                               AS actionability
      FROM opportunity_cases oc
      JOIN companies c ON c.id = oc.company_id
      WHERE oc.no_signal_found = false
      GROUP BY c.id, c.name
    )
    SELECT
      agg.*,
      tc.contact_count,
      -- Emerging Score: max_priority + Bonus fuer Anzahl Cases + Bonus fuer Signal-Vielfalt.
      LEAST(100,
        agg.max_priority
        + LEAST(15, (agg.cases - 1) * 5)
        + LEAST(10, (agg.distinct_signal_types - 1) * 5)
      )::int AS emerging_score
    FROM agg
    LEFT JOIN target_companies tc ON lower(tc.name) = lower(agg.company)
    WHERE agg.cases >= 1
    ORDER BY
      (
        agg.max_priority
        + LEAST(15, (agg.cases - 1) * 5)
        + LEAST(10, (agg.distinct_signal_types - 1) * 5)
      ) DESC,
      agg.cases DESC,
      agg.last_case_at DESC
    LIMIT 200
  `);
  return res.rows;
}

export type ContactRow = {
  id: number;
  hubspot_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  owner: string | null;
  lead_status: string | null;
  marketing_status: string | null;
  last_activity: string | null;
  created_at: string | null;
};

export async function fetchContacts(opts: {
  query?: string;
  company?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: ContactRow[]; total: number }> {
  const pool = getPool();
  const conds: string[] = [];
  const params: unknown[] = [];
  const q = (opts.query ?? "").trim();
  if (q) {
    params.push(`%${q}%`);
    conds.push(`(
      lower(first_name)   LIKE lower($${params.length})
      OR lower(last_name)  LIKE lower($${params.length})
      OR lower(email)      LIKE lower($${params.length})
      OR lower(company_name) LIKE lower($${params.length})
      OR lower(owner)      LIKE lower($${params.length})
    )`);
  }
  const company = (opts.company ?? "").trim();
  if (company) {
    params.push(`%${company}%`);
    conds.push(`lower(company_name) LIKE lower($${params.length})`);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const [rowsRes, countRes] = await Promise.all([
    pool.query<ContactRow>(
      `SELECT id, hubspot_id, first_name, last_name, email, phone,
              company_name, owner, lead_status, marketing_status,
              last_activity, created_at
       FROM hubspot_contacts
       ${where}
       ORDER BY last_activity DESC NULLS LAST, id ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM hubspot_contacts ${where}`,
      params,
    ),
  ]);
  return { rows: rowsRes.rows, total: countRes.rows[0].n };
}

export async function lookupContactsForCompany(companyHint: string): Promise<ContactRow[]> {
  const pool = getPool();
  const hint = companyHint.trim();
  if (!hint) return [];
  const core = hint
    .replace(/\b(GmbH|AG|SE|KG|KGaA|Co\.?\s*KG|Holding|Group|Werke)\b\.?/gi, "")
    .replace(/\s+&\s+/g, " ")
    .trim();
  const like = core.length >= 3 ? `%${core}%` : `%${hint}%`;
  const res = await pool.query<ContactRow>(
    `SELECT id, hubspot_id, first_name, last_name, email, phone,
            company_name, owner, lead_status, marketing_status,
            last_activity, created_at
     FROM hubspot_contacts
     WHERE lower(company_name) LIKE lower($1) OR lower(company_name) = lower($2)
     ORDER BY last_activity DESC NULLS LAST, id ASC
     LIMIT 25`,
    [like, hint],
  );
  return res.rows;
}

export type UsageRow = {
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  cases_with_llm: number;
  model: string | null;
};

export async function fetchUsage(): Promise<UsageRow[]> {
  const pool = getPool();
  const res = await pool.query<UsageRow>(`
    SELECT
      model,
      COALESCE(SUM(llm_prompt_tokens), 0)::int      AS total_prompt_tokens,
      COALESCE(SUM(llm_completion_tokens), 0)::int  AS total_completion_tokens,
      COALESCE(SUM(llm_total_tokens), 0)::int       AS total_tokens,
      COUNT(*) FILTER (WHERE llm_total_tokens IS NOT NULL)::int AS cases_with_llm
    FROM opportunity_cases
    GROUP BY model
    ORDER BY total_tokens DESC
  `);
  return res.rows;
}

export async function fetchStats(): Promise<StatsRow> {
  const pool = getPool();
  const res = await pool.query<StatsRow>(`
    SELECT
      (SELECT COUNT(*)::int FROM companies)                                       AS companies,
      (SELECT COUNT(*)::int FROM sources)                                         AS sources,
      (SELECT COUNT(*)::int FROM opportunity_cases)                               AS cases,
      (SELECT COUNT(*)::int FROM signals)                                         AS signals,
      (SELECT COUNT(*)::int FROM opportunity_cases WHERE case_class = 'Hot')       AS hot,
      (SELECT COUNT(*)::int FROM opportunity_cases WHERE case_class = 'Warm')      AS warm,
      (SELECT COUNT(*)::int FROM opportunity_cases WHERE case_class = 'Watchlist') AS watchlist,
      (SELECT COUNT(*)::int FROM opportunity_cases WHERE case_class = 'Archiv')    AS archiv
  `);
  return res.rows[0];
}
