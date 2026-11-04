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

Dashboard (`web/`): Next.js 16 / React 19, Login über **Neon Auth (Managed Better
Auth)** mit E-Mail-OTP – nur Adressen auf `@b--p.de` werden akzeptiert. Liest aus
Neon, zeigt Hot / Auffällig / Beobachten + Zielunternehmen + Kampagnen.

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
│   │   ├── (dashboard)/      # Auth-geschützte Views (siehe middleware.ts)
│   │   │   ├── hot/          # Priority >= 70
│   │   │   ├── auffaellig/   # 50..70
│   │   │   ├── beobachten/   # < 50
│   │   │   ├── zielunternehmen/
│   │   │   ├── kontakte/
│   │   │   └── kampagnen/
│   │   ├── auth/sign-in/     # E-Mail-OTP-Login (nur @b--p.de)
│   │   ├── api/
│   │   │   ├── auth/[...path]/ # Neon-Auth-Proxy (Managed Better Auth)
│   │   │   └── …             # REST-Routen (siehe §5)
│   │   └── components/
│   │       ├── Dashboard.tsx # Haupt-Komponente, enthält alle Views
│   │       └── UserMenu.tsx  # Account-Dropdown mit Abmelden
│   ├── lib/
│   │   ├── auth/server.ts    # createNeonAuth(), ALLOWED_EMAIL_DOMAIN (Server)
│   │   ├── auth/client.ts    # createAuthClient(), ALLOWED_EMAIL_DOMAIN (Client)
│   │   ├── db.ts             # pg-Pool, Queries für Dashboard
│   │   ├── hubspot.ts        # HubSpot-API-Client (TS, mirror von src/hubspot/)
│   │   ├── hubspot-sync.ts   # In-Process-Sync inkl. SSE-Streaming
│   │   ├── jobs.ts           # In-Memory-Job-Registry für Streaming-Fortschritt
│   │   ├── case-status.ts
│   │   └── pipeline/         # TS-Spiegel der src/-Pipeline für Scan-UI
│   ├── middleware.ts         # Neon-Auth-Guard + Domain-Allowlist (@b--p.de)
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

Neon-Auth-Login schützt alles außer `/auth/*` und `/api/auth/*` (`middleware.ts`).
Signup ist **nur für E-Mails auf `@b--p.de`** möglich. Flow: Email eingeben →
6-stelliger OTP-Code per Mail → eingeloggt. Serverseitige Allowlist in
`web/middleware.ts` verwirft Sessions mit falscher Domain und redirectet auf
`/auth/sign-in?reason=domain`.

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
  steht noch aus (Vercel ist naheliegend wegen Next.js 16).
- **CLI-Scan**: läuft manuell. Für produktiv-Cron empfehlenswert: GitHub Actions
  oder Vercel Cron auf `/api/scan/all`.
- **Logs**: alle CLI-Progresses nach `stderr`, JSON-Output nach `stdout`.
  Scan-Zeilen sind grep-bar: `[scan] strategy=... candidates=... hitCount=...`.
- **Kosten**: OpenAI-Tokens pro Case in `opportunity_cases.llm_*_tokens`,
  Dashboard-Route `/api/usage` summiert.

---

## 10. Was absichtlich NICHT drin ist

- Kein eigenes User-Management — Neon Auth (Managed Better Auth) macht Login,
  User-Tabelle liegt im `neon_auth`-Schema derselben DB.
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
- **Deployment-Setup** fehlt (Vercel + GitHub + Trusted Domain + Custom SMTP für Neon Auth).
- **HubSpot-Push** fehlt komplett (nur Pull implementiert).
- **Taxonomie auf 3 Signale beschränkt** — Konzept Kap. 2 sieht 7 vor.
- **Scan-Batch nicht gescheduled** — läuft heute nur manuell.
- **Langdock-Migration** (laut Projekt-Ziel) noch nicht gestartet, aktuell direkter OpenAI-Call.

---

## 12. Erste sinnvolle Schritte für den Nachfolger

1. `docs/zugaenge.md` abarbeiten — alle Accounts übernehmen oder neu anlegen.
2. Lokalen Scan auf 1 Firma starten: `node … src/index.js scan "Continental AG" --hit-target=1`.
3. Dashboard lokal starten (`cd web && npm run dev`), unter `/auth/sign-in` mit
   eigener `@b--p.de`-Adresse einloggen (OTP-Code per Mail), Hot-Case anklicken.
4. `docs/backlog.md` lesen, mit b+p die Priorität der offenen Punkte abstimmen.
5. **Vor jeder größeren Pipeline-Änderung**: Neon-Branch anlegen, dort testen,
   dann über `neon branches reset` zurück oder promoten.
