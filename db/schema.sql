-- b+p Mandate Radar - Postgres Schema (Neon)
-- Normalisiert: target_companies + companies -> sources -> opportunity_cases -> signals

CREATE TABLE IF NOT EXISTS target_companies (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  contact_count INTEGER NOT NULL DEFAULT 0,
  source_csv    TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  last_scanned_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_target_active_count
  ON target_companies(active, contact_count DESC);

CREATE TABLE IF NOT EXISTS companies (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sources (
  id                 BIGSERIAL PRIMARY KEY,
  url                TEXT NOT NULL UNIQUE,
  title              TEXT,
  publisher          TEXT,
  discovered_via     TEXT NOT NULL DEFAULT 'manual',
  google_news_url    TEXT,
  resolve_method     TEXT,
  publication_date   TEXT,
  published_at       TIMESTAMPTZ,
  fetched_at         TIMESTAMPTZ NOT NULL,
  char_count         INTEGER,
  language           TEXT,
  source_quality     INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunity_cases (
  id                     BIGSERIAL PRIMARY KEY,
  company_id             BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_id              BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  company_hint           TEXT NOT NULL,
  case_priority          INTEGER NOT NULL,
  case_class             TEXT NOT NULL,
  supporting_signals     INTEGER NOT NULL DEFAULT 0,
  bonus_applied          INTEGER NOT NULL DEFAULT 0,
  no_signal_found        BOOLEAN NOT NULL DEFAULT false,
  summary                TEXT,
  model                  TEXT,
  llm_prompt_tokens      INTEGER,
  llm_completion_tokens  INTEGER,
  llm_total_tokens       INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id)
);

CREATE INDEX IF NOT EXISTS idx_cases_company        ON opportunity_cases(company_id);
CREATE INDEX IF NOT EXISTS idx_cases_priority       ON opportunity_cases(case_priority DESC);
CREATE INDEX IF NOT EXISTS idx_cases_class          ON opportunity_cases(case_class);
CREATE INDEX IF NOT EXISTS idx_cases_created_at     ON opportunity_cases(created_at DESC);

CREATE TABLE IF NOT EXISTS signals (
  id                     BIGSERIAL PRIMARY KEY,
  case_id                BIGINT NOT NULL REFERENCES opportunity_cases(id) ON DELETE CASCADE,
  signal_id              TEXT NOT NULL,
  subtype                TEXT,
  affected_function      TEXT,
  affected_person        TEXT,
  event_date             TEXT,
  event_status           TEXT NOT NULL,
  evidence_quote         TEXT NOT NULL,
  signal_strength        INTEGER NOT NULL,
  confidence             INTEGER NOT NULL,
  urgency                INTEGER NOT NULL,
  search_relevance       INTEGER,
  recommended_action     TEXT,
  likely_search_window   TEXT,
  reasoning              TEXT,
  counter_arguments      TEXT,
  priority_score         INTEGER NOT NULL,
  priority_class         TEXT NOT NULL,
  dim_signal_strength    INTEGER,
  dim_account_fit        INTEGER,
  dim_actionability      INTEGER,
  dim_confidence         INTEGER,
  dim_recency            INTEGER,
  missing_dimensions     TEXT[] NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signals_case        ON signals(case_id);
CREATE INDEX IF NOT EXISTS idx_signals_priority    ON signals(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_signals_signal_id   ON signals(signal_id);

-- Idempotente Migration fuer bereits deployte Datenbanken
ALTER TABLE sources ADD COLUMN IF NOT EXISTS source_quality INTEGER;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS search_relevance INTEGER;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS recommended_action TEXT;

ALTER TABLE opportunity_cases ADD COLUMN IF NOT EXISTS account_fit  INTEGER;
ALTER TABLE opportunity_cases ADD COLUMN IF NOT EXISTS actionability INTEGER;
ALTER TABLE opportunity_cases ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'New';
ALTER TABLE opportunity_cases ADD COLUMN IF NOT EXISTS assigned_to   TEXT;
ALTER TABLE opportunity_cases ADD COLUMN IF NOT EXISTS next_review_at TIMESTAMPTZ;
ALTER TABLE opportunity_cases ADD COLUMN IF NOT EXISTS case_title    TEXT;
ALTER TABLE opportunity_cases ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_cases_status ON opportunity_cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_assigned ON opportunity_cases(assigned_to);

-- HubSpot-Kontakte aus dem CSV-Export (Kap. 7 "HubSpot-Abgleich")
CREATE TABLE IF NOT EXISTS hubspot_contacts (
  id            BIGSERIAL PRIMARY KEY,
  hubspot_id    TEXT UNIQUE,
  first_name    TEXT,
  last_name     TEXT,
  email         TEXT,
  phone         TEXT,
  company_name  TEXT,
  owner         TEXT,
  lead_status   TEXT,
  marketing_status TEXT,
  last_activity TIMESTAMPTZ,
  created_at    TIMESTAMPTZ,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_company_lower ON hubspot_contacts(lower(company_name));
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON hubspot_contacts(owner);
CREATE INDEX IF NOT EXISTS idx_contacts_email_lower ON hubspot_contacts(lower(email));

-- Freies Key-Value fuer editierbare Regeln/Einstellungen (Regel-Editor im Dashboard)
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HubSpot-Live-Sync (Private App Token). Spiegelt die relevanten CRM-Objekte
-- in Neon fuer Offline-Analyse und Anreicherung. imported_at = letzter Pull.
CREATE TABLE IF NOT EXISTS hs_companies (
  id                BIGSERIAL PRIMARY KEY,
  hubspot_id        TEXT UNIQUE NOT NULL,
  name              TEXT,
  domain            TEXT,
  typ               TEXT,
  industry          TEXT,
  city              TEXT,
  country           TEXT,
  employees         INTEGER,
  annual_revenue    NUMERIC,
  lifecycle_stage   TEXT,
  owner_id          TEXT,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  raw               JSONB,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hs_companies_typ ON hs_companies(typ);
CREATE INDEX IF NOT EXISTS idx_hs_companies_name_lower ON hs_companies(lower(name));

CREATE TABLE IF NOT EXISTS hs_deals (
  id                BIGSERIAL PRIMARY KEY,
  hubspot_id        TEXT UNIQUE NOT NULL,
  name              TEXT,
  pipeline          TEXT,
  stage             TEXT,
  amount            NUMERIC,
  close_date        TIMESTAMPTZ,
  owner_id          TEXT,
  primary_company_id TEXT,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  raw               JSONB,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hs_deals_company ON hs_deals(primary_company_id);

CREATE TABLE IF NOT EXISTS hs_lists (
  id                BIGSERIAL PRIMARY KEY,
  hubspot_id        TEXT UNIQUE NOT NULL,
  name              TEXT,
  processing_type   TEXT,
  object_type       TEXT,
  size              INTEGER,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  raw               JSONB,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kampagnen: Ansprache-Aktionen fuer priorisierte Cases (Konzept Kap. 8)
CREATE TABLE IF NOT EXISTS campaigns (
  id                 BIGSERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT,
  kind               TEXT NOT NULL DEFAULT 'outreach',
  status             TEXT NOT NULL DEFAULT 'Entwurf',
  start_date         DATE,
  end_date           DATE,
  assigned_to        TEXT,
  filter_signal_ids  TEXT[] NOT NULL DEFAULT '{}',
  filter_case_class  TEXT[] NOT NULL DEFAULT '{}',
  hubspot_list_id    TEXT,
  hubspot_campaign_id TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_assigned ON campaigns(assigned_to);
