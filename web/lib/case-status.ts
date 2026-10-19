// Konzept Kap. 4: empfohlene Statuslogik fuer Sales Signal / Opportunity Case.
// Diese Datei ist bewusst frei von Server-only-Imports (kein pg),
// damit sie sowohl in Server- als auch in Client-Komponenten verwendbar ist.

export type CaseStatus =
  | "New" | "Research required" | "Watchlist"
  | "Qualified" | "Partner review" | "Contact planned"
  | "Contacted" | "Conversation" | "Mandate potential" | "Deal created"
  | "Won" | "No current need" | "False positive" | "Disqualified";

export const CASE_STATUSES: CaseStatus[] = [
  "New", "Research required", "Watchlist",
  "Qualified", "Partner review", "Contact planned",
  "Contacted", "Conversation", "Mandate potential", "Deal created",
  "Won", "No current need", "False positive", "Disqualified",
];

// Deutsche Anzeige-Labels fuer die Status-Werte aus dem Konzept (Kap. 4).
// DB-Wert bleibt Englisch, damit externe Systeme (HubSpot) kompatibel sind.
export const CASE_STATUS_LABEL_DE: Record<CaseStatus, string> = {
  "New":                "Neu",
  "Research required":  "Recherche nötig",
  "Watchlist":          "Beobachten",
  "Qualified":          "Qualifiziert",
  "Partner review":     "Partner-Prüfung",
  "Contact planned":    "Kontakt geplant",
  "Contacted":          "Kontaktiert",
  "Conversation":       "Gespräch",
  "Mandate potential":  "Mandats-Potenzial",
  "Deal created":       "Deal erstellt",
  "Won":                "Gewonnen",
  "No current need":    "Kein aktueller Bedarf",
  "False positive":     "Fehlalarm",
  "Disqualified":       "Disqualifiziert",
};
