# Dateien-Snapshots — letzte bekannte Fassung jeder Projekt-Datei


Für jede der 23 Projekt-Dateien, die ich in den Logs geschrieben habe, die zuletzt gespeicherte Version. Nützlich wenn eine Datei im Repo nicht mehr aktuell ist oder gelöscht wurde.


---

## `.env.example`

1 Writes · 0 Edits · 1 Sessions · letzte Fassung 1611 Zeichen

```bash
# --- Neon Postgres (Pflicht, sobald DB-Persistenz gewollt) ---
# Nach `neon login` + `neon link` + `neon env pull` werden diese automatisch gefuellt.
# Ohne DATABASE_URL laeuft der Bot wie bisher (nur JSON-Output, kein DB-Write).
# DATABASE_URL=postgresql://...-pooler.<region>.aws.neon.tech/neondb?sslmode=require
# DATABASE_URL_UNPOOLED=postgresql://...<region>.aws.neon.tech/neondb?sslmode=require
# NEON_BRANCH=production

# --- OpenAI (Pflicht) ---
# https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-...
# Standardmodell (anpassen fuer z.B. gpt-4.1-mini oder gpt-4o)
OPENAI_MODEL=gpt-4o-mini

# --- HubSpot Private App (Pflicht fuer CRM-Sync) ---
# HubSpot -> Settings -> Integrations -> Private Apps -> Create private app
# Scopes: crm.objects.companies.read, crm.objects.contacts.read,
#         crm.objects.deals.read, crm.lists.read, oauth
# HUBSPOT_TOKEN=pat-eu1-...

# --- Neon Auth (Dashboard-Login via Managed Better Auth) ---
# NEON_AUTH_BASE_URL und NEON_AUTH_JWKS_URL kommen aus `neon env pull`.
# NEON_AUTH_BASE_URL=https://ep-...neonauth.<region>.aws.neon.tech/neondb/auth
# NEON_AUTH_JWKS_URL=https://ep-...neonauth.<region>.aws.neon.tech/neondb/auth/.well-known/jwks.json
# App-eigen, bei jedem neuen Setup frisch erzeugen: `openssl rand -base64 32`
# NEON_AUTH_COOKIE_SECRET=change-me-base64-32-bytes-mindestens

# --- Jina Reader (optional) ---
# Ohne Key nutzbar. Nur setzen bei >1k Scans/Monat (hoeheres Rate-Limit).
# https://jina.ai/reader#pricing
# JINA_API_KEY=jina_...

# --- examples/run-example.js (optional) ---
# EXAMPLE_URL=https://...
# EXAMPLE_COMPANY=Ford-Werke GmbH

```

---

## `HANDOVER.md`

1 Writes · 7 Edits · 2 Sessions · letzte Fassung 15109 Zeichen

```markdown
# b+p Mandate Radar — Handover

Stand: 2026-11-02 · Nachfolge-Übergabe

Dieses Dokument übergibt den Prototyp **b+p Mandate Radar** vollständig an die
nachfolgende Entwicklung. Es ist für einen Entwickler mit Node/Next/Postgres-Hintergrund
geschrieben — Grundlagen werden nicht erklärt, dafür alle Projekt-Besonderheiten.

Begleit-Dokumente:
- `docs/zugaenge.md` — Checkliste aller externen Accounts, was übergeben wird.
- `docs/env-handover.md` — alle `.env`-Variablen, Herkunft, Rotation.
- `docs/backlog.md` — offene Specs, bekannte Lücken, nächste Schritte.
- `docs/signal-historie-spec.md` — bereits geschriebene, noch nicht umgesetzte Spec.

---

## 1. Was das System tut

Executive-Search-Signal-Frueherkennung für die Personalberatung b+p.

Pipeline (`src/`):
1. **Discover** — zu einer Zielfirma Kandidaten-Artikel via Bing News holen
   (`src/discover-bing.js`, mehrere Strategien: broad / focused / Fachmedien-Restriktion).
2. **Fetch** — Artikel-Text via Jina Reader laden (`src/fetch.js`).
3. **Extract** — OpenAI Structured Outputs: 3 Signalgruppen klassifizieren
   (`src/extract.js`, Taxonomie: `data/signal-taxonomy.json`).
    - `C_LEVEL_DEPARTURE` — konkreter Besetzungsanlass
    - `PE_TRANSACTION` — Eigentümerwechsel / PE
    - `RESTRUCTURING` — Insolvenz, Sanierung, Layoff
4. **Score** — Priority-Score pro Signal + Case (`src/score.js`, 5 Dimensionen:
   signal_strength, account_fit, actionability, confidence, recency).
5. **Persist** — alles nach Neon-Postgres (`src/db.js`, Schema: `db/schema.sql`).
6. **HubSpot-Match** — zu jedem Hit die passenden b+p-Kontakte aus `hubspot_contacts`
   anzeigen (Fuzzy-Match auf `company_name`).

Dashboard (`web/`): Next.js 16 / React 19, Clerk-Login, liest aus Neon,
zeigt Hot / Auffällig / Beobachten + Zielunternehmen + Kampagnen.

Zielzustand laut Memory: Umzug der LLM-Calls auf **Langdock**, enge HubSpot-Integration.
Aktueller Stand: OpenAI direkt + HubSpot-Sync bidirektional (Lesen, Live-Pull).

---

## 2. Repo-Layout

```
personalberatung-signals/
├── src/                      # CLI-Pipeline (Node, ESM)
│   ├── index.js              # CLI-Entry: run / discover / scan / scan-batch
│   ├── fetch.js              # Jina Reader-Fetch
│   ├── extract.js            # OpenAI Structured Outputs (Signale)
│   ├── score.js              # Priority-Scoring (5 Dimensionen)
│   ├── discover-bing.js      # Bing News Discovery, 4 Strategien
│   ├── context.js            # Account-Fit aus target_companies + hubspot_contacts
│   ├── db.js                 # pg-Pool + persistPipelineResult()
│   └── hubspot/
│       ├── client.js         # Private-App Token Client
│       └── sync.js           # Pull Companies/Contacts/Deals/Lists -> Neon
├── scripts/
│   ├── import-contacts.mjs   # einmaliger CSV-Import HubSpot-Kontakte
│   ├── import-targets.mjs    # einmaliger CSV-Import target_companies
│   └── hubspot-sync.mjs      # Live-Pull via HubSpot-API (ersetzt CSV langfristig)
├── web/                      # Next.js 16 Dashboard
│   ├── app/
│   │   ├── (dashboard)/      # Clerk-geschützte Views
│   │   │   ├── hot/          # Priority >= 70
│   │   │   ├── auffaellig/   # 50..70
│   │   │   ├── beobachten/   # < 50
│   │   │   ├── zielunternehmen/
│   │   │   ├── kontakte/
│   │   │   └── kampagnen/
│   │   ├── api/              # REST-Routen (siehe §5)
│   │   └── components/Dashboard.tsx   # Haupt-Komponente, enthält alle Views
│   ├── lib/
│   │   ├── db.ts             # pg-Pool, Queries für Dashboard
│   │   ├── hubspot.ts        # HubSpot-API-Client (TS, mirror von src/hubspot/)
│   │   ├── hubspot-sync.ts   # In-Process-Sync inkl. SSE-Streaming
│   │   ├── jobs.ts           # In-Memory-Job-Registry für Streaming-Fortschritt
│   │   ├── case-status.ts
│   │   └── pipeline/         # TS-Spiegel der src/-Pipeline für Scan-UI
│   ├── middleware.ts         # Clerk-Guard, alles außer /sign-in/*  geschützt
│   └── next.config.ts        # lädt ../.env (zentrale Konfig im Repo-Root)
├── db/schema.sql             # komplettes Postgres-Schema (idempotent)
├── data/signal-taxonomy.json # Signal-Definitionen für LLM-Prompt
├── docs/
│   ├── signal-historie-spec.md
│   ├── zugaenge.md
│   ├── env-handover.md
│   └── backlog.md
├── .env                      # Secrets, siehe docs/env-handover.md
├── .env.example
├── .neon                     # neon-cli project binding
└── package.json              # root (CLI); web/package.json ist eigenständig
```

Zwei Node-Projekte in einem Repo:
- Root (`package.json`) — nur CLI-Pipeline, Node 20+, type:module.
- `web/package.json` — Next.js 16, eigene Dependencies.

**Beide greifen auf dieselbe Neon-DB** über die zentrale `.env` im Repo-Root zu
(`web/next.config.ts` lädt `../.env` via dotenv).

---

## 3. Erst-Setup für den Nachfolger

```bash
# 1. Node 20+ (siehe engines in package.json)
node -v   # muss >=20 sein

# 2. Deps installieren (zwei getrennte Projekte)
npm install
cd web && npm install && cd ..

# 3. .env befüllen (siehe docs/env-handover.md)
cp .env.example .env
# dann Werte aus Vault/Übergabe einsetzen

# 4. Schema prüfen (idempotent, mehrfach ausführbar)
psql "$DATABASE_URL" -f db/schema.sql

# 5. CLI testen
node --env-file=.env src/index.js discover "Continental AG"

# 6. Dashboard lokal starten
cd web && npm run dev   # http://localhost:3000
```

---

## 4. CLI-Kommandos

Alle Kommandos liegen in `src/index.js`. Immer mit `--env-file=.env` starten
(auch bei `npm start`).

```bash
# Einzel-URL analysieren
node --env-file=.env src/index.js run "https://..." "Ford-Werke GmbH"
  # Optionen: --no-db

