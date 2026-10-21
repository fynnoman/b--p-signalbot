# Signal-Historie — technische Spezifikation

Stand: 2026-10-21 · Scope: Dashboard-UI + API, keine Pipeline-Änderung

## Ziel

Jeder „heiße Fall" soll in der Partner-Review auditierbar sein: welche Artikel
haben zu dieser Einschätzung geführt, mit welcher Quelle, welchem Datum und
welchem Score. Aktuell zeigt die UI pro Firma nur den jeweils letzten/höchsten
Case; die darunterliegenden Artikel sind in der DB, aber nicht sichtbar.

## Datenmodell — bereits vorhanden

Das Schema trägt die Historie bereits von selbst:

- `sources`    — 1 Zeile pro Artikel-URL (`url` UNIQUE, `publisher`, `published_at`, `title`)
- `opportunity_cases` — 1 Zeile pro Artikel (`UNIQUE (source_id)`), eigener `case_priority`, `case_class`, `summary`, `created_at`
- `signals`    — N Zeilen pro Case mit `signal_id`, `evidence_quote`, `priority_score`, `confidence`, `event_date`

Ergebnis: ein Firmenname → beliebig viele Cases → je ein Artikel → je N
Signale. Es muss keine Spalte, keine Tabelle und kein Index ergänzt werden.

## API

**Neu:** `GET /api/companies/:name/history`

Liefert alle Cases dieser Firma, chronologisch absteigend, mit Source + Top-Signal.

Response:

```json
{
  "company": "Continental AG",
  "cases": [
    {
      "case_id": 142,
      "case_priority": 82,
      "case_class": "Hot",
      "created_at": "2026-10-20T08:14:00Z",
      "summary": "CFO Schmidt tritt zum Jahresende zurück ...",
      "source": {
        "url": "https://handelsblatt.com/...",
        "title": "Conti sucht neuen Finanzchef",
        "publisher": "handelsblatt.com",
        "published_at": "2026-10-19T06:00:00Z"
      },
      "top_signal": {
        "signal_id": "C_LEVEL_DEPARTURE",
        "affected_function": "CFO",
        "priority_score": 82,
        "confidence": 85,
        "evidence_quote": "Finanzvorstand Schmidt verlässt das Unternehmen ..."
      }
    }
  ]
}
```

**Optionale Query-Parameter**
- `signal_type=C_LEVEL_DEPARTURE` → nur Cases, deren Top-Signal diesen Typ hat
- `since=2026-01-01` → nur `created_at` ab Datum
- `limit=50` (Default) · `offset=0`

## SQL

Reine Erweiterung von `fetchCases` mit `oc.company_id` als Filter + Nested
Signal-Daten statt nur `signal_id`. Alle benötigten Indizes bestehen bereits
(`idx_cases_company`, `idx_signals_case`, `idx_signals_priority`).

## UI

**Neue Komponente** `CompanyHistoryTimeline` in `Dashboard.tsx`, eingebettet
in den Firmen-Dossier-Drawer (rechte Seite) und ggf. im Case-Detail.

Darstellung: vertikale Timeline (reuses `.timeline` + `.timeline-node` aus
`globals.css`), ein Node pro Artikel:

```
●─── 20.10.2026 · Handelsblatt
     Conti sucht neuen Finanzchef                     [Hot · 82]
     Top-Signal: CFO-Wechsel · Confidence 85
     „Finanzvorstand Schmidt verlässt das Unternehmen ..."
     [Quelle öffnen ↗]
●─── 05.10.2026 · Manager Magazin
     Finanzvorstand soll gehen                        [Warm · 61]
     ...
```

- Score-Chip in der bestehenden `.chip-hot/.chip-warm/...` Farbgebung
- Evidenzzitat ausklappbar, standardmäßig 2 Zeilen
- Direktlink `Quelle öffnen` auf `source.url` (öffnet in neuem Tab)
- Filter oben: Dropdown mit Signal-Typen (Alle · C-Level · PE · Restrukturierung)

**Empty State** wenn `cases.length === 0`:
„Noch keine Artikel zu dieser Firma gescannt."

## Edge Cases

| Fall                                   | Verhalten                                       |
|----------------------------------------|-------------------------------------------------|
| Case ohne Signal (`no_signal_found`)   | Node in grau, Label „kein verwertbares Signal"  |
| Mehrfach-Scan derselben URL            | DB dedupliziert via `UNIQUE (source_id)` — 1 Node |
| Case gelöscht                          | kaskadiert via `ON DELETE CASCADE` auf signals  |
| Firma hat >50 Cases                    | Pagination über `offset`, UI: „Weitere laden"   |
| Firma heißt im CRM anders als im Case  | Join über `oc.company_hint` als Fallback-Filter |

## Aufwand (Schätzung)

- API-Route + Query: ~1 h
- UI-Komponente + Drawer-Integration: ~2-3 h
- Signal-Typ-Filter + Pagination: ~1 h
- Tests + Review: ~1 h

**Gesamt: ~5-6 h.** Keine Migrationen, keine Pipeline-Änderung.

## Nicht-Ziele (Phase 2)

- Signale ohne Quelle (manuell eingetragen) — gibt es im aktuellen Modell nicht
- Signal-Fusion über mehrere Artikel in einen „Super-Case" — bricht das aktuelle `UNIQUE (source_id)` auf, deutlich größerer Umbau
- Cross-Company-Historie (ganzer Signal-Katalog für alle Firmen) — eigener Report
