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