# Kandidaten-URLs für eine Firma listen (keine LLM-Kosten)
node --env-file=.env src/index.js discover "Continental AG"
  # --mode=focused|broad   (default: focused)
  # --limit=30
  # --max-age-months=12

# Discover + Pipeline für eine Firma (bricht nach N Hits ab)
node --env-file=.env src/index.js scan "Continental AG"
  # --limit=8              (Kandidaten pro Strategie)
  # --concurrency=4
  # --hit-target=2         (Abbruch nach N echten Signalen)
  # --max-age-months=12
  # --no-db

# Batch: alle aktiven target_companies durchscannen
node --env-file=.env src/index.js scan-batch
  # --limit-companies=50
  # --per-company=1
  # --mode=focused|broad
  # --only-stale=24        (nur Firmen, die seit N Stunden nicht gescannt wurden)
  # --concurrency=5
```

Scan-Strategien (in dieser Reihenfolge, bricht bei `hit-target` ab):
1. `bing-broad` — allgemeine Suche
2. `bing-focused` — mit Rolle+Kontext-Keywords
3. `bing-trade` — restringiert auf deutsche Fachmedien (`TRADE_SITES_DE`)
4. `bing-broad-old` — Fallback mit 24 Monaten Horizont

---

## 5. HubSpot-Integration

### 5.1 Initial-Import via CSV (einmalig, abgelöst durch Live-Sync)
```bash
node --env-file=.env scripts/import-contacts.mjs "/pfad/export.csv"
node --env-file=.env scripts/import-targets.mjs "/pfad/export.csv"
```
Beide Scripts sind idempotent (`hubspot_id` UNIQUE bzw. `name` UNIQUE).

### 5.2 Live-Pull via Private-App Token
```bash
node --env-file=.env scripts/hubspot-sync.mjs
  # --only=all|companies|contacts|lists|deals
  # --types="Kunde,nicht aktiver Kunde"
```

### 5.3 Live-Pull aus dem Dashboard
`POST /api/hubspot/sync` streamt NDJSON mit Live-Progress.
Dasselbe passiert über den „HubSpot synchronisieren"-Button im Dashboard.

### 5.4 Nötige HubSpot-Scopes (Private App)
```
crm.objects.companies.read
crm.objects.contacts.read
crm.objects.deals.read
crm.lists.read
oauth
```

### 5.5 Datenfluss
```
HubSpot CRM
    │ Pull (sync.js oder /api/hubspot/sync)
    ▼
Neon: hs_companies, hs_contacts, hs_deals, hs_lists, hubspot_contacts
    │ Fuzzy-Match beim Case-Detail (lookupHubspotContacts)
    ▼
