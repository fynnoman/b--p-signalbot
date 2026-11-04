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

## 5. Neon Auth (Managed Better Auth, Dashboard-Login)

- **Service**: Teil des Neon-Projekts, keine zweite Konsole.
  Status: `neon neon-auth status`.
- **Login-Flow**: Email + 6-stelliger OTP-Code (passwortlos). Sign-in-Page:
  `/auth/sign-in`. Backend-Proxy: `/api/auth/[...path]`.
- **Domain-Allowlist**: nur E-Mails auf `@b--p.de`.
  - Clientseitig: Sign-in-Page lehnt andere Adressen ab, bevor überhaupt ein OTP
    verschickt wird (`web/lib/auth/client.ts` → `isAllowedEmail`).
  - Serverseitig (Defense-in-Depth): die Middleware verwirft jede Session, deren
    `user.email` nicht auf `@b--p.de` endet, und redirectet auf
    `/auth/sign-in?reason=domain`. Siehe `web/middleware.ts` + `web/lib/auth/server.ts`
    → `isAllowedEmail`. Die Konstante `ALLOWED_EMAIL_DOMAIN` liegt an genau einer Stelle
    pro Side (Client + Server), beim Domain-Wechsel beide anpassen.
- **Benutzerverwaltung**: direkt in der Neon-Konsole oder via CLI:
  - `neon neon-auth user list` – alle Accounts
  - `neon neon-auth user delete <id>` – Account löschen (z. B. ausgeschiedener Mitarbeiter)
- **Shared SMTP**: Verifizierungs-Mails gehen aktuell über `auth@mail.myneon.app`
  (Neon-Shared). Vor echtem Prod-Deployment auf eigenes SMTP umstellen:
  https://neon.com/docs/auth/production-checklist.md
- **Trusted Domains**: Localhost ist per Default erlaubt. Für Prod-Host:
  `neon neon-auth domain add https://<prod-url>`. Danach prüfen:
  `neon neon-auth domain list`.
- **Secrets**: nur `NEON_AUTH_COOKIE_SECRET` ist App-eigen und muss beim
  Handover neu erzeugt werden (`openssl rand -base64 32`). Alle anderen
  `NEON_AUTH_*`-Variablen kommen aus `neon env pull`.
- **Checkliste**:
  - [ ] Nachfolger hat Zugang zur Neon-Org (siehe §2) – Auth läuft über dasselbe Login.
  - [ ] `NEON_AUTH_COOKIE_SECRET` in `.env` neu erzeugt (nicht 1:1 übernommen).
  - [ ] Dev-Login funktioniert: `http://localhost:3000/auth/sign-in` → eigene
        `@b--p.de`-Adresse → Code in Posteingang → eingeloggt.
  - [ ] Negative-Test: Login mit `@gmail.com` zeigt sofort Fehler; selbst wenn
        ein OTP erzwungen wird, redirectet die Middleware auf
        `?reason=domain`.
  - [ ] Für produktives Deployment: Prod-Host als Trusted Domain eingetragen
        und eigenes SMTP konfiguriert.

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
        (frisches `NEON_AUTH_COOKIE_SECRET`, nicht Dev-Secret kopieren)
  - [ ] Prod-Host als Neon-Auth-Trusted-Domain eintragen:
        `neon neon-auth domain add https://<prod-url>`
  - [ ] Custom SMTP für Neon Auth konfigurieren (Shared-SMTP ist nur für Dev)
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
2. Nachfolger erstellt neue Secrets: `NEON_AUTH_COOKIE_SECRET` (eigen),
   `OPENAI_API_KEY`, `HUBSPOT_TOKEN`. Neon-Auth-Base/JWKS-URLs sind Branch-weit
   und kommen automatisch über `neon env pull`.
3. Nachfolger trägt neue Werte in `.env` ein, führt Smoke-Tests aus:
   - `node --env-file=.env src/index.js discover "SAP"` → ok
   - `scripts/hubspot-sync.mjs --only=companies` → ok
   - Dashboard-Login mit eigener `@b--p.de`-Adresse → Code kommt → eingeloggt
   - Negative-Test: `foo@gmail.com` wird im Sign-in-Flow abgelehnt bzw.
     Middleware redirectet auf `?reason=domain`
   - `/hot` lädt, Case anklickbar
4. **Erst dann** alte Tokens revoken:
   - OpenAI: Platform → API Keys → Revoke
   - HubSpot: Private App → Rotate oder Deactivate
   - Neon Auth: alter Cookie-Secret ist mit Rotation automatisch tot (alte
     Sessions laufen aus; nichts weiter zu tun)
5. Alter Owner bleibt 4 Wochen als Member in allen Systemen für Rollback.

---

## 11. Was NICHT übergeben wird

- Persönliche IDE-Konfigurationen, lokale `.vscode/`-Settings
- `node_modules/` (werden neu installiert)
- `.next/` Build-Cache
- Alte CSV-Exports in `/tmp` (siehe Code-Kommentare in `scripts/import-*.mjs`)
