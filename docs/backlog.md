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
- Env-Variablen in Hosting-Konsole hinterlegen (siehe `docs/env-handover.md`),
  inkl. frisch erzeugtem `NEON_AUTH_COOKIE_SECRET` (nicht Dev-Secret übernehmen)
- Root-Directory `web/`, Build-Command `next build`
- Prod-Host als Neon-Auth-Trusted-Domain eintragen: `neon neon-auth domain add https://<prod-url>`
- Custom SMTP für Neon Auth konfigurieren (ersetzt Shared-SMTP von `auth@mail.myneon.app`),
  siehe https://neon.com/docs/auth/production-checklist.md
- Domain-Allowlist `ALLOWED_EMAIL_DOMAIN` in `web/lib/auth/{server,client}.ts` prüfen
  (steht aktuell auf `b--p.de`)

**Aufwand**: 2–4 h  
**Risiko**: Neon-Pool-Limits bei vielen parallel Users prüfen; Shared-SMTP hat Rate-Limits.

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
- **R5**: Neon-Auth Shared-SMTP — Verifizierungs-Mails gehen aktuell über
  `auth@mail.myneon.app` und unterliegen Shared-Rate-Limits. Vor Prod-Launch
  muss ein eigenes SMTP (Postmark / Resend / SendGrid) konfiguriert werden,
  sonst sind Login-Mails bei Ausfall des Shared-Providers blockiert.

---

## Reihenfolge-Empfehlung (meine)

1. **Woche 1**: `docs/zugaenge.md` abarbeiten, lokal lauffähig machen.
2. **Woche 2**: P1 (Deployment) + P2 (Jobs persistent) parallel.
3. **Woche 3**: P3 (Scheduler) + H1 (Signal-Historie-UI).
4. **Woche 4**: H5 (Alert) + H4 (Taxonomie erweitern).
5. **Monat 2**: H2 (Langdock) + H3 (HubSpot-Push).
6. **Monat 3**: N1–N4 abhängig von Partner-Feedback.
