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
| `NEON_AUTH_BASE_URL`     | Neon Auth       | automatisch via `neon env pull` | ✅ |
| `NEON_AUTH_JWKS_URL`     | Neon Auth       | automatisch via `neon env pull` | ⚠️ |
| `NEON_AUTH_COOKIE_SECRET`| App-eigen       | **selbst erzeugen** (`openssl rand -base64 32`), nicht 1:1 übernehmen | ✅ |
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

### `NEON_AUTH_BASE_URL` (Pflicht)
- **Zweck**: URL der Managed-Better-Auth-Instanz dieses Branches.
- **Quelle**: Neon-Konsole → Auth, oder automatisch via `neon env pull`.
- **Wert aktuell**: siehe `.env`, Form `https://ep-...neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth`.
- **Rotation**: nicht nötig. Jeder Branch hat eine eigene URL.
- **Nutzung**: `web/lib/auth/server.ts` (Server-SDK), `web/app/api/auth/[...path]/route.ts` (Proxy).

### `NEON_AUTH_JWKS_URL` (optional)
- **Zweck**: Public-Key-Set zum Verifizieren der Neon-Auth-JWTs. Nur relevant, wenn später
  Neon Functions oder externe Clients Tokens prüfen.
- **Rotation**: nicht nötig.

### `NEON_AUTH_COOKIE_SECRET` (Pflicht)
- **Zweck**: Signiert das Session-Cookie der Next-App.
- **Format**: ≥ 32 Zeichen Base64, z. B. `openssl rand -base64 32`.
- **Quelle**: App-eigen. Wird **nicht** von `neon env pull` gezogen.
- **Übergabe**: 🔴 **Nicht 1:1 weitergeben**. Nachfolger erzeugt einen eigenen Secret,
  trägt ihn ein, startet neu. Alte Sessions werden damit invalide – gewollt.
- **Nutzung**: `web/lib/auth/server.ts`.

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

# --- Neon Auth (Managed Better Auth, Dashboard-Login) ---
# NEON_AUTH_BASE_URL und NEON_AUTH_JWKS_URL kommen aus `neon env pull`.
NEON_AUTH_BASE_URL=https://ep-...neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth
NEON_AUTH_JWKS_URL=https://ep-...neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json
# App-eigen, bitte beim Handover neu erzeugen: `openssl rand -base64 32`.
NEON_AUTH_COOKIE_SECRET=change-me-base64-32-bytes-mindestens
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
