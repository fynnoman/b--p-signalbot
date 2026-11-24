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