Dashboard-Dossier zeigt b+p-Kontakte zu jeder Firma
```

Noch **nicht umgesetzt**: Zurückschreiben in HubSpot (Deals / Lists / Timeline-Events).
Siehe `docs/backlog.md` §PUSH.

---

## 6. Datenbank (Neon)

Projekt: `autumn-dream-90661934` (Org `org-empty-dew-32327116`), Branch `production`
(siehe `.neon`).

Schema vollständig in `db/schema.sql` (idempotent, `CREATE … IF NOT EXISTS`,
`ALTER TABLE … ADD COLUMN IF NOT EXISTS`).

Kerntabellen:
- `target_companies` — kuratierte Zielkunden, `contact_count` steuert `account_fit`.
- `companies` — Lookup-Tabelle für in Artikeln erkannte Firmen.
- `sources` — ein Artikel = eine Zeile, `url` UNIQUE.
- `opportunity_cases` — Case pro Artikel (`source_id` UNIQUE), hat `case_priority`,
  `case_class`, `status`, `assigned_to`, `next_review_at`.
- `signals` — N Signale pro Case mit Scoring-Dimensionen.
- `hubspot_contacts` — b+p-Kontakte für Firmen-Match (CSV-Import).
- `hs_companies` / `hs_contacts` / `hs_deals` / `hs_lists` — Live-Spiegel aus HubSpot.
- `campaigns` — Ansprache-Kampagnen (Entwurf / Aktiv / Pausiert).
- `settings` — freier Key-Value-Store für den Regel-Editor im Dashboard.

Branching-Empfehlung: Für größere Umbauten einen Neon-Branch von `production`
anlegen (`neon branches create --parent production`) und `DATABASE_URL`
temporär umbiegen. Scale-to-Zero ist aktiv, Branches kosten nichts im Idle.

---

## 7. Dashboard (web/)

Clerk-Login schützt alles außer `/sign-in/*` und `/sign-up/*` (`middleware.ts`).

Haupt-Komponente: `web/app/components/Dashboard.tsx` (groß — enthält alle Views
plus Drawer plus Kampagnen-Editor). Code-Split in `types.ts`, `constants.ts`,
`utils.ts`, `context.tsx` ist bereits vollzogen (siehe Commit `b2995f4`).

Views:
- `/hot` — Priority ≥ 70
- `/auffaellig` — 50..70
- `/beobachten` — < 50
- `/zielunternehmen` — target_companies
- `/kontakte` — hubspot_contacts
- `/kampagnen` — campaigns

### 7.1 API-Routen (`web/app/api/*`)

| Route                                     | Methode | Zweck                                      |
|-------------------------------------------|---------|--------------------------------------------|
| `/api/cases`                              | GET     | Liste aller Cases (Dashboard-Hauptquery)   |
| `/api/cases/[id]`                         | GET/PATCH| Einzel-Case, Status/Owner/Review-Datum    |
| `/api/companies`                          | GET     | Firmen-Dossier + verknüpfte Cases          |
| `/api/contacts`                           | GET     | HubSpot-Kontakte-Liste + Suche             |
| `/api/target-companies`                   | GET/POST| Zielfirmen pflegen                         |
| `/api/targets`                            | GET     | Legacy-Alias                               |
| `/api/scan`                               | POST    | Pipeline für eine Firma (SSE-Stream)       |
| `/api/scan/all`                           | POST    | scan-batch im Hintergrund (Job)            |
| `/api/jobs`, `/api/jobs/[id]`             | GET     | In-Memory-Job-Status                       |
| `/api/hubspot/sync`                       | POST    | Live-Pull HubSpot → Neon (NDJSON-Stream)   |
| `/api/hubspot/status`                     | GET     | Letzter Sync + Counts                      |
| `/api/hubspot/company-types`              | GET     | distinct `typ` aus `hs_companies`          |
| `/api/campaigns`, `/api/campaigns/[id]`   | GET/POST/PATCH/DELETE | Kampagnen CRUD           |
| `/api/sources`                            | GET     | Artikel-Quellen                            |
| `/api/emerging`                           | GET     | Firmen ohne target-Status aber mit Cases   |
| `/api/usage`                              | GET     | OpenAI-Token-Verbrauch aus `opportunity_cases` |

Alle Routen haben `runtime = "nodejs"` + `dynamic = "force-dynamic"`.
Pipeline-Routen haben `maxDuration = 300`.

### 7.2 Streaming-Konvention

Scan und HubSpot-Sync streamen **NDJSON** (eine JSON-Zeile pro Fortschritt).
Jobs-Registry (`web/lib/jobs.ts`) ist **In-Memory** — bei Server-Restart gehen
laufende Jobs verloren. Für Produktion: siehe `docs/backlog.md`.

---

## 8. Scoring & Taxonomie

### 8.1 Signale (`data/signal-taxonomy.json`)
Pilot-Scope sind 3 Gruppen:
- `C_LEVEL_DEPARTURE` (base_weight 90)
- `PE_TRANSACTION` (base_weight 70)
- `RESTRUCTURING` (base_weight ?)

Taxonomie-Version steht in `data/signal-taxonomy.json` oben (`version`). Beim
Erweitern: Version hochzählen, Taxonomie wird vom LLM im System-Prompt direkt
mitgegeben, kein Deployment nötig.

### 8.2 Scoring (`src/score.js`)
Priority-Score = gewichtete Summe aus:
1. `signal_strength` (base_weight × subtype-Modifikator)
2. `account_fit` (aus `target_companies.contact_count`, siehe `fitFromCount`)
3. `actionability` (Suchzeitfenster, aktuell/zukünftig besser)
4. `confidence` (vom LLM gemeldet)
5. `recency` (fetched_at vs. event_date)

Case-Score aggregiert die Signale eines Artikels (`aggregateCase`).

### 8.3 Qualitäts-Harte-Regeln (im LLM-Prompt, `src/extract.js`)
- R1 Firmenbezug: evidence_quote muss die Zielfirma namentlich nennen.
- R2 Aktualität: alte Artikel nur mit Hinweis.
- Keine Bewertung ohne Quelle/Datum/Evidenztext/Unsicherheit.

Beim Taxonomie-Edit **nicht** die Harte-Regeln verwässern — die halten die
False-Positive-Rate niedrig.

---

## 9. Betrieb & Monitoring

- **Hosting**: Dashboard aktuell nur lokal (`npm run dev`). Produktiv-Deploy
  steht noch aus (Vercel ist naheliegend wegen Next.js 16 + Clerk).
- **CLI-Scan**: läuft manuell. Für produktiv-Cron empfehlenswert: GitHub Actions
  oder Vercel Cron auf `/api/scan/all`.
- **Logs**: alle CLI-Progresses nach `stderr`, JSON-Output nach `stdout`.
  Scan-Zeilen sind grep-bar: `[scan] strategy=... candidates=... hitCount=...`.
- **Kosten**: OpenAI-Tokens pro Case in `opportunity_cases.llm_*_tokens`,
  Dashboard-Route `/api/usage` summiert.

---

## 10. Was absichtlich NICHT drin ist

- Kein eigenes User-Management — Clerk macht Auth.
- Kein Zurückschreiben nach HubSpot (Deals erzeugen, Lists befüllen).
- Keine E-Mail/Push-Benachrichtigung bei neuem Hot-Case.
- Keine Multi-Tenant-Trennung — alles in einer DB, alles einem b+p-Account.
- Kein Audit-Log (wer hat welchen Case-Status geändert).
- Keine Signal-Historie-UI (Spec liegt in `docs/signal-historie-spec.md`,
  Datenmodell trägt sie bereits).

---

## 11. Bekannte Baustellen

Zusammenfassung — Details in `docs/backlog.md`.

- **Jobs-Registry In-Memory**: bei Server-Restart verliert `/api/jobs` laufende Scans.
- **Signal-Historie-UI** nicht umgesetzt (Spec in `docs/signal-historie-spec.md`).
- **Deployment-Setup** fehlt (Vercel + GitHub + Clerk Prod-Keys).
- **HubSpot-Push** fehlt komplett (nur Pull implementiert).
- **Taxonomie auf 3 Signale beschränkt** — Konzept Kap. 2 sieht 7 vor.
- **Scan-Batch nicht gescheduled** — läuft heute nur manuell.
- **Langdock-Migration** (laut Projekt-Ziel) noch nicht gestartet, aktuell direkter OpenAI-Call.

---

## 12. Erste sinnvolle Schritte für den Nachfolger

1. `docs/zugaenge.md` abarbeiten — alle Accounts übernehmen oder neu anlegen.
2. Lokalen Scan auf 1 Firma starten: `node … src/index.js scan "Continental AG" --hit-target=1`.
3. Dashboard lokal starten, mit Clerk-Login einen Hot-Case anklicken.
4. `docs/backlog.md` lesen, mit b+p die Priorität der offenen Punkte abstimmen.
5. **Vor jeder größeren Pipeline-Änderung**: Neon-Branch anlegen, dort testen,
   dann über `neon branches reset` zurück oder promoten.

```

---

## `SETUP.md`

1 Writes · 0 Edits · 1 Sessions · letzte Fassung 6745 Zeichen

```markdown
# Setup — b+p Mandate Radar

Diese Anleitung ist für den **Nachfolge-Entwickler**. Sie führt von leerem
Rechner zu lauffähigem Dashboard. Keine fremden Secrets, alles wird mit
eigenen Accounts neu angelegt.

Hintergrund & Architektur: siehe `HANDOVER.md`. Was offen ist: `docs/backlog.md`.

---

## 0. Was du brauchst

- Node.js **20+** (`node -v`)
- Postgres-Client (`psql`, nur für den einmaligen Schema-Import)
- Git, ein Terminal
- Zugang zu diesen Diensten (alle neu anlegen, alt wird deaktiviert):
  - **OpenAI** (eigener API-Key)
  - **HubSpot** (b+p lädt dich als Admin ein — Account gehört b+p)
  - **Neon** (eigener Account, eigenes Projekt)

---

## 1. Repo klonen & Deps

```bash
git clone <repo-url> personalberatung-signals
cd personalberatung-signals

npm install
cd web && npm install && cd ..
```

Das Repo hat **zwei** `package.json` (Root = CLI-Pipeline, `web/` = Dashboard).
Beide müssen installiert sein.

---

## 2. Neon-Projekt anlegen (DB + Auth in einem)

1. Auf https://console.neon.tech einen Account anlegen.
2. Neues Projekt erstellen (Region nah an Deutschland, z. B. `eu-central-1`).
3. Neon-CLI installieren und verbinden:
   ```bash
   npm i -g neonctl
   neon login
   neon projects list          # notiere die ProjectId
   neon link                   # verlinkt lokales Repo mit dem Projekt
   neon env pull               # schreibt DATABASE_URL etc. in .env
   ```
4. Neon Auth aktivieren (Managed Better Auth):
   ```bash
   neon neon-auth status
   # falls nicht aktiv:
   neon neon-auth enable
   neon env pull               # pullt zusaetzlich NEON_AUTH_BASE_URL + JWKS_URL
   ```
5. Schema einspielen (idempotent, mehrfach ausführbar):
   ```bash
   psql "$DATABASE_URL_UNPOOLED" -f db/schema.sql
   ```

---

## 3. OpenAI-Key

1. Auf https://platform.openai.com/api-keys einen neuen Key erzeugen,
   Name z. B. `mandate-radar-prod`.
2. In `.env` eintragen als `OPENAI_API_KEY`.
3. Optional: Nutzungs-Limit setzen (Settings → Limits), vermeidet Überraschungen.

Kostenrahmen aktuell: ca. **$0.07 pro Firmen-Scan** mit `gpt-4o-mini`.

---

## 4. HubSpot Private App

1. In HubSpot: Settings → Integrations → Private Apps → **Create private app**.
2. Name: `b+p Mandate Radar`.
3. Scopes setzen:
   - `crm.objects.companies.read`
   - `crm.objects.contacts.read`
   - `crm.objects.deals.read`
   - `crm.lists.read`
   - `oauth`
4. **Create** → Token kopieren (Format `pat-eu1-...`) → in `.env` als
   `HUBSPOT_TOKEN`.

---

## 5. `.env` komplett machen

Kopier die Vorlage und trag alles ein:

```bash
cp .env.example .env
```

Pflicht-Variablen:

```bash
DATABASE_URL=...              # aus neon env pull
DATABASE_URL_UNPOOLED=...     # aus neon env pull
NEON_AUTH_BASE_URL=...        # aus neon env pull
NEON_AUTH_JWKS_URL=...        # aus neon env pull
NEON_AUTH_COOKIE_SECRET=...   # selbst erzeugen: openssl rand -base64 32
OPENAI_API_KEY=sk-...
HUBSPOT_TOKEN=pat-eu1-...
```

Die `.env` liegt im Repo-Root. `web/next.config.ts` lädt sie automatisch,
keine zweite `.env` in `web/` nötig.

---

## 6. Login-Allowlist anpassen

Das Dashboard akzeptiert aktuell **nur** E-Mails auf `@b--p.de`. Ändern an
zwei Stellen, falls deine Mail-Domain abweicht:

- `web/lib/auth/server.ts` → `ALLOWED_EMAIL_DOMAIN`
- `web/lib/auth/client.ts` → `ALLOWED_EMAIL_DOMAIN`

Beide Konstanten müssen identisch sein.

---

## 7. Smoke-Tests

```bash
# 7.1 CLI: Discovery (keine LLM-Kosten, pures Bing-Scraping)
node --env-file=.env src/index.js discover "Continental AG"

# 7.2 CLI: kompletter Scan (1 Hit reicht als Test, ca. 2-3 Cent)
node --env-file=.env src/index.js scan "Continental AG" --hit-target=1

# 7.3 HubSpot-Pull
node --env-file=.env scripts/hubspot-sync.mjs --only=companies

# 7.4 Dashboard
cd web && npm run dev
# http://localhost:3000/auth/sign-in
# Mit deiner (erlaubten) Adresse einloggen -> OTP-Code kommt per Mail
```

Wenn alle vier Schritte grün sind: Setup ist fertig.

---

## 8. Initial-Datenimport (optional, nur bei bestehendem HubSpot-Bestand)

```bash
# Alle Firmen aus HubSpot in die Neon-DB spiegeln
node --env-file=.env scripts/hubspot-sync.mjs --only=all

# Danach erster Full-Scan (dauert je nach Firmenzahl: 1 Firma ~ 30-60s)
node --env-file=.env src/index.js scan-batch --limit-companies=20 --per-company=1
```

---

## 9. Dashboard produktiv deployen (Vercel)

1. Vercel-Projekt anlegen, Repo verknüpfen.
2. **Root Directory** = `web/`.
3. **Build Command** = `next build`.
4. Env-Variablen aus `.env` ins Vercel-Projekt übertragen — `NEON_AUTH_COOKIE_SECRET`
   **frisch erzeugen** (nicht Dev-Secret kopieren).
5. Prod-Host als Trusted Domain bei Neon Auth eintragen:
   ```bash
   neon neon-auth domain add https://<deine-prod-url>
   neon neon-auth domain list   # verifizieren
   ```
6. Custom SMTP für Neon Auth konfigurieren (Postmark / Resend / SendGrid).
   Shared-SMTP von `auth@mail.myneon.app` ist nur für Dev geeignet — siehe
   https://neon.com/docs/auth/production-checklist.

---

## 10. Scheduled Scans (optional, später)

Siehe `docs/backlog.md` §P3. Drei Optionen:
- **GitHub Actions** (einfachster Weg): `cron`-Workflow ruft `src/index.js scan-batch`.
- **Vercel Cron**: POST auf `/api/scan/all` — benötigt zuerst den Umbau der
  Jobs-Registry auf DB-Persistenz (siehe `docs/backlog.md` §P2).
- **Neon Scheduled Function**: läuft neben der DB, kein Hosting-Overhead.

---

## Troubleshooting

**`neon env pull` schreibt nichts in `.env`**  
→ `neon link` noch nicht ausgeführt oder falsches Projekt verlinkt.
Prüfen: `cat .neon` sollte deine aktuelle ProjectId enthalten.

**Dashboard-Login bleibt bei „OTP-Code senden" hängen**  
→ Wahrscheinlich Shared-SMTP-Rate-Limit. Check Neon-Konsole → Auth → Logs.
Für Prod: Custom SMTP konfigurieren (siehe §9).

**Login funktioniert, aber jede geschützte Seite redirectet auf `?reason=domain`**  
→ `ALLOWED_EMAIL_DOMAIN` in `web/lib/auth/{server,client}.ts` passt nicht
zu deiner E-Mail-Domain. Siehe §6.

**`node … scan …` bricht mit `OPENAI_API_KEY missing`**  
→ Entweder `.env` nicht gefunden (immer mit `--env-file=.env` starten) oder
Key hat Tippfehler.

**HubSpot-Sync bricht mit 401**  
→ Private-App-Token abgelaufen oder Scopes unvollständig. Scopes prüfen
(siehe §4), bei Bedarf neuen Token erzeugen.

**Scan läuft, speichert aber nichts**  
→ `DATABASE_URL` fehlt oder zeigt auf falsche DB. Scans ohne DB laufen als
Dry-Run (JSON-Output nach stdout).

---

## Weiterführend

- **Architektur, Datenmodell, API-Routen**: `HANDOVER.md`
- **Was offen ist, was als Nächstes dran ist**: `docs/backlog.md`
- **Welche .env-Variable wofür da ist**: `docs/env-handover.md`
- **Zugangs-Checkliste je Dienst**: `docs/zugaenge.md`
- **Signal-Historie-Feature-Spec (noch nicht umgesetzt)**: `docs/signal-historie-spec.md`

```

---

## `docs/backlog.md`

1 Writes · 2 Edits · 2 Sessions · letzte Fassung 7590 Zeichen

```markdown
# Backlog & Nächste Schritte — b+p Mandate Radar

Stand: 2026-11-02 · Übergabe-Fassung

Dieses Backlog ist bewusst **ehrlich**: fehlende Features, bekannte Risiken,
offene Specs. Priorisierung ist mein Vorschlag — b+p entscheidet.

Legende:
- 🔴 **Blocker für Produktivbetrieb**
- 🟡 **Hoch** — nächster sinnvoller Schritt nach Setup
- 🟢 **Nice-to-have / Second Wave**

---

## 🔴 Blocker für Produktivbetrieb

### P1 — Deployment-Setup des Dashboards
**Status**: Dashboard läuft nur lokal (`npm run dev`).
**Was fehlt**:
- Vercel-Projekt (oder Alternative: Fly.io, Railway)
- Clerk-Prod-Keys (aktuell nur Dev)
- Env-Variablen in Hosting-Konsole hinterlegen (siehe `docs/env-handover.md`)
- Root-Directory `web/`, Build-Command `next build`
- Clerk-Allowlist / Organization-Mode auf b+p-Mail-Domain beschränken

**Aufwand**: 2–4 h  
**Risiko**: Clerk-Prod-Billing beachten; Neon-Pool-Limits bei vielen parallel
Users prüfen.

---

### P2 — Jobs-Registry In-Memory → persistent
**Status**: `web/lib/jobs.ts` hält laufende Scan/Sync-Jobs **im Prozess-RAM**.
Bei Server-Restart (jedes `vercel deploy`!) sind laufende Scans verloren,
die UI zeigt „läuft noch", die Pipeline läuft aber nicht mehr.

**Lösung**:
- Jobs in eine Tabelle `jobs(id, kind, status, progress_jsonb, started_at, …)`.
- Beim API-Request Job-ID zurückgeben, SSE-Stream liest aus DB.
- Alternative wenn man kein Polling will: Vercel Background Functions
  (`waitUntil`), Trigger.dev, oder Inngest.

**Aufwand**: 4–8 h  
**Alternativ-Workaround bis dahin**: Scan-Batch nur per CLI-Cron laufen lassen
(nicht via `/api/scan/all`).

---

### P3 — Scheduler für scan-batch
**Status**: `scan-batch` läuft nur manuell.  
**Was fehlt**: Ein Cron, der 1–4× täglich alle aktiven `target_companies`
scanned.  
**Optionen**:
- **GitHub Actions** `cron` → ruft Node-Script auf einem Runner (einfach, kein
  Timeout-Problem wenn Runner Node 20+ hat).
- **Vercel Cron** → POST auf `/api/scan/all` (benötigt P2 davor, sonst
  Jobs-Registry sinnlos).
- **Neon Scheduled Function** (siehe `neon-functions`-Skill) — läuft am
  nächsten zur DB, kein Vercel-Timeout.

**Aufwand**: 1–3 h abhängig von Option.

---

## 🟡 Hoch — nächster sinnvoller Schritt

### H1 — Signal-Historie-UI umsetzen
**Status**: Spec komplett in `docs/signal-historie-spec.md`. Datenmodell
trägt die Historie bereits (sources ↔ cases ↔ signals), es fehlt nur die
API-Route + UI-Komponente.

**Was zu tun**:
- API-Route: `GET /api/companies/:name/history` (siehe Spec, §API)
- UI-Komponente: `CompanyHistoryTimeline` im Firmen-Dossier-Drawer
- Filter: Signal-Typ-Dropdown
- Keine Schema-Änderung nötig

**Aufwand**: 1 Tag.

---

### H2 — Langdock-Migration (laut b+p-Zielarchitektur)
**Status**: Aktuell `OpenAI` direkt in `src/extract.js` + `web/lib/pipeline/extract.ts`.  
**Ziel**: Alle LLM-Calls über Langdock → zentrales Prompt-Mgmt, Audit, Kosten.

**Was zu tun**:
- Langdock-Workspace-Zugang (siehe `docs/zugaenge.md` §9)
- `src/extract.js` Thin-Wrapper: aktuelle OpenAI-Instance ersetzen durch
  Langdock-OpenAI-kompatible-API (Base-URL + eigener Key).
- Structured-Outputs-Support in Langdock prüfen — falls nicht nativ,
  JSON-Mode + Zod-Validation als Fallback.
- Prompts in Langdock als versionierte Templates ablegen.

**Aufwand**: 1–2 Tage, abhängig vom Langdock-Feature-Set.

---

### H3 — HubSpot-Push (Deals / Lists / Timeline-Events)
**Status**: Nur Pull implementiert, kein Push.  
**Ziel**: Aus einem Hot-Case direkt einen HubSpot-Deal / Timeline-Event anlegen
+ zugehörige Kontakte auf eine Liste schieben.

**Was zu tun**:
- `src/hubspot/client.js` um POST-Methoden erweitern.
- Neue API-Route `POST /api/cases/:id/push-hubspot`.
- Deal-Properties mappen (Case-Priority → Deal-Amount? Case-Class → Pipeline-Stage?).
- Idempotenz: `opportunity_cases.hubspot_deal_id` als neue Spalte, UNIQUE.
- Scopes der Private-App erweitern: `.write` statt `.read`.

**Aufwand**: 2–3 Tage.

---

### H4 — Taxonomie-Erweiterung auf 7 Signale (Konzept Kap. 2)
**Status**: Nur 3 Pilot-Signale aktiv. Konzept sieht 7 vor:
- C-Level-Wechsel ✅
- PE-Transaktion ✅
- Restrukturierung ✅
- Interims-Besetzung (teilweise in C_LEVEL_DEPARTURE)
- Erweiterte Ausschreibung
- Neue Business-Unit / Standort / Markt
- Übernahme / Fusion
- Insolvenz / Liquidation

**Was zu tun**:
- `data/signal-taxonomy.json` erweitern (Version 0.4.0).
- Prompt-Beispiele in `src/extract.js` ergänzen.
- Für jede neue Gruppe `base_weight` + `subtypes` definieren.
- Scoring in `src/score.js` auf Erweiterung testen (keine Code-Änderung
  erwartet, nur Smoke-Tests).

**Aufwand**: 1 Tag + 1 Tag Validierung mit echten Artikeln.

---

### H5 — Alert / Benachrichtigung bei neuem Hot-Case
**Status**: Keine. Hot-Cases sind nur im Dashboard sichtbar.  
**Ziel**: Push an b+p-Owner, wenn ein neuer Case mit `case_priority >= 70`
entsteht.

**Optionen**:
- E-Mail via Resend / SendGrid
- Slack-Webhook in b+p-Workspace
- HubSpot-Task auf den `owner` der Firma

**Aufwand**: 0.5–1 Tag.

---

## 🟢 Nice-to-have / Second Wave

### N1 — Audit-Log für Case-Status-Änderungen
Neue Tabelle `case_events(case_id, kind, old_value, new_value, actor, created_at)`.  
Trigger auf `opportunity_cases.status` / `assigned_to`.  
Wert: Partner-Review nachvollziehbar.

### N2 — Discovery-Alternative zu Bing
Bing-HTML-Scraping ist fragil. Alternativen:
- Serper.dev / SerpAPI (bezahlpflichtig, stabil)
- Google Programmable Search Engine (free tier)
- RSS-Feeds Fachmedien direkt

### N3 — Kampagnen → HubSpot-Liste synchronisieren
Aktuell existiert `campaigns.hubspot_list_id`, aber kein Code der eine Liste
in HubSpot erzeugt oder befüllt. Hängt an H3.

### N4 — Code-Split Dashboard.tsx weiter
`Dashboard.tsx` ist nach dem letzten Commit (`b2995f4`) schon in Types/Constants/
Utils/Context aufgeteilt, aber immer noch groß. Views in eigene Files
auslagern.

### N5 — Scheduled HubSpot-Full-Sync
`scripts/hubspot-sync.mjs` als Cron, 1×/Tag. Hält `hs_companies` /
`hs_contacts` aktuell. Hängt an P3.

### N6 — Statistiken / Dashboard-KPIs
- Hits pro Woche
- Durchschnittliche Case-Priority
- OpenAI-Kosten pro Monat
- Trefferquote pro Discovery-Strategie

Daten liegen alle in Neon, braucht nur eine Analytics-Seite.

### N7 — Konzept „Beobachtungsliste" granular
Aktuell: Case-Status `Observing` ist eine Spalte. Besser: Case ↔ User-Watchlist
M:N — damit mehrere b+p-Partner unterschiedlich beobachten können.

### N8 — Semantische Dedup
Zwei Artikel über dasselbe Ereignis erzeugen 2 Cases. Besser: Embedding
auf `summary`, bei Nähe >0.9 im selben Firmen-Kontext mergen.
Siehe Neon `vector`-Extension.

---

## Risiken (nicht gelöst)

- **R1**: OpenAI-Preisänderung → Kostenschätzung muss neu gemacht werden.
- **R2**: HubSpot-API-Rate-Limits bei großem Account (10 req/s). Current
  Code hat kein Rate-Limiting, nur sequentielle Pages. Bei >1k Companies
  wird's eng.
- **R3**: Bing kann die HTML-Struktur jederzeit ändern → `discover-bing.js`
  bricht. Fix dauert typischerweise 1–3 h.
- **R4**: Jina Reader kann Rate-Limiten → Fetch bricht. Workaround:
  direkte `fetch()` + Readability.js als Fallback.
- **R5**: Clerk-Lock-In — Umzug auf eigenen Auth ist nicht trivial, aber
  mittelfristig günstiger. Entscheidung b+p.

---

## Reihenfolge-Empfehlung (meine)

1. **Woche 1**: `docs/zugaenge.md` abarbeiten, lokal lauffähig machen.
2. **Woche 2**: P1 (Deployment) + P2 (Jobs persistent) parallel.
3. **Woche 3**: P3 (Scheduler) + H1 (Signal-Historie-UI).
4. **Woche 4**: H5 (Alert) + H4 (Taxonomie erweitern).
5. **Monat 2**: H2 (Langdock) + H3 (HubSpot-Push).
6. **Monat 3**: N1–N4 abhängig von Partner-Feedback.

```

---

## `docs/env-handover.md`

1 Writes · 4 Edits · 2 Sessions · letzte Fassung 6408 Zeichen

```markdown
# .env Übergabe-Vorlage — b+p Mandate Radar

Stand: 2026-11-02

Dieses Dokument listet **jede** Umgebungsvariable aus `.env`, wo sie herkommt,
ob sie 1:1 weitergegeben oder neu angelegt werden muss, und wie der Nachfolger
sie rotiert.

Die zentrale `.env` liegt im **Repo-Root**. `web/next.config.ts` lädt sie via
`dotenv` aus `../.env` — es gibt bewusst **keine** zweite `.env` in `web/`
(außer `web/.env.local` für Dashboard-only-Overrides).

---

## Aktuelle Variablen (Stand: `.env` am 2026-11-02)

| Variable                 | Quelle          | Rotation beim Handover | Pflicht |
|--------------------------|-----------------|------------------------|---------|
| `DATABASE_URL`           | Neon (pooled)   | automatisch via `neon env pull` | ✅ |
| `DATABASE_URL_UNPOOLED`  | Neon (direct)   | automatisch via `neon env pull` | ✅ |
| `NEON_BRANCH`            | Neon            | automatisch via `neon env pull` | ⚠️ |
| `OPENAI_API_KEY`         | OpenAI          | **neu erzeugen**, alten revoken | ✅ |
| `HUBSPOT_TOKEN`          | HubSpot Private App | **neu erzeugen oder rotieren** | ✅ |

Legende: ✅ Pflicht · ⚠️ Nice-to-have · ❌ optional.

---

## Variable-für-Variable

### `DATABASE_URL` (Pflicht)
- **Zweck**: Haupt-Verbindung zur Neon-Postgres, Pooled (`-pooler.neon.tech`).
- **Format**: `postgresql://user:pass@ep-...-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`
- **Quelle**: Neon-Konsole → Project `autumn-dream-90661934` → Connection Details.
- **Übergabe**: Nachfolger wird Neon-Member (siehe `docs/zugaenge.md` §2) und
  pullt sich die Werte selbst: `neon env pull`.
- **Rotation**: Nicht nötig, solange Nachfolger separates Neon-Login hat.
  Falls doch — Neon-Konsole → Reset Password der Role.
- **Nutzung**: `src/db.js`, `web/lib/db.ts`.

### `DATABASE_URL_UNPOOLED` (Pflicht)
- **Zweck**: Direkte (nicht gepoolte) Verbindung, nötig für Migrations
  (`psql -f db/schema.sql`) und einige Admin-Queries.
- **Format**: wie oben, ohne `-pooler` im Host.
- **Rotation**: wie `DATABASE_URL`.
- **Nutzung**: `scripts/hubspot-sync.mjs` (optional), manuelle Migrationen.

### `NEON_BRANCH` (optional)
- **Zweck**: nur informativ, zeigt welcher Branch gerade aktiv ist.
- **Wert aktuell**: `production`.
- **Rotation**: nicht nötig.

### `OPENAI_API_KEY` (Pflicht)
- **Zweck**: Structured-Outputs-Calls in `src/extract.js`.
- **Format**: `sk-...`
- **Quelle**: https://platform.openai.com/api-keys
- **Übergabe**: 🔴 **Nicht 1:1 weitergeben**. Nachfolger erzeugt einen eigenen
  Key, trägt ihn ein, testet, dann wird der alte Key revoked.
- **Rotation nach Übergabe**:
  1. Nachfolger: Platform → Create secret key → als `openai-mandate-radar` benennen.
  2. In `.env` eintragen, Test: `node --env-file=.env src/index.js discover "SAP"`.
  3. Alter Key: Platform → Revoke.
- **Nutzung**: `src/extract.js`, `web/lib/pipeline/extract.ts`.

### `OPENAI_MODEL` (optional)
- **Zweck**: überschreibt das Default-Modell.
- **Default**: `gpt-4o-mini` in `src/extract.js`, bzw. aktuell `gpt-4.1-mini`
  im DEFAULT_MODEL-Konstanten. (Sanity-Check beim Setup: welcher Default
  tatsächlich greift, hängt davon ab ob die Variable gesetzt ist.)
- **Wann setzen**: wenn ihr auf `gpt-4o` oder ein neueres Modell umstellt.

### `HUBSPOT_TOKEN` (Pflicht für CRM-Sync)
- **Zweck**: Private-App-Token für HubSpot-Pull.
- **Format**: `pat-eu1-...`
- **Quelle**: HubSpot → Settings → Integrations → Private Apps → App auswählen
  → Auth-Tab → Access Token.
- **Scopes die die App haben muss**:
  - `crm.objects.companies.read`
  - `crm.objects.contacts.read`
  - `crm.objects.deals.read`
  - `crm.lists.read`
  - `oauth`
- **Rotation nach Übergabe**:
  1. In HubSpot → Private App → **Rotate Access Token** (erzeugt neuen Wert,
     alter funktioniert noch 7 Tage).
  2. Nachfolger trägt neuen Wert in `.env` ein.
  3. Test: `node --env-file=.env scripts/hubspot-sync.mjs --only=companies --types=Kunde` (wenige Sekunden Progress-Output).
  4. Nach 7 Tagen prüfen dass alter Token tot ist.
- **Nutzung**: `src/hubspot/client.js`, `web/lib/hubspot.ts`.

### `JINA_API_KEY` (optional)
- **Zweck**: Erhöhtes Rate-Limit beim Artikel-Fetch via Jina Reader.
- **Format**: `jina_...`
- **Quelle**: https://jina.ai/reader (Account → API Keys).
- **Wann nötig**: >1k Scans/Monat; sonst ohne Key weiter.
- **Nutzung**: `src/fetch.js`.

---

## Noch nicht gesetzte, aber bald nötige Variablen

Für produktives Deployment des Dashboards:

### `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Pflicht wenn Clerk aktiv)
- **Zweck**: Clerk-Frontend-Key.
- **Format**: `pk_test_...` (Dev) / `pk_live_...` (Prod)
- **Quelle**: Clerk-Dashboard → API Keys.
- **Nutzung**: Browser via `@clerk/nextjs`.

### `CLERK_SECRET_KEY` (Pflicht wenn Clerk aktiv)
- **Format**: `sk_test_...` / `sk_live_...`
- **Nutzung**: `web/middleware.ts`, Server-APIs.

### `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL` (optional)
- **Default**: `/sign-in`, `/sign-up` — kann meist weggelassen werden.

### Für Langdock-Migration (später)
- `LANGDOCK_API_KEY`
- `LANGDOCK_WORKSPACE_ID`
- `LANGDOCK_MODEL`

Werte liegen in Langdock-Workspace von b+p — siehe `docs/backlog.md` §LANGDOCK.

---

## Konkrete `.env` zum Nachbauen (Template)

Nach dem Handover sieht die `.env` so aus:

```bash
# --- Neon Postgres ---
# Erzeugt via `neon env pull` nach `neon login`.
DATABASE_URL=postgresql://...-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://...eu-central-1.aws.neon.tech/neondb?sslmode=require
NEON_BRANCH=production

# --- OpenAI ---
# Nachfolger-eigener Key, alter revoked.
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# --- HubSpot Private App ---
# Rotiert bei Übergabe.
HUBSPOT_TOKEN=pat-eu1-...

# --- Jina Reader (optional, nur wenn Rate-Limit knapp) ---
# JINA_API_KEY=jina_...

# --- Clerk (nur wenn Dashboard produktiv genutzt wird) ---
# NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
# CLERK_SECRET_KEY=sk_...
```

---

## Secret-Hygiene (Pflicht-Lesen)

- `.env` ist in `.gitignore` — darf nie committed werden.
- Übergabe-Weg für Secrets: **nicht per E-Mail, nicht per Slack**. Entweder
  1Password-Shared-Vault, oder ad-hoc per `op`/`pass`-Verschlüsselung.
- Beim Verlassen eines Mitarbeiters: alle oben markierten Secrets rotieren,
  nicht nur den HubSpot-Token.
- Logs **niemals** `process.env` dumpen — in `src/index.js` wird nur
  `DATABASE_URL` geprüft (Boolean), nicht geloggt.

```

---

## `docs/zugaenge.md`

1 Writes · 3 Edits · 2 Sessions · letzte Fassung 6914 Zeichen

```markdown
# Zugänge-Checkliste — b+p Mandate Radar

Stand: 2026-11-02

Diese Checkliste listet alle externen Accounts/Dienste, die der Nachfolger
braucht, und was dafür übergeben werden muss. Reihenfolge = empfohlene
Reihenfolge beim Onboarding.

Legende:
- 🔑 **Shared Secret** — bestehender Account/Token wird 1:1 weitergegeben.
- 🆕 **Neuer Account/Token** — Nachfolger legt selbst an, alter wird nach
  Übergabe rotiert/revoked.
- 👥 **Member-Einladung** — Nachfolger wird als zusätzliches Mitglied in den
  bestehenden Account eingeladen.

---

## 1. GitHub-Repo

- **Service**: GitHub
- **Was**: Repo `personalberatung-signals` (bzw. aktueller Name)
- **Übergabe**: 👥 Nachfolger als Collaborator/Member mit Write-Access einladen.
- **Nach Übergabe**: alten Owner-Account entweder behalten (Dual-Owner für
  Notfall) oder nach 4 Wochen entfernen.
- **Checkliste**:
  - [ ] Nachfolger in Repo eingeladen
  - [ ] SSH-Key / Personal Access Token des Nachfolgers hat Push-Rechte
  - [ ] Alter Owner-Branch-Protection noch aktiv (`main` / `production`)

---

## 2. Neon (Postgres)

- **Service**: https://console.neon.tech
- **Projekt-ID**: `autumn-dream-90661934`
- **Org**: `org-empty-dew-32327116`
- **Branch**: `production`
- **Übergabe**: 👥 Nachfolger als Team-Member in die Neon-Org einladen
  (Role: Admin, damit `neon branches` + `neon env pull` funktionieren).
- **Secrets** (aus bestehender `.env`): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
  — nach Member-Add bekommt der Nachfolger diese über `neon env pull` selbst.
- **Checkliste**:
  - [ ] Nachfolger per E-Mail in Neon-Org eingeladen
  - [ ] Nachfolger hat `neon` CLI installiert (`npm i -g neonctl`)
  - [ ] `neon login` + `neon env pull` reproduziert die aktuelle `.env`
  - [ ] Nachfolger kann einen Branch anlegen (`neon branches create --parent production --name test-handover`)

---

## 3. OpenAI (LLM)

- **Service**: https://platform.openai.com
- **Übergabe**: 🆕 Nachfolger legt eigenen Account bzw. eigenen Service-Account
  in der b+p-OpenAI-Org an. Alter Key wird **nach erfolgreicher Übergabe
  revoked** (sonst doppelte Abrechnung).
- **Secret**: `OPENAI_API_KEY` (Format `sk-...`), optional `OPENAI_MODEL`
  (Default: `gpt-4o-mini`).
- **Scope**: nur Chat/Completions nötig, kein Fine-Tuning, kein Assistants.
- **Budget**: aktuell ca. ? €/Monat bei normaler Scan-Last (Token-Verbrauch
  siehe Dashboard `/api/usage`).
- **Checkliste**:
  - [ ] Nachfolger hat eigenen OpenAI-Account oder ist in b+p-Org eingeladen
  - [ ] Neuer `OPENAI_API_KEY` erzeugt und in `.env` eingetragen
  - [ ] Testlauf: `node --env-file=.env src/index.js discover "SAP"` → ok
  - [ ] Alter OpenAI-Key revoked

> Mittelfristig soll die LLM-Nutzung auf **Langdock** umgestellt werden
> (b+p-Vorgabe). Bis dahin direkter OpenAI-Call.

---

## 4. HubSpot (CRM)

- **Service**: https://app-eu1.hubspot.com
- **Übergabe**: 👥 Nachfolger als Mitglied in den b+p-HubSpot-Account einladen
  (Role: Admin oder Super-Admin für Private-Apps).
- **Private App**: `b+p Mandate Radar Sync` (Name in HubSpot ggf. prüfen)
  - Scopes: `crm.objects.companies.read`, `crm.objects.contacts.read`,
    `crm.objects.deals.read`, `crm.lists.read`, `oauth`
- **Secret**: `HUBSPOT_TOKEN` (Format `pat-eu1-...`)
- **Übergabe des Tokens**: 🆕 **Nach Mitglieds-Add** erstellt der Nachfolger
  einen eigenen Private-App-Token (oder rotiert den bestehenden) und tauscht
  ihn in `.env` aus. Alten Token revoken.
- **Checkliste**:
  - [ ] Nachfolger in HubSpot-Portal eingeladen
  - [ ] Private App existiert, Scopes stimmen
  - [ ] Neuer `HUBSPOT_TOKEN` in `.env` eingetragen
  - [ ] Test: `curl -H "Authorization: Bearer $HUBSPOT_TOKEN" https://api.hubapi.com/crm/v3/objects/companies?limit=1` liefert 200
  - [ ] Dashboard-Button „HubSpot synchronisieren" läuft fehlerfrei durch

---

## 5. Clerk (Auth für Dashboard)

- **Service**: https://dashboard.clerk.com
- **App**: `b+p Mandate Radar` (Dev + Prod separat)
- **Übergabe**: 👥 Nachfolger als Member in die Clerk-Org einladen (Admin).
- **Secrets** (im Dashboard `web/.env.local` bzw. in der zentralen `.env`):
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `CLERK_SECRET_KEY`
  - (optional) `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- **Zugelassene Nutzer**: b+p-Mitarbeiter per E-Mail in Clerk whitelisten
  (Allowlist in Clerk-Dashboard → Users).
- **Checkliste**:
  - [ ] Nachfolger als Clerk-Org-Admin eingeladen
  - [ ] Clerk-Keys (Dev) sind in `.env` und `web/.env.local` konsistent
  - [ ] Login über `http://localhost:3000/sign-in` funktioniert
  - [ ] Prod-Keys bestehen bereits (falls Deployment schon vorbereitet)

---

## 6. Jina Reader (Artikel-Fetch)

- **Service**: https://jina.ai/reader
- **Übergabe**: Keine. Jina ist ohne API-Key nutzbar (`r.jina.ai/<url>`).
- **Optional**: `JINA_API_KEY` setzen für höhere Rate-Limits.
- **Checkliste**:
  - [ ] Entscheiden ob Pro-Account nötig (bei >1k Scans/Monat ja)

---

## 7. Bing / Microsoft (Discovery)

- **Service**: öffentliche Bing-News-Suche
- **Übergabe**: Keine. `src/discover-bing.js` scrapet die öffentliche HTML-Suche.
- **Risiko**: Microsoft kann Rate-Limits oder HTML-Struktur ändern. Backup-Plan
  siehe `docs/backlog.md` §DISCOVER-ALTERNATIVE.

---

## 8. Vercel (Deploy des Dashboards, falls geplant)

- **Service**: https://vercel.com
- **Status**: Noch kein Produktiv-Deploy. Setup steht aus.
- **Übergabe-Vorbereitung**:
  - [ ] Vercel-Projekt-Owner übergeben (👥 Member) oder neues Projekt
  - [ ] Env-Variablen aus `docs/env-handover.md` in Vercel-Projekt übertragen
  - [ ] Clerk-Prod-Keys verwenden (nicht Dev)
  - [ ] Build-Command: `cd web && next build`
  - [ ] Root-Directory: `web/`
  - [ ] Node-Version: 20+

---

## 9. (Später) Langdock

- **Service**: https://langdock.com (laut Projekt-Memory b+p-strategisches Ziel)
- **Status**: nicht angebunden. Migrations-Pfad siehe `docs/backlog.md`.
- **Vor der Migration**: Nachfolger braucht Langdock-Workspace-Zugang +
  API-Key von b+p.

---

## 10. Rotations-Reihenfolge nach Übergabe

In genau dieser Reihenfolge, damit nichts bricht:

1. Nachfolger in alle Accounts eingeladen (Schritte 1–5).
2. Nachfolger erstellt neue Tokens: OpenAI, HubSpot, (ggf. Clerk-Secrets).
3. Nachfolger trägt neue Werte in `.env` ein, führt Smoke-Tests aus:
   - `node --env-file=.env src/index.js discover "SAP"` → ok
   - `scripts/hubspot-sync.mjs --only=companies` → ok
   - Dashboard `/hot` lädt, Case anklickbar
4. **Erst dann** alte Tokens revoken:
   - OpenAI: Platform → API Keys → Revoke
   - HubSpot: Private App → Rotate oder Deactivate
   - Clerk: Dev-Keys ggf. neu generieren
5. Alter Owner bleibt 4 Wochen als Member in allen Systemen für Rollback.

---

## 11. Was NICHT übergeben wird

- Persönliche IDE-Konfigurationen, lokale `.vscode/`-Settings
- `node_modules/` (werden neu installiert)
- `.next/` Build-Cache
- Alte CSV-Exports in `/tmp` (siehe Code-Kommentare in `scripts/import-*.mjs`)

```

---

## `web/app/api/auth/[...path]/route.ts`

1 Writes · 0 Edits · 1 Sessions · letzte Fassung 108 Zeichen

```typescript
import { auth } from "@/lib/auth/server";

export const { GET, POST, PUT, DELETE, PATCH } = auth.handler();

```

---

## `web/app/api/contacts/by-company/route.ts`

2 Writes · 0 Edits · 1 Sessions · letzte Fassung 1959 Zeichen

```typescript
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampInt(v: string | null, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = clampInt(url.searchParams.get("limit"), 1, 500, 100);
  const offset = clampInt(url.searchParams.get("offset"), 0, 1_000_000, 0);
  const pool = getPool();
  const whereParams: unknown[] = [];
  let where = "WHERE company_name IS NOT NULL AND company_name <> ''";
  if (q) {
    whereParams.push(`%${q}%`);
    where += ` AND lower(company_name) LIKE lower($${whereParams.length})`;
  }
  const pageParams = [...whereParams, limit, offset];
  const limitIdx = pageParams.length - 1;
  const offsetIdx = pageParams.length;
  const res = await pool.query<{
    company_name: string;
    contact_count: number;
    last_activity: string | null;
    is_target: boolean;
  }>(
    `SELECT
       MAX(hc.company_name)      AS company_name,
       COUNT(*)::int             AS contact_count,
       MAX(hc.last_activity)     AS last_activity,
       bool_or(tc.id IS NOT NULL) AS is_target
     FROM hubspot_contacts hc
     LEFT JOIN target_companies tc ON lower(tc.name) = lower(trim(hc.company_name))
     ${where}
     GROUP BY lower(trim(hc.company_name))
     ORDER BY contact_count DESC, company_name ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    pageParams,
  );
  const totalRes = await pool.query<{ n: number }>(
    `SELECT COUNT(DISTINCT company_name)::int AS n
     FROM hubspot_contacts
     ${where}`,
    whereParams,
  );
  return NextResponse.json({ companies: res.rows, total: totalRes.rows[0].n, limit, offset });
}

```

---

## `web/app/api/scan/route.ts`

1 Writes · 0 Edits · 1 Sessions · letzte Fassung 2629 Zeichen

```typescript
import { runSingleScan, type JobMode } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    if (request.headers.get("content-length")) body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const b = body as { company?: unknown; limit?: unknown; mode?: unknown; stream?: unknown };
  const company = typeof b.company === "string" ? b.company : "";
  if (!company.trim()) {
    return new Response(JSON.stringify({ error: "company fehlt" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const limit = typeof b.limit === "number" ? b.limit : 5;
  const mode: JobMode = b.mode === "broad" ? "broad" : "focused";
  const wantsStream = b.stream === true || request.headers.get("accept")?.includes("application/x-ndjson");

  if (!wantsStream) {
    try {
      const job = await runSingleScan({ company, limit, mode });
      return new Response(JSON.stringify(job), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Unbekannter Fehler" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(JSON.stringify({ ...event, t: Date.now() - startedAt }) + "\n"),
        );
      };

      emit({ type: "start", company, limit, mode });

      try {
        const job = await runSingleScan({
          company, limit, mode,
          onEvent: (ev) => emit(ev as unknown as Record<string, unknown>),
        });
        emit({ type: "done", job });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: "error", message: msg });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

```

---

## `web/app/auth/sign-in/page.tsx`

1 Writes · 0 Edits · 1 Sessions · letzte Fassung 6400 Zeichen

```tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ALLOWED_EMAIL_DOMAIN, authClient, isAllowedEmail } from "@/lib/auth/client";

type Phase = "email" | "otp";

function SignInInner() {
  const router = useRouter();
  const params = useSearchParams();
  const reason = params.get("reason");

  const [phase, setPhase] = useState<Phase>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (reason === "domain") {
      setError(`Dieses Portal ist nur für @${ALLOWED_EMAIL_DOMAIN}-Accounts.`);
    }
  }, [reason]);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const normalized = email.trim().toLowerCase();
    if (!isAllowedEmail(normalized)) {
      setError(`Nur E-Mail-Adressen auf @${ALLOWED_EMAIL_DOMAIN} sind erlaubt.`);
      return;
    }
    setBusy(true);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email: normalized,
        type: "sign-in",
      });
      if (error) {
        setError(error.message || "Senden fehlgeschlagen.");
        return;
      }
      setEmail(normalized);
      setPhase("otp");
      setNotice(`Code an ${normalized} gesendet. Gültig 5 Minuten.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error } = await authClient.signIn.emailOtp({
        email,
        otp: otp.trim(),
      });
      if (error) {
        setError(error.message || "Code ungültig.");
        return;
      }
      router.replace("/hot");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
    } finally {
      setBusy(false);
    }
  }

  async function resendOtp() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      if (error) {
        setError(error.message || "Senden fehlgeschlagen.");
      } else {
        setNotice(`Neuer Code an ${email} gesendet.`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm card p-8 space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">b+p Mandate Radar</h1>
          <p className="text-sm text-[color:var(--ink-mute)]">
            Login mit deiner @{ALLOWED_EMAIL_DOMAIN}-Adresse. Es wird ein 6-stelliger Code per E-Mail verschickt.
          </p>
        </header>

        {error && (
          <div className="text-sm rounded-md border border-[color:var(--hot-border)] bg-[color:var(--hot-bg)] text-[color:var(--hot)] px-3 py-2">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="text-sm rounded-md border border-[color:var(--line)] bg-[color:var(--surface-2)] text-[color:var(--ink-2)] px-3 py-2">
            {notice}
          </div>
        )}

        {phase === "email" && (
          <form onSubmit={requestOtp} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                E-Mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`name@${ALLOWED_EMAIL_DOMAIN}`}
                className="input w-full"
                disabled={busy}
              />
            </div>
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? "Senden…" : "Code anfordern"}
            </button>
          </form>
        )}

        {phase === "otp" && (
          <form onSubmit={verifyOtp} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="otp" className="text-sm font-medium">
                6-stelliger Code
              </label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="input w-full tracking-widest text-center text-lg"
                disabled={busy}
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary w-full" disabled={busy || otp.length < 6}>
              {busy ? "Prüfe…" : "Einloggen"}
            </button>
            <div className="flex items-center justify-between text-xs text-[color:var(--ink-mute)]">
              <button
                type="button"
                className="underline underline-offset-2 hover:text-[color:var(--ink-2)]"
                onClick={() => {
                  setPhase("email");
                  setOtp("");
                  setNotice(null);
                  setError(null);
                }}
                disabled={busy}
              >
                Andere E-Mail
              </button>
              <button
                type="button"
                className="underline underline-offset-2 hover:text-[color:var(--ink-2)]"
                onClick={resendOtp}
                disabled={busy}
              >
                Code erneut senden
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}

```

---

## `web/app/components/UserMenu.tsx`

1 Writes · 0 Edits · 1 Sessions · letzte Fassung 3351 Zeichen

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";

export default function UserMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await authClient.getSession();
      if (!cancelled) setEmail(data?.user?.email ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function signOut() {
    setBusy(true);
    try {
      await authClient.signOut();
      router.replace("/auth/sign-in");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const initial = email ? email[0]!.toUpperCase() : "?";

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Konto"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "1px solid var(--line)",
          background: "var(--surface-2)",
          color: "var(--ink)",
          fontSize: 13,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            minWidth: 220,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            zIndex: 50,
          }}
        >
          <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink-mute)" }}>
            {email ?? "…"}
          </div>
          <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              borderRadius: 6,
              background: "transparent",
              border: "none",
              fontSize: 13,
              color: "var(--ink)",
              cursor: busy ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {busy ? "Abmelden…" : "Abmelden"}
          </button>
        </div>
      )}
    </div>
  );
}

```

---

## `web/app/components/dashboard/constants.ts`

1 Writes · 0 Edits · 1 Sessions · letzte Fassung 2876 Zeichen

```typescript
import type { TabKey, TabGroup, SyncProgressState } from "./types";

export const SIGNAL_LABEL: Record<string, string> = {
  C_LEVEL_DEPARTURE: "Konkreter Besetzungsanlass",
  PE_TRANSACTION: "Eigentümerwechsel / PE",
  RESTRUCTURING: "Restrukturierung / Krise",
};

export const TAB_TO_URL: Record<TabKey, string> = {
  hot:         "/hot",
  emerging:    "/auffaellig",
  watchlist:   "/beobachten",
  companies:   "/zielunternehmen",
  hubspot:     "/kontakte",
  campaigns:   "/kampagnen",
};
export const URL_TO_TAB: Record<string, TabKey> = Object.fromEntries(
  Object.entries(TAB_TO_URL).map(([k, v]) => [v, k as TabKey]),
) as Record<string, TabKey>;

export const GROUP_LABEL: Record<TabGroup, string> = {
  faelle: "Fälle",
  stamm:  "Stammdaten",
  konfig: "Konfiguration",
};

export const TABS: { key: TabKey; label: string; hint: string; group: TabGroup }[] = [
  { key: "hot",         label: "Heisse Fälle",      group: "faelle",
    hint: "Priorisierte Fälle mit klarem Anlass. Hier stehen die spannendsten Mandate zuerst." },
  { key: "emerging",    label: "Auffällige Firmen", group: "faelle",
    hint: "Firmen, bei denen mehrere Nachrichten zusammenspielen und ein Muster ergeben." },
  { key: "watchlist",   label: "Beobachten",        group: "faelle",
    hint: "Firmen mit mittleren Signalen. Noch kein heisser Fall, aber lohnt sich im Blick zu behalten." },
  { key: "companies",   label: "Zielunternehmen",   group: "stamm",
    hint: "Die Firmen, die bei jedem Scan durchsucht werden. Hier hinzufügen, deaktivieren oder entfernen." },
  { key: "hubspot",     label: "Kontakte",          group: "stamm",
    hint: "Alle Kontakte aus HubSpot, gruppiert nach Firma. Rohdaten, kein Fall." },
  { key: "campaigns",   label: "Kampagnen",         group: "konfig",
    hint: "Ansprache-Aktionen und Themen-Sprints. Filtern Fälle nach Signal-Typ und Klasse." },
];

export const DATE_TZ = "Europe/Berlin";

export const INITIAL_PROGRESS: SyncProgressState = {
  phase: null, phaseLabel: "",
  companiesInserted: 0, companiesSkipped: 0,
  contactsInserted: 0, refreshedTargets: null,
  startedAt: null, elapsedMs: 0,
  status: "idle", error: null,
};

export const CAMPAIGN_KINDS = [
  { value: "outreach",  label: "Direktansprache" },
  { value: "email",     label: "E-Mail-Kampagne" },
  { value: "event",     label: "Event / Veranstaltung" },
  { value: "content",   label: "Content / Landingpage" },
  { value: "sonstiges", label: "Sonstiges" },
];
export const CAMPAIGN_STATUSES = ["Entwurf", "Aktiv", "Pausiert", "Abgeschlossen", "Abgebrochen"];
export const SIGNAL_OPTIONS = [
  { id: "C_LEVEL_DEPARTURE", label: "Konkreter Besetzungsanlass" },
  { id: "PE_TRANSACTION",    label: "Eigentümerwechsel / PE" },
  { id: "RESTRUCTURING",     label: "Restrukturierung / Krise" },
];
export const CASE_CLASS_OPTIONS = ["Hot", "Warm", "Watchlist", "Archiv"];

```

---

## `web/app/components/dashboard/context.ts`

1 Writes · 0 Edits · 1 Sessions · letzte Fassung 377 Zeichen

```typescript
import { createContext, useContext } from "react";
import type { DashboardContextValue } from "./types";

export const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const v = useContext(DashboardContext);
  if (!v) throw new Error("useDashboard must be used inside <Dashboard>");
  return v;
}

```

---

## `web/app/components/dashboard/types.ts`

1 Writes · 1 Edits · 1 Sessions · letzte Fassung 2483 Zeichen

```typescript
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
  host: string | null;
  kind: string | null;
  active: boolean;
  weight: number;
  notes: string | null;
  last_crawled_at: string | null;
  created_at: string;
};

```

---

## `web/app/components/dashboard/utils.ts`

1 Writes · 2 Edits · 1 Sessions · letzte Fassung 5570 Zeichen

```typescript
import { useEffect, useState } from "react";
import { DATE_TZ, SIGNAL_LABEL } from "./constants";
import type { SyncPhase, SyncProgressState } from "./types";

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function classChip(cls: string) {
  const key = cls.toLowerCase();
  if (key === "hot") return "chip chip-hot";
  if (key === "warm") return "chip chip-warm";
  if (key === "watchlist") return "chip chip-watch";
  return "chip chip-archiv";
}

export function classDotClass(cls: string) {
  const key = cls.toLowerCase();
  if (key === "hot") return "dot-hot";
  if (key === "warm") return "dot-warm-cls";
  if (key === "watchlist") return "dot-watch";
  return "dot-archiv";
}

export function signalKey(id: string | null | undefined): string | null {
  if (!id) return null;
  switch (id) {
    case "C_LEVEL_DEPARTURE": return "clevel";
    case "PE_TRANSACTION": return "pe";
    case "RESTRUCTURING": return "restr";
    default: return null;
  }
}

export function statusBucket(status: string): "new" | "research" | "planning" | "active" | "won" | "dead" {
  const s = (status ?? "").toLowerCase();
  if (s === "new") return "new";
  if (s === "research required" || s === "watchlist" || s === "qualified") return "research";
  if (s === "partner review" || s === "contact planned") return "planning";
  if (s === "contacted" || s === "conversation" || s === "mandate potential" || s === "deal created") return "active";
  if (s === "won") return "won";
  return "dead";
}

export function prettySignal(id: string) { return SIGNAL_LABEL[id] ?? id; }

export function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: DATE_TZ });
}

export function formatDateShort(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: DATE_TZ });
}

export function hostFromUrl(url: string) {
  try { return new URL(url).host.replace(/^www\./, ""); }
  catch { return url; }
}

export function formatDuration(startIso: string, endIso: string | null) {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const diff = Math.max(0, end - start);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = (s % 60).toString().padStart(2, "0");
  return `${m}:${rest} min`;
}

export function formatTimeShort(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: DATE_TZ });
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = (s % 60).toString().padStart(2, "0");
  return `${m}:${rest} min`;
}

export function applyEvent(
  event: Record<string, unknown>,
  setProgress: React.Dispatch<React.SetStateAction<SyncProgressState>>,
) {
  const type = event.type as string | undefined;
  if (type === "phase") {
    setProgress((prev) => ({
      ...prev,
      phase: event.phase as SyncPhase,
      phaseLabel: (event.label as string | undefined) ?? "",
    }));
  } else if (type === "progress") {
    const phase = event.phase as SyncPhase;
    setProgress((prev) => phase === "companies"
      ? { ...prev, phase, companiesInserted: (event.inserted as number) ?? prev.companiesInserted, companiesSkipped: (event.skipped as number) ?? prev.companiesSkipped }
      : { ...prev, phase, contactsInserted: (event.inserted as number) ?? prev.contactsInserted },
    );
  } else if (type === "phase_done") {
    const phase = event.phase as SyncPhase;
    setProgress((prev) => phase === "companies"
      ? { ...prev, companiesInserted: (event.inserted as number) ?? prev.companiesInserted, companiesSkipped: (event.skipped as number) ?? prev.companiesSkipped }
      : { ...prev, contactsInserted: (event.inserted as number) ?? prev.contactsInserted, refreshedTargets: (event.refreshed_targets as number | null | undefined) ?? prev.refreshedTargets },
    );
  } else if (type === "done") {
    setProgress((prev) => ({ ...prev, status: "done", phase: null, phaseLabel: "" }));
  } else if (type === "error") {
    setProgress((prev) => ({ ...prev, status: "error", error: (event.message as string | undefined) ?? "Fehler" }));
  }
}

export function scoreFillClass(cls: string) {
  const key = cls.toLowerCase();
  if (key === "hot") return "fill-hot";
  if (key === "warm") return "fill-warm";
  if (key === "watchlist") return "fill-watch";
  return "fill-archiv";
}

export function timelineToneForClass(cls: string) {
  const key = cls.toLowerCase();
  if (key === "hot") return "tone-hot";
  if (key === "warm") return "tone-warm";
  if (key === "watchlist") return "tone-watch";
  return "tone-archiv";
}

export function filterByCompany<T extends { company: string }>(rows: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => r.company.toLowerCase().includes(needle));
}

```

---

## `web/lib/auth/client.ts`

1 Writes · 0 Edits · 1 Sessions · letzte Fassung 303 Zeichen

```typescript
"use client";

import { createAuthClient } from "@neondatabase/auth/next";

export const authClient = createAuthClient();
export const ALLOWED_EMAIL_DOMAIN = "b--p.de";

export function isAllowedEmail(email: string): boolean {
  return email.toLowerCase().trim().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

```

---

## `web/lib/auth/server.ts`

1 Writes · 0 Edits · 1 Sessions · letzte Fassung 441 Zeichen

```typescript
import { createNeonAuth } from "@neondatabase/auth/next/server";

export const ALLOWED_EMAIL_DOMAIN = "b--p.de";

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
  },
});

```

---

## `web/middleware.ts`

2 Writes · 0 Edits · 1 Sessions · letzte Fassung 1182 Zeichen

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { auth, isAllowedEmail } from "@/lib/auth/server";

const protect = auth.middleware({ loginUrl: "/auth/sign-in" });

export default async function middleware(request: NextRequest) {
  const url = new URL(request.url);
  const isAuthApi = url.pathname.startsWith("/api/auth");
  const isAuthPage = url.pathname.startsWith("/auth/");

  // Session nach Allowlist prüfen (Defense-in-Depth).
  // Nur auf geschützten Pfaden, damit die Sign-In-Seite selbst immer lädt.
  if (!isAuthApi && !isAuthPage) {
    try {
      const { data: session } = await auth.getSession();
      const email = session?.user?.email;
      if (email && !isAllowedEmail(email)) {
        const signInUrl = new URL("/auth/sign-in", request.url);
        signInUrl.searchParams.set("reason", "domain");
        await auth.signOut();
        return NextResponse.redirect(signInUrl);
      }
    } catch {
      // Session-Lookup darf den Request nicht crashen.
    }
  }

  return protect(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};

```