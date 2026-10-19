"use client";

import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import type {
  CaseRow, SignalRow, StatsRow, EmergingCompanyRow, ContactRow,
} from "@/lib/db";
import { CASE_STATUSES, CASE_STATUS_LABEL_DE } from "@/lib/case-status";
import type { Job } from "@/lib/jobs";

type UsageTotal = { prompt: number; completion: number; tokens: number; cost_usd: number; cases: number };
type UsageByModel = { model: string | null; total_prompt_tokens: number; total_completion_tokens: number; total_tokens: number; cases_with_llm: number; cost_usd: number | null };
type UsagePayload = { by_model: UsageByModel[]; total: UsageTotal };

const SIGNAL_LABEL: Record<string, string> = {
  C_LEVEL_DEPARTURE: "Konkreter Besetzungsanlass",
  PE_TRANSACTION: "Eigentümerwechsel / PE",
  RESTRUCTURING: "Restrukturierung / Krise",
};

type TabKey = "hot" | "emerging" | "watchlist" | "companies" | "hubspot" | "campaigns";
type TabGroup = "faelle" | "stamm" | "konfig";

const TAB_TO_URL: Record<TabKey, string> = {
  hot:         "/hot",
  emerging:    "/auffaellig",
  watchlist:   "/beobachten",
  companies:   "/zielunternehmen",
  hubspot:     "/kontakte",
  campaigns:   "/kampagnen",
};
const URL_TO_TAB: Record<string, TabKey> = Object.fromEntries(
  Object.entries(TAB_TO_URL).map(([k, v]) => [v, k as TabKey])
) as Record<string, TabKey>;
export { TAB_TO_URL, URL_TO_TAB };
export type { TabKey };
const GROUP_LABEL: Record<TabGroup, string> = {
  faelle: "Fälle",
  stamm:  "Stammdaten",
  konfig: "Konfiguration",
};
const TABS: { key: TabKey; label: string; hint: string; group: TabGroup }[] = [
  { key: "hot",         label: "Heisse Fälle",     group: "faelle",
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

function classChip(cls: string) {
  const key = cls.toLowerCase();
  if (key === "hot") return "chip chip-hot";
  if (key === "warm") return "chip chip-warm";
  if (key === "watchlist") return "chip chip-watch";
  return "chip chip-archiv";
}
function classDotClass(cls: string) {
  const key = cls.toLowerCase();
  if (key === "hot") return "dot-hot";
  if (key === "warm") return "dot-warm-cls";
  if (key === "watchlist") return "dot-watch";
  return "dot-archiv";
}
function signalKey(id: string | null | undefined): string | null {
  if (!id) return null;
  switch (id) {
    case "C_LEVEL_DEPARTURE": return "clevel";
    case "PE_TRANSACTION": return "pe";
    case "RESTRUCTURING": return "restr";
    default: return null;
  }
}
function statusBucket(status: string): "new" | "research" | "planning" | "active" | "won" | "dead" {
  const s = (status ?? "").toLowerCase();
  if (s === "new") return "new";
  if (s === "research required" || s === "watchlist" || s === "qualified") return "research";
  if (s === "partner review" || s === "contact planned") return "planning";
  if (s === "contacted" || s === "conversation" || s === "mandate potential" || s === "deal created") return "active";
  if (s === "won") return "won";
  return "dead";
}
function prettySignal(id: string) { return SIGNAL_LABEL[id] ?? id; }
function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}
function formatDateShort(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function hostFromUrl(url: string) {
  try { return new URL(url).host.replace(/^www\./, ""); }
  catch { return url; }
}

type TargetsInfo = { total: number; scanned: number; last_scan: string | null };

type Props = {
  initialCases: CaseRow[];
  initialStats: StatsRow;
  initialTargets: TargetsInfo;
  initialEmerging: EmergingCompanyRow[];
  children?: React.ReactNode;
};

type DashboardContextValue = {
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

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const v = useContext(DashboardContext);
  if (!v) throw new Error("useDashboard must be used inside <Dashboard>");
  return v;
}

export default function Dashboard({ initialCases, initialStats, initialTargets, initialEmerging, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const tab: TabKey = URL_TO_TAB[pathname] ?? "hot";
  const [cases, setCases] = useState<CaseRow[]>(initialCases);
  const [stats, setStats] = useState<StatsRow>(initialStats);
  const [targets, setTargets] = useState<TargetsInfo>(initialTargets);
  const [emerging, setEmerging] = useState<EmergingCompanyRow[]>(initialEmerging);
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [companyFilter, setCompanyFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<number, SignalRow[] | "loading" | undefined>>({});
  const [showBatch, setShowBatch] = useState(false);
  const [showSingle, setShowSingle] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobContacts, setJobContacts] = useState<ContactRow[] | null>(null);

  // HubSpot-Tab-State
  const [hubspotRows, setHubspotRows] = useState<ContactRow[]>([]);
  const [hubspotTotal, setHubspotTotal] = useState(0);
  const [hubspotQuery, setHubspotQuery] = useState("");
  const [hubspotPage, setHubspotPage] = useState(0);
  const HUBSPOT_PAGE_SIZE = 50;

  const [batchLimit, setBatchLimit] = useState<number | "">("");
  const [batchPer, setBatchPer] = useState(1);
  const [batchConcurrency, setBatchConcurrency] = useState(5);
  const [batchMode, setBatchMode] = useState<"focused" | "broad">("focused");
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  const [singleCompany, setSingleCompany] = useState("");
  const [singleLimit, setSingleLimit] = useState(5);
  const [singleMode, setSingleMode] = useState<"focused" | "broad">("focused");
  const [singleError, setSingleError] = useState<string | null>(null);
  const [singleSubmitting, setSingleSubmitting] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [jobHistory, setJobHistory] = useState<Job[]>([]);

  const reload = useCallback(async () => {
    const [casesRes, targetsRes, emergingRes, usageRes, jobsRes] = await Promise.all([
      fetch(`/api/cases`, { cache: "no-store" }),
      fetch(`/api/targets`, { cache: "no-store" }),
      fetch(`/api/emerging`, { cache: "no-store" }),
      fetch(`/api/usage`, { cache: "no-store" }),
      fetch(`/api/jobs`, { cache: "no-store" }),
    ]);
    if (casesRes.ok) {
      const data = (await casesRes.json()) as { cases: CaseRow[]; stats: StatsRow };
      setCases(data.cases);
      setStats(data.stats);
    }
    if (targetsRes.ok) setTargets(await targetsRes.json());
    if (emergingRes.ok) {
      const data = (await emergingRes.json()) as { companies: EmergingCompanyRow[] };
      setEmerging(data.companies);
    }
    if (usageRes.ok) setUsage(await usageRes.json());
    if (jobsRes.ok) {
      const data = (await jobsRes.json()) as { jobs: Job[] };
      setJobHistory(data.jobs);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/jobs`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { jobs: Job[] };
          setJobHistory(data.jobs);
        }
      } catch {}
    })();
  }, []);

  const loadHubspot = useCallback(async () => {
    const params = new URLSearchParams();
    if (hubspotQuery.trim()) params.set("q", hubspotQuery.trim());
    params.set("limit", String(HUBSPOT_PAGE_SIZE));
    params.set("offset", String(hubspotPage * HUBSPOT_PAGE_SIZE));
    const res = await fetch(`/api/contacts?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { rows: ContactRow[]; total: number };
    setHubspotRows(data.rows);
    setHubspotTotal(data.total);
  }, [hubspotQuery, hubspotPage]);

  useEffect(() => {
    if (tab === "hubspot") loadHubspot();
  }, [tab, loadHubspot]);

  const toggleExpand = useCallback(async (caseId: number) => {
    const already = expanded[caseId];
    if (already) {
      setExpanded((prev) => { const n = { ...prev }; delete n[caseId]; return n; });
      return;
    }
    setExpanded((prev) => ({ ...prev, [caseId]: "loading" }));
    try {
      const res = await fetch(`/api/cases/${caseId}/signals`, { cache: "no-store" });
      const data = (await res.json()) as { signals: SignalRow[] };
      setExpanded((prev) => ({ ...prev, [caseId]: data.signals }));
    } catch {
      setExpanded((prev) => { const n = { ...prev }; delete n[caseId]; return n; });
    }
  }, [expanded]);

  const patchCase = useCallback(async (caseId: number, patch: Record<string, unknown>) => {
    setCases((prev) => prev.map((c) => c.case_id === caseId ? { ...c, ...patch } as CaseRow : c));
    try {
      await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {
      reload();
    }
  }, [reload]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) return;
      const job = (await res.json()) as Job;
      setActiveJob(job);
      if (job.status !== "running") {
        stopPolling();
        await reload();
        // Nach abgeschlossenem Einzel-Scan: HubSpot-Kontakte für die Firma laden.
        if (job.type === "single" && job.company) {
          try {
            const cRes = await fetch(`/api/companies/lookup?name=${encodeURIComponent(job.company)}`);
            if (cRes.ok) {
              const data = (await cRes.json()) as { contacts: ContactRow[] };
              setJobContacts(data.contacts);
            }
          } catch {}
        }
      } else if (job.type === "batch" && job.processed > 0 && job.processed % 5 === 0) reload();
    } catch {}
  }, [stopPolling, reload]);

  const submitBatch = useCallback(async () => {
    setBatchError(null);
    setBatchSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        perCompany: batchPer,
        mode: batchMode,
        concurrency: batchConcurrency,
      };
      if (batchLimit !== "" && Number(batchLimit) > 0) body.limitCompanies = Number(batchLimit);
      const res = await fetch("/api/scan/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setBatchError(err.error ?? `HTTP ${res.status}`);
        return;
      }
      const job = (await res.json()) as Job;
      setActiveJob(job);
      setShowBatch(false);
      stopPolling();
      pollRef.current = setInterval(() => pollJob(job.id), 2000);
      pollJob(job.id);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Fehler beim Start.");
    } finally {
      setBatchSubmitting(false);
    }
  }, [batchLimit, batchPer, batchMode, pollJob, stopPolling]);

  const submitSingle = useCallback(async () => {
    setSingleError(null);
    if (!singleCompany.trim()) { setSingleError("Firmenname fehlt."); return; }
    setSingleSubmitting(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: singleCompany.trim(), limit: singleLimit, mode: singleMode }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setSingleError(err.error ?? `HTTP ${res.status}`);
        return;
      }
      const job = (await res.json()) as Job;
      setActiveJob(job);
      setShowSingle(false);
      setSingleCompany("");
      stopPolling();
      pollRef.current = setInterval(() => pollJob(job.id), 1500);
      pollJob(job.id);
    } catch (err) {
      setSingleError(err instanceof Error ? err.message : "Fehler beim Start.");
    } finally {
      setSingleSubmitting(false);
    }
  }, [singleCompany, singleLimit, singleMode, pollJob, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const belongs = useCallback((c: CaseRow, key: TabKey) => {
    if (key === "hot")       return c.case_class === "Hot" && !c.no_signal_found;
    if (key === "watchlist") return (c.case_class === "Warm" || c.case_class === "Watchlist") && !c.no_signal_found;
    return false;
  }, []);

  const watchlistGroups = useMemo(() => {
    const buckets = new Map<string, CaseRow[]>();
    for (const c of cases) {
      if (!belongs(c, "watchlist")) continue;
      if (!buckets.has(c.company)) buckets.set(c.company, []);
      buckets.get(c.company)!.push(c);
    }
    return Array.from(buckets.entries())
      .map(([company, rows]) => ({
        company,
        rows: rows.sort((a, b) => b.case_priority - a.case_priority),
        max_priority: Math.max(...rows.map((r) => r.case_priority)),
      }))
      .sort((a, b) => b.max_priority - a.max_priority);
  }, [cases, belongs]);

  const [campaignCount, setCampaignCount] = useState(0);

  const tabCounts = useMemo(() => {
    const emergingCount = emerging.filter((r) => r.cases >= 2).length;
    return {
      hot:       cases.filter((c) => belongs(c, "hot")).length,
      emerging:  emergingCount,
      watchlist: watchlistGroups.length,
      companies: targets.total,
      hubspot:   hubspotTotal,
      campaigns: campaignCount,
    } as Record<TabKey, number>;
  }, [cases, emerging, belongs, watchlistGroups, targets.total, hubspotTotal, campaignCount]);

  const [density, setDensity] = useState<"cozy" | "compact">("cozy");

  const recentCases = useMemo(() => {
    return [...cases]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);
  }, [cases]);

  const goToCase = useCallback((c: CaseRow) => {
    if (c.no_signal_found || c.case_class === "Archiv") return;
    const target: TabKey = c.case_class === "Hot" ? "hot" : "watchlist";
    setCompanyFilter(c.company);
    router.push(TAB_TO_URL[target]);
  }, [router]);

  const [dossierCompany, setDossierCompany] = useState<string | null>(null);
  const openDossier = useCallback((name: string) => setDossierCompany(name), []);

  const activeTabMeta = TABS.find((t) => t.key === tab);
  const isFaelleTab = tab === "hot" || tab === "emerging" || tab === "watchlist";

  const ctxValue: DashboardContextValue = useMemo(() => ({
    cases,
    emerging,
    companyFilter,
    expanded,
    toggleExpand,
    patchCase,
    openDossier,
    setCampaignCount,
    hubspotQuery,
    setHubspotQuery,
  }), [cases, emerging, companyFilter, expanded, toggleExpand, patchCase, openDossier, setCampaignCount, hubspotQuery]);

  return (
    <DashboardContext.Provider value={ctxValue}>
    <div className={`app-shell ${density === "compact" ? "dense" : ""}`}>
      <aside className="side-nav">
        <div className="side-brand">
          <div className="mark">b+p</div>
          <div>
            <div className="title">Mandate Radar</div>
            <div className="sub">Executive Search · Früherkennung</div>
          </div>
        </div>

        {(["faelle", "stamm", "konfig"] as TabGroup[]).map((group) => {
          const items = TABS.filter((t) => t.group === group);
          return (
            <div key={group}>
              <div className={`side-group-label grp-${group}`}>{GROUP_LABEL[group]}</div>
              {items.map((t) => (
                <Link
                  key={t.key}
                  href={TAB_TO_URL[t.key]}
                  className={`side-item ${tab === t.key ? "side-item-active" : ""}`}
                  title={t.hint}
                >
                  <span>{t.label}</span>
                  <span className="count">{tabCounts[t.key]}</span>
                </Link>
              ))}
            </div>
          );
        })}

        <div className="side-footer">
          <div className="side-group-label">Letzte Aktivität</div>
          <div className="side-activity">
            {recentCases.length === 0 && (
              <div style={{ color: "var(--ink-mute)", padding: "6px 4px", fontSize: 11 }}>
                Noch keine Fälle vorhanden.
              </div>
            )}
            {recentCases.map((c) => (
              <button
                key={c.case_id}
                className="side-activity-row"
                onClick={() => goToCase(c)}
                title={c.company}
              >
                <span
                  className={classChip(c.case_class)}
                  style={{ padding: "1px 6px", fontSize: 9, letterSpacing: "0.05em" }}
                >
                  {c.case_class.slice(0, 1)}
                </span>
                <span className="cname">{c.company}</span>
                <span className="date">{formatDateShort(c.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div>
        <div className="topbar">
          <div className="searchbar">
            <span className="icon" aria-hidden>&#9906;</span>
            <input
              placeholder="Firma suchen ..."
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setCompanyFilter(""); }}
            />
            {companyFilter && (
              <button
                className="kbd"
                onClick={() => setCompanyFilter("")}
                title="Filter zurücksetzen"
              >
                ESC
              </button>
            )}
          </div>
          <div className="density-toggle" title="Zeilendichte umschalten">
            <button className={density === "cozy" ? "on" : ""} onClick={() => setDensity("cozy")}>
              komfortabel
            </button>
            <button className={density === "compact" ? "on" : ""} onClick={() => setDensity("compact")}>
              kompakt
            </button>
          </div>
          <button className="btn btn-ghost" onClick={reload}>Aktualisieren</button>
          <button className="btn" onClick={() => setShowSingle(true)} title="Eine einzelne Firma manuell prüfen">
            Einzelne Firma
          </button>
          <button className="btn btn-primary" onClick={() => setShowBatch(true)} title="Alle Zielunternehmen der Reihe nach durch die KI schicken">
            Alle Firmen scannen
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
            <UserButton />
          </div>
        </div>

        <main className="content space-y-7">
          {isFaelleTab && (
            <section>
              <div className="eyebrow mb-2">Übersicht</div>
              <div className="kpi-strip">
                <Kpi label="Fälle" value={stats.cases} />
                <Kpi label="Heiss" value={stats.hot} tone="hot" />
                <Kpi label="Warm" value={stats.warm} tone="warm" />
                <Kpi label="Beobachten" value={stats.watchlist} />
                <Kpi label="Quellen" value={stats.sources} onClick={() => setShowSources(true)} />
                <UsageKpi usage={usage} />
              </div>
            </section>
          )}

          {activeJob && (
            <>
              <JobPanel job={activeJob} onDismiss={() => { setActiveJob(null); setJobContacts(null); }} />
              {activeJob.type === "single" && activeJob.status === "done" && jobContacts && (
                <ContactMatchPanel company={activeJob.company ?? ""} contacts={jobContacts} />
              )}
            </>
          )}

          {isFaelleTab && (
            <JobsHistoryPanel
              jobs={jobHistory}
              onOpen={(j) => setActiveJob(j)}
            />
          )}

          <HubspotSyncPanel />

          {isFaelleTab && <HowItWorks />}

          <section className="panel">
            <div className="hintbar">
              <strong>{activeTabMeta?.label}</strong>
              <span>{activeTabMeta?.hint}</span>
            </div>
            {children}
          </section>
        </main>
      </div>

      {showSources && <SourcesModal onClose={() => setShowSources(false)} />}

      {dossierCompany && (
        <CompanyDossier
          company={dossierCompany}
          cases={cases}
          onClose={() => setDossierCompany(null)}
          onJumpToCase={(c) => { setDossierCompany(null); goToCase(c); }}
        />
      )}

      {showBatch && (
        <div className="dialog-backdrop" onClick={() => !batchSubmitting && setShowBatch(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow mb-1">Schritt 2 · Alle Zielunternehmen scannen</div>
            <h2 className="text-base font-semibold mb-1">Alle Firmen scannen</h2>
            <p className="text-xs mb-4" style={{ color: "var(--text-mute)" }}>
              Der Bot geht jede Zielfirma durch, sucht dazu aktuelle Nachrichten in Google News und lässt die KI beurteilen, ob es ein relevantes Signal ist (Führungswechsel, Übernahme, Restrukturierung usw.). Passende Fälle werden gespeichert.
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="eyebrow">
                  Wie viele Firmen? (leer = alle {targets.total.toLocaleString("de-DE")})
                </span>
                <input
                  type="number" min={1} max={10000} placeholder="alle Zielunternehmen"
                  className="input mt-1 w-full"
                  value={batchLimit}
                  onChange={(e) => setBatchLimit(e.target.value === "" ? "" : Number(e.target.value))}
                />
                <span className="block text-[11px] mt-1" style={{ color: "var(--text-mute)" }}>
                  Zum Testen mit kleiner Zahl anfangen, z. B. 10.
                </span>
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="eyebrow">Artikel pro Firma</span>
                  <input type="number" min={1} max={10} className="input mt-1 w-full"
                         value={batchPer} onChange={(e) => setBatchPer(Number(e.target.value) || 1)} />
                  <span className="block text-[11px] mt-1" style={{ color: "var(--text-mute)" }}>
                    Wie viele Nachrichten je Firma geprüft werden.
                  </span>
                </label>
                <label className="block">
                  <span className="eyebrow">Gleichzeitig</span>
                  <input type="number" min={1} max={20} className="input mt-1 w-full"
                         value={batchConcurrency} onChange={(e) => setBatchConcurrency(Number(e.target.value) || 5)} />
                  <span className="block text-[11px] mt-1" style={{ color: "var(--text-mute)" }}>
                    Wie viele Firmen parallel gescannt werden.
                  </span>
                </label>
                <label className="block">
                  <span className="eyebrow">Suchtiefe</span>
                  <select className="select mt-1 w-full" value={batchMode}
                          onChange={(e) => setBatchMode(e.target.value as "focused" | "broad")}>
                    <option value="focused">Präzise (weniger Treffer, mehr Signal)</option>
                    <option value="broad">Breit (mehr Treffer, mehr Rauschen)</option>
                  </select>
                </label>
              </div>
              {batchError && <div className="text-xs" style={{ color: "var(--hot)" }}>{batchError}</div>}
              <div className="text-xs" style={{ color: "var(--text-mute)" }}>
                Grobe Laufzeit: {Math.max(1, Math.round((targets.total * 0.5) / batchConcurrency))} Minuten für alle {targets.total.toLocaleString("de-DE")} Firmen bei {batchConcurrency} gleichzeitig.
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn" disabled={batchSubmitting} onClick={() => setShowBatch(false)}>Abbrechen</button>
              <button className="btn btn-primary" disabled={batchSubmitting} onClick={submitBatch}>
                {batchSubmitting ? (<><span className="spinner" /> Startet ...</>) : "Scan starten"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSingle && (
        <div className="dialog-backdrop" onClick={() => !singleSubmitting && setShowSingle(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow mb-1">Schritt 2 · Einzelne Firma prüfen</div>
            <h2 className="text-base font-semibold mb-1">Einzelne Firma prüfen</h2>
            <p className="text-xs mb-4" style={{ color: "var(--text-mute)" }}>
              Sucht Nachrichten zu einer bestimmten Firma und lässt die KI beurteilen, ob ein Signal vorliegt. Nutzlich für akute Anlässe oder Firmen, die nicht in den Zielunternehmen stehen.
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="eyebrow">Firmenname</span>
                <input autoFocus className="input mt-1 w-full" placeholder="z. B. Continental AG"
                       value={singleCompany} onChange={(e) => setSingleCompany(e.target.value)} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="eyebrow">Artikel pro Firma</span>
                  <input type="number" min={1} max={30} className="input mt-1 w-full"
                         value={singleLimit} onChange={(e) => setSingleLimit(Number(e.target.value) || 5)} />
                  <span className="block text-[11px] mt-1" style={{ color: "var(--text-mute)" }}>
                    Wie viele Nachrichten geprüft werden.
                  </span>
                </label>
                <label className="block">
                  <span className="eyebrow">Suchtiefe</span>
                  <select className="select mt-1 w-full" value={singleMode}
                          onChange={(e) => setSingleMode(e.target.value as "focused" | "broad")}>
                    <option value="focused">Präzise (weniger Treffer, mehr Signal)</option>
                    <option value="broad">Breit (mehr Treffer, mehr Rauschen)</option>
                  </select>
                </label>
              </div>
              {singleError && <div className="text-xs" style={{ color: "var(--hot)" }}>{singleError}</div>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn" disabled={singleSubmitting} onClick={() => setShowSingle(false)}>Abbrechen</button>
              <button className="btn btn-primary" disabled={singleSubmitting} onClick={submitSingle}>
                {singleSubmitting ? (<><span className="spinner" /> Startet ...</>) : "Prüfung starten"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </DashboardContext.Provider>
  );
}

function HowItWorks() {
  const [open, setOpen] = useState(true);
  return (
    <section className="panel">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-3 flex items-center justify-between text-left"
        style={{ borderBottom: open ? "1px solid var(--line)" : "none" }}
      >
        <div>
          <div className="eyebrow">So funktioniert der Mandate Radar</div>
          <div className="text-[13px] mt-0.5" style={{ color: "var(--ink-mute)" }}>
            Drei Schritte, die aufeinander aufbauen. Klick zum Ein- und Ausklappen.
          </div>
        </div>
        <span className="mono text-xs" style={{ color: "var(--ink-mute)" }}>{open ? "einklappen" : "ausklappen"}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0" style={{ background: "var(--surface-2)" }}>
          <HowStep
            step="1"
            title="HubSpot-Daten holen"
            body="Zieht Firmen, Kontakte, Listen und Deals aus HubSpot in die Datenbank. Wird bei Bedarf angestossen. Es wird nichts an HubSpot zurückgeschrieben."
            where={'Panel „HubSpot-Daten holen" direkt darunter.'}
          />
          <HowStep
            step="2"
            title="Firmen scannen"
            body="Durchsucht Google News zu jeder Zielfirma. Die KI liest die Treffer, prüft ob es ein echtes Signal ist (z. B. Führungswechsel, Übernahme, Restrukturierung), vergibt eine Priorisierung und speichert einen Fall."
            where={'Button oben rechts: „Alle Firmen scannen" oder „Einzelne Firma prüfen".'}
          />
          <HowStep
            step="3"
            title="Fälle prüfen"
            body="Fälle sortieren sich in Heisse Fälle, Auffällige Firmen, Beobachten und Ohne Signal. Für jeden Fall gibt es Score, Signal-Typ, Zitat aus der Quelle und passende HubSpot-Kontakte."
            where={'Reiter unten in der Tabelle unter „Fälle".'}
          />
        </div>
      )}
    </section>
  );
}

function HowStep({ step, title, body, where }: { step: string; title: string; body: string; where: string }) {
  return (
    <div className="px-5 py-4 border-r" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center gap-2 mb-1">
        <span
          className="mono"
          style={{
            width: 22, height: 22, borderRadius: 4,
            background: "var(--ink)", color: "#fff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 600,
          }}
        >{step}</span>
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <div className="text-[13px]" style={{ color: "var(--ink)" }}>{body}</div>
      <div className="text-xs mt-2" style={{ color: "var(--ink-mute)" }}>{where}</div>
    </div>
  );
}

function Kpi({ label, value, tone, sub, onClick }: { label: string; value: number; tone?: "hot" | "warm"; sub?: string; onClick?: () => void }) {
  const clickable = !!onClick;
  const toneClass = tone === "hot" ? "tone-hot" : tone === "warm" ? "tone-warm" : "";
  return (
    <div
      className={`kpi-cell ${toneClass} ${clickable ? "clickable" : ""}`}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => { if (clickable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick?.(); } }}
    >
      <div className="k-label">
        {label}
        {clickable && <span style={{ marginLeft: 6, fontFamily: "JetBrains Mono, monospace" }}>&#8599;</span>}
      </div>
      <div className="k-value">
        {value.toLocaleString("de-DE")}
        {sub && <span className="k-sub" style={{ marginLeft: 6 }}>{sub}</span>}
      </div>
    </div>
  );
}

function scoreFillClass(cls: string) {
  const k = cls.toLowerCase();
  if (k === "hot") return "hot";
  if (k === "warm") return "warm";
  if (k === "watchlist") return "watch";
  return "archiv";
}

function CasesTable({
  rows, expanded, onToggle, onPatch, variant, onCompanyClick,
}: {
  rows: CaseRow[];
  expanded: Record<number, SignalRow[] | "loading" | undefined>;
  onToggle: (id: number) => void;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
  variant: TabKey;
  onCompanyClick?: (company: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 84 }}>Score</th>
            <th>Firma / Bedarfshypothese</th>
            <th>Klasse</th>
            <th>Top-Signal</th>
            <th>Quelle</th>
            <th>Status</th>
            <th>Berater</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: "var(--text-mute)", padding: "24px 14px" }}>
                In diesem Bereich liegen aktuell keine Fälle. Rechts oben über „Alle Firmen scannen" einen Scan starten.
              </td>
            </tr>
          )}
          {rows.map((c) => {
            const isOpen = !!expanded[c.case_id];
            const fillPct = Math.max(0, Math.min(100, c.case_priority));
            const fillTone = scoreFillClass(c.case_class);
            const reviewDue = c.next_review_at && new Date(c.next_review_at).getTime() < Date.now();
            return (
              <Fragment key={c.case_id}>
                <tr>
                  <td>
                    <div className="score-wrap">
                      <div className="score-num">{c.case_priority}</div>
                      <div className="score-bar" title={`Priority ${c.case_priority}/100`}>
                        <div className={`score-fill ${fillTone}`} style={{ width: `${fillPct}%` }} />
                      </div>
                      <div className="pill">
                        Fit {c.account_fit ?? "-"} · Act {c.actionability ?? "-"}
                      </div>
                    </div>
                  </td>
                  <td>
                    {onCompanyClick ? (
                      <button className="company-link" onClick={() => onCompanyClick(c.company)} title="Firmen-Dossier öffnen">
                        {c.company}
                      </button>
                    ) : (
                      <div className="font-semibold">{c.company}</div>
                    )}
                    <div className="text-xs" style={{ color: "var(--text-mute)", marginTop: 2 }}>
                      {c.case_title ?? c.summary?.slice(0, 90) ?? "-"}
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                      <span className="pill strong">Case #{c.case_id}</span>
                      {c.supporting_signals > 0 && (
                        <span className="pill" title="Anzahl gefundener Signale">
                          {c.supporting_signals} Signal{c.supporting_signals === 1 ? "" : "e"}
                        </span>
                      )}
                      {c.discovered_via && (
                        <span className="pill" title="Woher der Fall stammt">{c.discovered_via}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={classChip(c.case_class)}>{c.case_class}</span>
                    {c.no_signal_found && (
                      <div style={{ marginTop: 4 }}>
                        <span className="chip chip-archiv">kein Signal</span>
                      </div>
                    )}
                  </td>
                  <td>
                    {c.top_signal_id ? (
                      <>
                        {(() => {
                          const k = signalKey(c.top_signal_id);
                          return k ? (
                            <span className={`chip chip-sig-${k}`}>{prettySignal(c.top_signal_id)}</span>
                          ) : (
                            <span className="chip chip-archiv">{prettySignal(c.top_signal_id)}</span>
                          );
                        })()}
                        {c.top_signal_subtype && (
                          <div className="mono text-xs" style={{ color: "var(--text-mute)", marginTop: 4 }}>{c.top_signal_subtype}</div>
                        )}
                      </>
                    ) : (<span style={{ color: "var(--text-mute)" }}>-</span>)}
                  </td>
                  <td>
                    <a className="hover:underline" style={{ color: "var(--accent)" }}
                       href={c.source_url} target="_blank" rel="noopener noreferrer">
                      {c.source_publisher ?? hostFromUrl(c.source_url)}
                    </a>
                    <div className="mono text-xs" style={{ color: "var(--text-mute)", marginTop: 2 }}>
                      {hostFromUrl(c.source_url)}
                    </div>
                    <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                      {c.source_published_at && (
                        <span className="pill" title="Publikationsdatum der Quelle">Pub {formatDateShort(c.source_published_at)}</span>
                      )}
                      <span className="pill" title="Wann der Bot den Artikel eingelesen hat">
                        Scan {formatDateShort(c.source_fetched_at)}
                      </span>
                      <span className="pill" title="Wann der Case erstellt wurde">
                        Case {formatDateShort(c.created_at)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        className={`chip-status status-${statusBucket(c.status)}`}
                        title={CASE_STATUS_LABEL_DE[c.status as keyof typeof CASE_STATUS_LABEL_DE]}
                        style={{ padding: "1px 6px", fontSize: 9.5, minWidth: 6 }}
                      >
                        &nbsp;
                      </span>
                      <select
                        className="select text-xs"
                        value={c.status}
                        onChange={(e) => onPatch(c.case_id, { status: e.target.value })}
                      >
                        {CASE_STATUSES.map((s) => (
                          <option key={s} value={s}>{CASE_STATUS_LABEL_DE[s]}</option>
                        ))}
                      </select>
                    </div>
                    {c.next_review_at && (
                      <div style={{ marginTop: 4 }}>
                        <span
                          className="pill"
                          title="Nächster Prüfer-Termin"
                          style={reviewDue ? { color: "var(--hot)", borderColor: "#e2b4b4", background: "var(--hot-bg)" } : undefined}
                        >
                          Review {formatDateShort(c.next_review_at)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      className="input text-xs"
                      style={{ width: 130 }}
                      placeholder="Berater"
                      value={c.assigned_to ?? ""}
                      onChange={(e) => onPatch(c.case_id, { assigned_to: e.target.value || null })}
                    />
                    {c.model && (
                      <div style={{ marginTop: 4 }}>
                        <span className="pill" title="KI-Modell, das den Fall bewertet hat">{c.model}</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <button className="btn" onClick={() => onToggle(c.case_id)}>{isOpen ? "-" : "+"}</button>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={8} style={{ background: "var(--panel-2)" }}>
                      <CaseDetails caseRow={c} signals={expanded[c.case_id]} onPatch={onPatch} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmergingTable({ rows, onCompanyClick }: { rows: EmergingCompanyRow[]; onCompanyClick?: (c: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 90 }}>Emerging</th>
            <th>Firma</th>
            <th>Cases</th>
            <th>Signal-Mix</th>
            <th>Fit / Action</th>
            <th>Letzter Case</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "var(--text-mute)", padding: "24px 14px" }}>
                Noch keine Firma mit mehreren Signalen. Scan mit höherem Artikel-Limit oder mehr Firmen erhöht das.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.company_id}>
              <td className="mono font-semibold">{r.emerging_score}</td>
              <td>
                {onCompanyClick ? (
                  <button className="company-link" onClick={() => onCompanyClick(r.company)} title="Firmen-Dossier öffnen">
                    {r.company}
                  </button>
                ) : (
                  <div className="font-semibold">{r.company}</div>
                )}
                <div className="mono text-xs" style={{ color: "var(--text-mute)" }}>
                  Max Prio {r.max_priority} · Avg {Math.round(r.avg_priority)} · {r.contact_count ?? 0} Kontakte
                </div>
              </td>
              <td>
                <div className="text-sm">{r.cases} Cases</div>
                <div className="text-xs" style={{ color: "var(--text-mute)" }}>
                  {r.hot > 0 && <span className="chip chip-hot" style={{ marginRight: 4 }}>{r.hot} Hot</span>}
                  {r.warm > 0 && <span className="chip chip-warm" style={{ marginRight: 4 }}>{r.warm} Warm</span>}
                  {r.watchlist > 0 && <span className="chip chip-watch" style={{ marginRight: 4 }}>{r.watchlist} Watch</span>}
                </div>
              </td>
              <td className="text-xs">
                {r.signal_ids.length === 0 ? "-" : r.signal_ids.map((id) => {
                  const k = signalKey(id);
                  return (
                    <div key={id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      {k && <span className={`dot dot-${k}`} />}
                      <span>{prettySignal(id)}</span>
                    </div>
                  );
                })}
              </td>
              <td className="mono text-xs">
                Fit {r.account_fit ?? "-"} / Act {r.actionability ?? "-"}
              </td>
              <td className="mono text-xs" style={{ color: "var(--text-mute)" }}>
                {formatDateShort(r.last_case_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDuration(startIso: string, endIso: string | null) {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m}m ${rest.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`;
}

function formatTimeShort(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function JobsHistoryPanel({ jobs, onOpen }: { jobs: Job[]; onOpen: (j: Job) => void }) {
  const [open, setOpen] = useState(false);
  if (jobs.length === 0) return null;
  const runningCount = jobs.filter((j) => j.status === "running").length;
  const latest = jobs[0];
  const shown = jobs.slice(0, 10);
  return (
    <div className="jobs-history">
      <div className="jobs-history-head" onClick={() => setOpen((v) => !v)}>
        <div className="title">Scan-Historie</div>
        <div className="meta">
          {jobs.length} Läufe · zuletzt {formatTimeShort(latest.started_at)}
          {runningCount > 0 && ` · ${runningCount} laufend`}
        </div>
        <span className="mono ml-auto" style={{ color: "var(--ink-mute)", fontSize: 11 }}>
          {open ? "einklappen" : "ausklappen"}
        </span>
      </div>
      {open && (
        <div className="jobs-history-list">
          {shown.map((j) => {
            const target = j.type === "batch"
              ? `${j.total || j.processed} Firmen`
              : (j.company ?? "-");
            const stat = j.type === "batch"
              ? `Hits ${j.hits} · pers. ${j.persisted}${j.errors ? ` · Fehler ${j.errors}` : ""}`
              : `disc. ${j.discovered} · pers. ${j.persisted}`;
            return (
              <div key={j.id} className="jobs-history-row" onClick={() => onOpen(j)} title="Details öffnen">
                <div className="col-time">{formatTimeShort(j.started_at)}</div>
                <div className="col-type">{j.type === "batch" ? "Batch" : "Einzel"}</div>
                <div className="col-target">{target}</div>
                <div className="col-stat">{stat}</div>
                <div className="col-dur">{formatDuration(j.started_at, j.ended_at)}</div>
                <div className="col-badge">
                  <span className={`jobs-badge ${j.status}`}>{j.status === "running" ? "läuft" : j.status === "done" ? "fertig" : "Fehler"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function JobPanel({ job, onDismiss }: { job: Job; onDismiss: () => void }) {
  const running = job.status === "running";
  const pct = job.type === "batch" && job.total > 0
    ? Math.min(100, Math.round((job.processed / job.total) * 100))
    : null;
  return (
    <div className="panel">
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center gap-3 min-w-0">
          {running && <span className="spinner" />}
          <div className="min-w-0">
            <div className="text-[13px] font-semibold truncate tracking-tight">
              {job.label}
              <span className="mono ml-2" style={{ color: "var(--ink-mute)" }}>
                {job.mode} · Artikel/Firma={job.limit}
              </span>
            </div>
            <div className="mono truncate mt-0.5" style={{ color: "var(--ink-mute)" }}>
              {job.type === "batch" ? (
                <>
                  {job.status === "running" && (
                    <>läuft ... {job.processed}/{job.total} Firmen · Hits {job.hits} · persistiert {job.persisted}
                      {job.current_company && <> · aktuell „{job.current_company}"</>}
                    </>
                  )}
                  {job.status === "done" && (
                    <>fertig · {job.processed}/{job.total} Firmen · Hits {job.hits} · persistiert {job.persisted} · Fehler {job.errors}</>
                  )}
                  {job.status === "error" && (<>Fehler: {job.error ?? "unbekannt"}</>)}
                </>
              ) : (
                <>
                  {job.status === "running" && `läuft ... erfasst: ${job.discovered}, persistiert: ${job.persisted}`}
                  {job.status === "done" && `fertig · erfasst: ${job.discovered}, persistiert: ${job.persisted}`}
                  {job.status === "error" && `Fehler: ${job.error ?? "unbekannt"}`}
                </>
              )}
            </div>
          </div>
        </div>
        {!running && (<button className="btn" onClick={onDismiss}>Schliessen</button>)}
      </div>
      {pct !== null && (
        <div className="px-5 py-3 border-b" style={{ borderColor: "var(--line)" }}>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <div className="scrollbox mono px-5 py-3" style={{ color: "var(--ink-mute)" }}>
        {job.logs.length === 0 ? (<div>Warte auf Bot-Ausgabe ...</div>)
          : job.logs.slice(-200).map((line, i) => <div key={i}>{line}</div>)}
      </div>
    </div>
  );
}

function timelineToneForClass(cls: string) {
  const k = cls.toLowerCase();
  if (k === "hot") return "hot";
  if (k === "warm") return "warm";
  if (k === "watchlist") return "watch";
  return "muted";
}

function CaseDetails({
  caseRow, signals, onPatch,
}: {
  caseRow: CaseRow;
  signals: SignalRow[] | "loading" | undefined;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState(caseRow.case_title ?? "");
  const [nextReview, setNextReview] = useState(caseRow.next_review_at?.slice(0, 10) ?? "");

  const sortedSignals = useMemo(() => {
    if (!Array.isArray(signals)) return signals;
    return [...signals].sort((a, b) => {
      const ad = a.event_date ? new Date(a.event_date).getTime() : 0;
      const bd = b.event_date ? new Date(b.event_date).getTime() : 0;
      if (ad !== bd) return bd - ad;
      return b.priority_score - a.priority_score;
    });
  }, [signals]);

  return (
    <div className="px-6 py-5 space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="eyebrow">Case-Titel (Bedarfshypothese)</span>
          <input className="input mt-1 w-full text-sm" value={title}
                 onChange={(e) => setTitle(e.target.value)}
                 onBlur={() => onPatch(caseRow.case_id, { case_title: title || null })} />
        </label>
        <label className="block">
          <span className="eyebrow">Nächster Prüfer-Termin</span>
          <input type="date" className="input mt-1 w-full text-sm" value={nextReview}
                 onChange={(e) => setNextReview(e.target.value)}
                 onBlur={() => onPatch(caseRow.case_id, { next_review_at: nextReview ? new Date(nextReview).toISOString() : null })} />
        </label>
      </div>

      {caseRow.summary && (
        <div>
          <div className="eyebrow mb-1">Zusammenfassung</div>
          <div className="text-sm">{caseRow.summary}</div>
        </div>
      )}

      <div>
        <div className="eyebrow mb-2">Fakten</div>
        <div className="meta-grid">
          <div>
            <div className="meta-label">Score</div>
            <div className="meta-value">{caseRow.case_priority} / 100</div>
          </div>
          <div>
            <div className="meta-label">Account Fit</div>
            <div className="meta-value">{caseRow.account_fit ?? "-"}</div>
          </div>
          <div>
            <div className="meta-label">Actionability</div>
            <div className="meta-value">{caseRow.actionability ?? "-"}</div>
          </div>
          <div>
            <div className="meta-label">Unterst. Signale</div>
            <div className="meta-value">{caseRow.supporting_signals}</div>
          </div>
          <div>
            <div className="meta-label">Modell</div>
            <div className="meta-value">{caseRow.model ?? "-"}</div>
          </div>
          <div>
            <div className="meta-label">Publisher</div>
            <div className="meta-value plain">{caseRow.source_publisher ?? "-"}</div>
          </div>
          <div>
            <div className="meta-label">Publiziert</div>
            <div className="meta-value">{formatDate(caseRow.source_published_at) || "-"}</div>
          </div>
          <div>
            <div className="meta-label">Erfasst</div>
            <div className="meta-value">{formatDate(caseRow.source_fetched_at)}</div>
          </div>
          <div>
            <div className="meta-label">Case erstellt</div>
            <div className="meta-value">{formatDate(caseRow.created_at)}</div>
          </div>
          <div>
            <div className="meta-label">Discovered via</div>
            <div className="meta-value">{caseRow.discovered_via || "-"}</div>
          </div>
          <div>
            <div className="meta-label">Company-Hint</div>
            <div className="meta-value plain">{caseRow.company_hint || "-"}</div>
          </div>
          <div>
            <div className="meta-label">Nächster Review</div>
            <div className="meta-value">{formatDate(caseRow.next_review_at) || "-"}</div>
          </div>
        </div>
      </div>

      <div>
        <div className="eyebrow mb-2">Verlauf</div>
        {signals === "loading" && <div className="text-xs" style={{ color: "var(--ink-mute)" }}>Lädt ...</div>}
        {Array.isArray(sortedSignals) && sortedSignals.length === 0 && (
          <div className="text-xs" style={{ color: "var(--ink-mute)" }}>Keine Signale extrahiert.</div>
        )}
        {Array.isArray(sortedSignals) && sortedSignals.length > 0 && (
          <div className="timeline">
            {caseRow.next_review_at && (
              <div className="timeline-node muted">
                <div className="timeline-date">Termin · {formatDate(caseRow.next_review_at)}</div>
                <div className="timeline-title">Nächster Prüfer-Termin</div>
              </div>
            )}
            <div className="timeline-node">
              <div className="timeline-date">Case · {formatDate(caseRow.created_at)}</div>
              <div className="timeline-title">
                Fall erstellt · Klasse {caseRow.case_class} · Score {caseRow.case_priority}
              </div>
              <div className="body">
                <div className="text-xs" style={{ color: "var(--ink-mute)" }}>
                  {caseRow.discovered_via ? `Über ${caseRow.discovered_via}` : "Quelle unbekannt"}
                  {caseRow.model ? ` · Bewertet mit ${caseRow.model}` : ""}
                </div>
              </div>
            </div>
            {sortedSignals.map((sig) => (
              <div key={sig.id} className={`timeline-node ${timelineToneForClass(sig.priority_class)}`}>
                <div className="timeline-date">
                  {sig.event_date ? `Ereignis · ${formatDate(sig.event_date)}` : "Ereignis · Datum unbekannt"}
                  {sig.event_status ? ` · ${sig.event_status}` : ""}
                </div>
                <div className="timeline-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {(() => {
                    const k = signalKey(sig.signal_id);
                    return k ? <span className={`dot dot-${k}`} /> : null;
                  })()}
                  <span>{prettySignal(sig.signal_id)}</span>
                  {sig.subtype && (
                    <span className="mono text-xs" style={{ color: "var(--ink-mute)", fontWeight: 400 }}>
                      · {sig.subtype}
                    </span>
                  )}
                </div>
                <div className="body">
                  {sig.affected_function && (
                    <div className="text-xs mb-1">
                      <span style={{ color: "var(--ink-mute)" }}>Funktion: </span>
                      {sig.affected_function}
                      {sig.affected_person && ` · ${sig.affected_person}`}
                    </div>
                  )}
                  <blockquote className="text-sm mt-2 pl-3 border-l-2"
                              style={{ borderColor: "var(--line-strong)", color: "var(--ink)" }}>
                    „{sig.evidence_quote}"
                  </blockquote>
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                    <MiniStat label="Signal" value={sig.signal_strength} />
                    <MiniStat label="Confidence" value={sig.confidence} />
                    <MiniStat label="Urgency" value={sig.urgency} />
                    <MiniStat label="Search-Rel." value={sig.search_relevance ?? "-"} />
                    <MiniStat label="Prio" value={sig.priority_score} />
                    <MiniStat label="Fenster" value={sig.likely_search_window ?? "-"} />
                  </div>
                  {sig.recommended_action && (
                    <div className="mt-2 text-xs">
                      <span style={{ color: "var(--ink-mute)" }}>Empfohlene Aktion: </span>
                      {sig.recommended_action}
                    </div>
                  )}
                  {sig.counter_arguments && (
                    <div className="mt-1 text-xs" style={{ color: "var(--ink-mute)" }}>
                      Gegenargumente: {sig.counter_arguments}
                    </div>
                  )}
                  {sig.reasoning && (
                    <div className="mt-1 text-xs" style={{ color: "var(--ink-mute)" }}>
                      Begründung: {sig.reasoning}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "var(--text-mute)" }}>{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel-2 px-2 py-1">
      <div className="text-[10px]" style={{ color: "var(--text-mute)" }}>{label}</div>
      <div className="mono text-xs">{value}</div>
    </div>
  );
}

function UsageKpi({ usage }: { usage: UsagePayload | null }) {
  const cost = usage?.total.cost_usd ?? 0;
  const tokens = usage?.total.tokens ?? 0;
  const eur = cost * 0.92; // grober USD->EUR-Kurs
  return (
    <div className="kpi-cell">
      <div className="k-label">OpenAI</div>
      <div className="k-value">{"$" + cost.toFixed(4)}</div>
      <div className="k-sub mono">
        ≈ {eur.toFixed(4).replace(".", ",")} € · {tokens.toLocaleString("de-DE")} Tokens
      </div>
    </div>
  );
}

function CompanyDossier({
  company, cases, onClose, onJumpToCase,
}: {
  company: string;
  cases: CaseRow[];
  onClose: () => void;
  onJumpToCase: (c: CaseRow) => void;
}) {
  const [contacts, setContacts] = useState<ContactRow[] | null>(null);
  const [contactsLoading, setContactsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setContactsLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/companies/lookup?name=${encodeURIComponent(company)}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { contacts: ContactRow[] };
        if (!cancelled) setContacts(data.contacts);
      } catch {
        if (!cancelled) setContacts([]);
      } finally {
        if (!cancelled) setContactsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [company]);

  const companyCases = useMemo(
    () => cases.filter((c) => c.company.toLowerCase() === company.toLowerCase())
      .sort((a, b) => b.case_priority - a.case_priority),
    [cases, company]
  );

  const stats = useMemo(() => {
    const s = { total: companyCases.length, hot: 0, warm: 0, watch: 0 };
    for (const c of companyCases) {
      if (c.case_class === "Hot") s.hot++;
      else if (c.case_class === "Warm") s.warm++;
      else if (c.case_class === "Watchlist") s.watch++;
    }
    return s;
  }, [companyCases]);

  const lastCase = companyCases.reduce<CaseRow | null>((a, b) => {
    if (!a) return b;
    return new Date(b.created_at) > new Date(a.created_at) ? b : a;
  }, null);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head" style={{ position: "relative" }}>
          <button className="drawer-close" onClick={onClose} aria-label="Schliessen">×</button>
          <div className="eyebrow">Firmen-Dossier</div>
          <h2>{company}</h2>
          {lastCase && (
            <div className="mono text-xs" style={{ color: "var(--ink-mute)", marginTop: 6 }}>
              Letzter Case erfasst {formatDate(lastCase.created_at)}
            </div>
          )}
        </div>
        <div className="drawer-body">
          <div>
            <div className="eyebrow mb-2">Übersicht</div>
            <div className="dossier-stats">
              <div className="dossier-stat">
                <div className="lbl">Fälle</div>
                <div className="val">{stats.total}</div>
              </div>
              <div className="dossier-stat tone-hot">
                <div className="lbl">Heiss</div>
                <div className="val">{stats.hot}</div>
              </div>
              <div className="dossier-stat tone-warm">
                <div className="lbl">Warm</div>
                <div className="val">{stats.warm}</div>
              </div>
              <div className="dossier-stat">
                <div className="lbl">Beobachten</div>
                <div className="val">{stats.watch}</div>
              </div>
            </div>
          </div>

          <div>
            <div className="eyebrow mb-2">Alle Fälle</div>
            {companyCases.length === 0 ? (
              <div className="text-xs" style={{ color: "var(--ink-mute)" }}>Noch keine Fälle für diese Firma.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {companyCases.map((c) => (
                  <button
                    key={c.case_id}
                    className="dossier-case"
                    onClick={() => onJumpToCase(c)}
                    title="Zum Fall springen"
                    style={{ background: "transparent", cursor: "pointer", textAlign: "left" }}
                  >
                    <div className="prio">{c.case_priority}</div>
                    <div>
                      <div className="title">
                        {c.case_title ?? c.top_signal_id ? prettySignal(c.top_signal_id ?? "") : "Ohne Titel"}
                      </div>
                      <div className="sub">
                        {formatDateShort(c.created_at)}
                        {c.source_publisher && ` · ${c.source_publisher}`}
                        {c.top_signal_subtype && ` · ${c.top_signal_subtype}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <span className={classChip(c.case_class)}>{c.case_class}</span>
                      <span className="pill">Case #{c.case_id}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="eyebrow mb-2">HubSpot-Kontakte</div>
            {contactsLoading ? (
              <div className="text-xs" style={{ color: "var(--ink-mute)" }}><span className="spinner" /> Lädt ...</div>
            ) : contacts && contacts.length > 0 ? (
              <div style={{ border: "1px solid var(--line)", borderRadius: 4, background: "var(--surface)" }}>
                {contacts.map((c) => (
                  <div key={c.id} className="dossier-contact">
                    <div>
                      <div className="name">
                        {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "(kein Name)"}
                      </div>
                      <div className="role">
                        {c.lead_status ?? ""}
                        {c.company_name && (c.lead_status ? ` · ${c.company_name}` : c.company_name)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="email">{c.email ?? ""}</div>
                      {c.owner && (
                        <div className="text-xs" style={{ color: "var(--ink-mute)", marginTop: 2 }}>
                          Owner: {c.owner}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs" style={{ color: "var(--ink-mute)" }}>
                Keine Kontakte zu „{company}" in HubSpot gefunden.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactMatchPanel({ company, contacts }: { company: string; contacts: ContactRow[] }) {
  if (contacts.length === 0) {
    return (
      <div className="panel px-5 py-4">
        <div className="eyebrow">HubSpot-Abgleich</div>
        <div className="text-sm mt-1" style={{ color: "var(--ink-mute)" }}>
          Keine Kontakte zu „{company}" in HubSpot gefunden.
        </div>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--line)" }}>
        <div>
          <div className="eyebrow">HubSpot-Abgleich</div>
          <div className="text-sm mt-0.5">
            {contacts.length} Kontakt{contacts.length === 1 ? "" : "e"} zu „{company}"
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>E-Mail / Telefon</th>
              <th>Firma</th>
              <th>Berater</th>
              <th>Letzte Aktivität</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className="font-semibold">{[c.first_name, c.last_name].filter(Boolean).join(" ") || "-"}</div>
                  {c.lead_status && (
                    <div className="mono text-xs" style={{ color: "var(--ink-mute)" }}>{c.lead_status}</div>
                  )}
                </td>
                <td className="mono text-xs">
                  {c.email && <div>{c.email}</div>}
                  {c.phone && <div style={{ color: "var(--ink-mute)" }}>{c.phone}</div>}
                </td>
                <td className="text-xs">{c.company_name ?? "-"}</td>
                <td className="text-xs">{c.owner ?? "-"}</td>
                <td className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
                  {c.last_activity ? formatDateShort(c.last_activity) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WatchlistGroupedTable({
  groups, expanded, onToggle, onPatch, onCompanyClick,
}: {
  groups: { company: string; rows: CaseRow[]; max_priority: number }[];
  expanded: Record<number, SignalRow[] | "loading" | undefined>;
  onToggle: (id: number) => void;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
  onCompanyClick?: (company: string) => void;
}) {
  const [openCompanies, setOpenCompanies] = useState<Record<string, boolean>>({});
  const toggleCompany = (c: string) => setOpenCompanies((p) => ({ ...p, [c]: !p[c] }));
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 72 }}>Score</th>
            <th>Firma</th>
            <th>Publikationen</th>
            <th>Klassen-Mix</th>
            <th>Neueste Erfassung</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 && (
            <tr><td colSpan={6} style={{ color: "var(--ink-mute)", padding: "24px 14px" }}>
              Keine Firmen mit mittleren Signalen.
            </td></tr>
          )}
          {groups.map((g) => {
            const open = !!openCompanies[g.company];
            const classes = { Hot: 0, Warm: 0, Watchlist: 0, Archiv: 0 } as Record<string, number>;
            for (const r of g.rows) classes[r.case_class] = (classes[r.case_class] ?? 0) + 1;
            const newest = g.rows.reduce((a, b) => a.created_at > b.created_at ? a : b);
            return (
              <Fragment key={g.company}>
                <tr onClick={() => toggleCompany(g.company)} style={{ cursor: "pointer" }}>
                  <td className="mono font-semibold">{g.max_priority}</td>
                  <td>
                    {onCompanyClick ? (
                      <button
                        className="company-link"
                        onClick={(e) => { e.stopPropagation(); onCompanyClick(g.company); }}
                        title="Firmen-Dossier öffnen"
                      >
                        {g.company}
                      </button>
                    ) : (
                      <div className="font-semibold">{g.company}</div>
                    )}
                    <div className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
                      {g.rows.length} Publikation{g.rows.length === 1 ? "" : "en"}
                    </div>
                  </td>
                  <td className="text-xs" style={{ color: "var(--ink-mute)" }}>
                    {g.rows.length}
                  </td>
                  <td>
                    {classes.Hot > 0 && <span className="chip chip-hot" style={{ marginRight: 4 }}>{classes.Hot} Heiss</span>}
                    {classes.Warm > 0 && <span className="chip chip-warm" style={{ marginRight: 4 }}>{classes.Warm} Warm</span>}
                    {classes.Watchlist > 0 && <span className="chip chip-watch" style={{ marginRight: 4 }}>{classes.Watchlist} Beobachten</span>}
                  </td>
                  <td className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
                    {formatDateShort(newest.created_at)}
                  </td>
                  <td>
                    <button className="btn" onClick={(e) => { e.stopPropagation(); toggleCompany(g.company); }}>
                      {open ? "-" : "+"}
                    </button>
                  </td>
                </tr>
                {open && g.rows.map((c) => {
                  const detailsOpen = !!expanded[c.case_id];
                  return (
                    <Fragment key={c.case_id}>
                      <tr style={{ background: "var(--surface-2)" }}>
                        <td className="mono">{c.case_priority}</td>
                        <td colSpan={2}>
                          <div className="text-sm">{c.case_title ?? c.summary?.slice(0, 90) ?? "-"}</div>
                          <div className="mono text-xs" style={{ color: "var(--ink-mute)" }}>Case #{c.case_id}</div>
                        </td>
                        <td>
                          <span className={classChip(c.case_class)}>{c.case_class}</span>
                          {c.top_signal_id && (
                            <div className="text-xs mt-1">{prettySignal(c.top_signal_id)}</div>
                          )}
                        </td>
                        <td>
                          <a className="hover:underline text-xs" style={{ color: "var(--accent)" }}
                             href={c.source_url} target="_blank" rel="noopener noreferrer">
                            {c.source_publisher ?? hostFromUrl(c.source_url)}
                          </a>
                          <div className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
                            {formatDateShort(c.created_at)}
                          </div>
                        </td>
                        <td>
                          <button className="btn" onClick={() => onToggle(c.case_id)}>{detailsOpen ? "-" : "+"}</button>
                        </td>
                      </tr>
                      {detailsOpen && (
                        <tr>
                          <td colSpan={6} style={{ background: "var(--surface)" }}>
                            <CaseDetails caseRow={c} signals={expanded[c.case_id]} onPatch={onPatch} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HubspotCompaniesTable({
  query, onQueryChange,
}: {
  query: string;
  onQueryChange: (v: string) => void;
}) {
  const [companies, setCompanies] = useState<{ company_name: string; contact_count: number; is_target: boolean; last_activity: string | null }[]>([]);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, ContactRow[] | "loading" | undefined>>({});

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    const res = await fetch(`/api/contacts/by-company?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { companies: typeof companies; total: number };
    setCompanies(data.companies);
    setTotal(data.total);
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (companyName: string) => {
    if (expanded[companyName]) {
      setExpanded((p) => { const n = { ...p }; delete n[companyName]; return n; });
      return;
    }
    setExpanded((p) => ({ ...p, [companyName]: "loading" }));
    try {
      const res = await fetch(`/api/companies/lookup?name=${encodeURIComponent(companyName)}`);
      const data = (await res.json()) as { contacts: ContactRow[] };
      setExpanded((p) => ({ ...p, [companyName]: data.contacts }));
    } catch {
      setExpanded((p) => { const n = { ...p }; delete n[companyName]; return n; });
    }
  };

  return (
    <div>
      <div className="px-5 py-3 border-b flex items-center gap-3" style={{ borderColor: "var(--line)" }}>
        <input
          className="input flex-1 max-w-[420px]"
          placeholder="Firma suchen..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <div className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
          {total.toLocaleString("de-DE")} Firmen
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Firma</th>
              <th>Kontakte</th>
              <th>In Zielunternehmen</th>
              <th>Letzte Aktivität</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {companies.length === 0 && (
              <tr><td colSpan={5} style={{ color: "var(--ink-mute)", padding: "24px 14px" }}>
                Keine Firmen gefunden.
              </td></tr>
            )}
            {companies.map((c) => {
              const open = !!expanded[c.company_name];
              return (
                <Fragment key={c.company_name}>
                  <tr onClick={() => toggle(c.company_name)} style={{ cursor: "pointer" }}>
                    <td className="font-semibold">{c.company_name}</td>
                    <td className="mono">{c.contact_count}</td>
                    <td>
                      {c.is_target ? (
                        <span className="chip chip-watch">Zielunternehmen</span>
                      ) : (
                        <span style={{ color: "var(--ink-mute)" }}>-</span>
                      )}
                    </td>
                    <td className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
                      {c.last_activity ? formatDateShort(c.last_activity) : "-"}
                    </td>
                    <td>
                      <button className="btn" onClick={(e) => { e.stopPropagation(); toggle(c.company_name); }}>
                        {open ? "-" : "+"}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={5} style={{ background: "var(--surface-2)", padding: 0 }}>
                        {expanded[c.company_name] === "loading" ? (
                          <div className="text-xs px-6 py-4">Lädt Kontakte...</div>
                        ) : (
                          <table className="table">
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>E-Mail / Telefon</th>
                                <th>Berater</th>
                                <th>Leadstatus</th>
                                <th>Letzte Aktivität</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(expanded[c.company_name] as ContactRow[]).map((k) => (
                                <tr key={k.id}>
                                  <td>{[k.first_name, k.last_name].filter(Boolean).join(" ") || "-"}</td>
                                  <td className="mono text-xs">
                                    {k.email && <div>{k.email}</div>}
                                    {k.phone && <div style={{ color: "var(--ink-mute)" }}>{k.phone}</div>}
                                  </td>
                                  <td className="text-xs">{k.owner ?? "-"}</td>
                                  <td className="text-xs">{k.lead_status ?? "-"}</td>
                                  <td className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
                                    {k.last_activity ? formatDateShort(k.last_activity) : "-"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompaniesTab() {
  const [rows, setRows] = useState<{ id: number; name: string; contact_count: number; active: boolean; last_scanned_at: string | null }[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    const res = await fetch(`/api/target-companies?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { rows: typeof rows; total: number };
    setRows(data.rows);
    setTotal(data.total);
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const addCompany = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/target-companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName("");
      await load();
    } finally { setBusy(false); }
  };

  const removeCompany = async (id: number) => {
    if (!confirm("Wirklich entfernen?")) return;
    await fetch(`/api/target-companies/${id}`, { method: "DELETE" });
    await load();
  };

  const toggleActive = async (id: number, next: boolean) => {
    await fetch(`/api/target-companies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: next }),
    });
    await load();
  };

  return (
    <div>
      <div className="px-5 py-3 border-b flex items-center gap-3 flex-wrap" style={{ borderColor: "var(--line)" }}>
        <input
          className="input flex-1 min-w-[240px] max-w-[420px]"
          placeholder="Firma suchen..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
          {total.toLocaleString("de-DE")} Zielunternehmen
        </div>
        <div className="ml-auto flex gap-2">
          <input
            className="input min-w-[220px]"
            placeholder="Neue Firma hinzufügen..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCompany()}
          />
          <button className="btn btn-primary" disabled={busy || !newName.trim()} onClick={addCompany}>
            Hinzufügen
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Firma</th>
              <th>HubSpot-Kontakte</th>
              <th>Aktiv</th>
              <th>Zuletzt gescannt</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ color: "var(--ink-mute)", padding: "24px 14px" }}>
                Keine Firmen gefunden.
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold">{r.name}</td>
                <td className="mono">{r.contact_count}</td>
                <td>
                  <label className="text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={r.active}
                      onChange={(e) => toggleActive(r.id, e.target.checked)}
                      style={{ marginRight: 6 }}
                    />
                    {r.active ? "aktiv" : "pausiert"}
                  </label>
                </td>
                <td className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
                  {r.last_scanned_at ? formatDateShort(r.last_scanned_at) : "-"}
                </td>
                <td>
                  <button className="btn" onClick={() => removeCompany(r.id)}>Löschen</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Campaign = {
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

const CAMPAIGN_KINDS = [
  { value: "outreach",  label: "Direktansprache" },
  { value: "email",     label: "E-Mail-Kampagne" },
  { value: "event",     label: "Event / Veranstaltung" },
  { value: "content",   label: "Content / Landingpage" },
  { value: "sonstiges", label: "Sonstiges" },
];
const CAMPAIGN_STATUSES = ["Entwurf", "Aktiv", "Pausiert", "Abgeschlossen", "Abgebrochen"];
const SIGNAL_OPTIONS = [
  { id: "C_LEVEL_DEPARTURE", label: "Konkreter Besetzungsanlass" },
  { id: "PE_TRANSACTION",    label: "Eigentümerwechsel / PE" },
  { id: "RESTRUCTURING",     label: "Restrukturierung / Krise" },
];
const CASE_CLASS_OPTIONS = ["Hot", "Warm", "Watchlist", "Archiv"];

function CampaignsTab({ onCountChange }: { onCountChange: (n: number) => void }) {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { rows: Campaign[] };
    setRows(data.rows);
    onCountChange(data.rows.length);
  }, [onCountChange]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: number) => {
    if (!confirm("Kampagne wirklich löschen?")) return;
    await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    await load();
  };

  const patch = async (id: number, patch: Record<string, unknown>) => {
    await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await load();
  };

  return (
    <div>
      <div className="px-5 py-3 border-b flex items-center gap-3" style={{ borderColor: "var(--line)" }}>
        <div className="text-sm" style={{ color: "var(--ink-mute)" }}>
          Ansprache-Aktionen und Themen-Sprints für priorisierte Fälle.
        </div>
        <button className="btn btn-primary ml-auto" onClick={() => setShowNew(true)}>
          + Neue Kampagne
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Kampagne</th>
              <th>Art</th>
              <th>Status</th>
              <th>Zeitraum</th>
              <th>Berater</th>
              <th>Filter</th>
              <th style={{ width: 140 }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ color: "var(--ink-mute)", padding: "24px 14px" }}>
                Keine Kampagnen. Klick oben rechts auf „Neue Kampagne".
              </td></tr>
            )}
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className="font-semibold">{c.name}</div>
                  {c.description && (
                    <div className="text-xs" style={{ color: "var(--ink-mute)" }}>{c.description}</div>
                  )}
                </td>
                <td className="text-xs">{CAMPAIGN_KINDS.find((k) => k.value === c.kind)?.label ?? c.kind}</td>
                <td>
                  <select className="select text-xs" value={c.status}
                          onChange={(e) => patch(c.id, { status: e.target.value })}>
                    {CAMPAIGN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
                  {c.start_date ? formatDateShort(c.start_date) : "-"}
                  {c.end_date && <> bis {formatDateShort(c.end_date)}</>}
                </td>
                <td className="text-xs">{c.assigned_to ?? "-"}</td>
                <td className="text-xs">
                  {c.filter_signal_ids.length > 0 && (
                    <div>{c.filter_signal_ids.length} Signaltyp{c.filter_signal_ids.length === 1 ? "" : "en"}</div>
                  )}
                  {c.filter_case_class.length > 0 && (
                    <div style={{ color: "var(--ink-mute)" }}>{c.filter_case_class.join(", ")}</div>
                  )}
                  {c.filter_signal_ids.length === 0 && c.filter_case_class.length === 0 && (
                    <span style={{ color: "var(--ink-mute)" }}>-</span>
                  )}
                </td>
                <td>
                  <div className="flex gap-1">
                    <button className="btn" onClick={() => setEditing(c)}>Bearbeiten</button>
                    <button className="btn" onClick={() => remove(c.id)}>Löschen</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(showNew || editing) && (
        <CampaignDialog
          initial={editing}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={() => { setShowNew(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function CampaignDialog({
  initial, onClose, onSaved,
}: {
  initial: Campaign | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "outreach");
  const [status, setStatus] = useState(initial?.status ?? "Entwurf");
  const [startDate, setStartDate] = useState(initial?.start_date?.slice(0, 10) ?? "");
  const [endDate, setEndDate] = useState(initial?.end_date?.slice(0, 10) ?? "");
  const [assignedTo, setAssignedTo] = useState(initial?.assigned_to ?? "");
  const [signalIds, setSignalIds] = useState<string[]>(initial?.filter_signal_ids ?? []);
  const [caseClasses, setCaseClasses] = useState<string[]>(initial?.filter_case_class ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSignal = (id: string) => setSignalIds((prev) =>
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const toggleClass = (cls: string) => setCaseClasses((prev) =>
    prev.includes(cls) ? prev.filter((x) => x !== cls) : [...prev, cls]);

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError("Name fehlt."); return; }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description,
        kind,
        status,
        start_date: startDate || null,
        end_date: endDate || null,
        assigned_to: assignedTo || null,
        filter_signal_ids: signalIds,
        filter_case_class: caseClasses,
        notes,
      };
      const url = initial ? `/api/campaigns/${initial.id}` : `/api/campaigns`;
      const method = initial ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setError(e.error ?? `HTTP ${res.status}`);
        return;
      }
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div className="dialog-backdrop" onClick={() => !saving && onClose()}>
      <div className="dialog" style={{ width: "min(680px, 96vw)", maxHeight: "88vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold mb-1">
          {initial ? "Kampagne bearbeiten" : "Neue Kampagne"}
        </h2>
        <p className="text-xs mb-4" style={{ color: "var(--ink-mute)" }}>
          Definiere eine Ansprache-Aktion. Filter beschränken, welche Cases im Rahmen dieser Kampagne sichtbar sind.
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="eyebrow">Name</span>
            <input className="input mt-1 w-full" placeholder="z.B. CFO-Wechsel Q4 2026"
                   value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="eyebrow">Beschreibung</span>
            <textarea className="input mt-1 w-full" rows={2}
                      placeholder="Kurzer Zweck der Kampagne"
                      value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="eyebrow">Art</span>
              <select className="select mt-1 w-full" value={kind} onChange={(e) => setKind(e.target.value)}>
                {CAMPAIGN_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="eyebrow">Status</span>
              <select className="select mt-1 w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
                {CAMPAIGN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="eyebrow">Start</span>
              <input type="date" className="input mt-1 w-full"
                     value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="eyebrow">Ende</span>
              <input type="date" className="input mt-1 w-full"
                     value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <label className="block col-span-2">
              <span className="eyebrow">Berater</span>
              <input className="input mt-1 w-full" placeholder="z.B. F. Schulz"
                     value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
            </label>
          </div>
          <div>
            <div className="eyebrow mb-2">Signal-Filter</div>
            <div className="flex flex-wrap gap-2">
              {SIGNAL_OPTIONS.map((s) => (
                <button key={s.id} type="button"
                        onClick={() => toggleSignal(s.id)}
                        className={`btn ${signalIds.includes(s.id) ? "btn-primary" : ""}`}
                        style={{ padding: "6px 10px", fontSize: 11 }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="eyebrow mb-2">Klassen-Filter</div>
            <div className="flex flex-wrap gap-2">
              {CASE_CLASS_OPTIONS.map((cls) => (
                <button key={cls} type="button"
                        onClick={() => toggleClass(cls)}
                        className={`btn ${caseClasses.includes(cls) ? "btn-primary" : ""}`}
                        style={{ padding: "6px 10px", fontSize: 11 }}>
                  {cls}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="eyebrow">Notizen</span>
            <textarea className="input mt-1 w-full" rows={3}
                      placeholder="Interne Hinweise, Content-Angle, Ansprache-Vorlage"
                      value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {error && <div className="text-xs" style={{ color: "var(--hot)" }}>{error}</div>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" disabled={saving} onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? (<><span className="spinner" /> Speichert...</>) : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

type HsStatus = {
  token_present: boolean;
  companies: { n: number; last: string | null };
  contacts:  { n: number; last: string | null };
  deals:     { n: number; last: string | null };
  lists:     { n: number; last: string | null };
};
type HsJob = {
  id: string;
  status: "running" | "done" | "error";
  started_at: string;
  ended_at: string | null;
  logs: string[];
  only: string;
  types: string | null;
  exit_code: number | null;
  error: string | null;
};

function HubspotSyncPanel() {
  const [status, setStatus] = useState<HsStatus | null>(null);
  const [job, setJob] = useState<HsJob | null>(null);
  const [only, setOnly] = useState<string>("all");
  const [types, setTypes] = useState<string>("Kunde,nicht aktiver Kunde");
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch(`/api/hubspot/status`, { cache: "no-store" });
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const pollJob = useCallback(async (id: string) => {
    const res = await fetch(`/api/hubspot/sync?id=${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const j = (await res.json()) as HsJob;
    setJob(j);
    if (j.status !== "running") { stopPoll(); loadStatus(); }
  }, [stopPoll, loadStatus]);

  const startSync = async () => {
    setStarting(true);
    try {
      const res = await fetch(`/api/hubspot/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ only, types }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? `HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as HsJob;
      setJob(j);
      stopPoll();
      pollRef.current = setInterval(() => pollJob(j.id), 1500);
      pollJob(j.id);
    } finally { setStarting(false); }
  };

  useEffect(() => () => stopPoll(), [stopPoll]);

  if (!status) return null;
  const running = job?.status === "running";

  const showTypeFilter = only === "all" || only === "companies";
  return (
    <div className="panel">
      <div className="px-5 py-4 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow">Schritt 1 · HubSpot-Daten holen</div>
            <div className="text-sm mt-1" style={{ maxWidth: 560 }}>
              Holt die aktuellen Firmen, Kontakte, Listen und Deals aus HubSpot in die Datenbank des Radars.
              <span style={{ color: "var(--ink-mute)" }}> Es wird nichts nach HubSpot zurückgeschrieben.</span>
            </div>
            {status.token_present ? (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--ink-mute)" }}>
                <span>Firmen <span className="mono" style={{ color: "var(--ink)" }}>{status.companies.n.toLocaleString("de-DE")}</span></span>
                <span>Kontakte <span className="mono" style={{ color: "var(--ink)" }}>{status.contacts.n.toLocaleString("de-DE")}</span></span>
                <span>Listen <span className="mono" style={{ color: "var(--ink)" }}>{status.lists.n.toLocaleString("de-DE")}</span></span>
                <span>Deals <span className="mono" style={{ color: "var(--ink)" }}>{status.deals.n.toLocaleString("de-DE")}</span></span>
                {status.contacts.last && (
                  <span>Zuletzt aktualisiert <span className="mono" style={{ color: "var(--ink)" }}>{formatDateShort(status.contacts.last)}</span></span>
                )}
              </div>
            ) : (
              <div className="mt-2 text-sm" style={{ color: "var(--hot)" }}>
                Kein HubSpot-Zugang. <span className="mono">HUBSPOT_TOKEN</span> in der .env-Datei ergänzen und Seite neu laden.
              </div>
            )}
          </div>
          {status.token_present && (
            <div className="flex flex-col items-end gap-2" style={{ minWidth: 280 }}>
              <label className="block w-full">
                <span className="eyebrow">Was holen?</span>
                <select className="select mt-1 w-full text-sm" value={only} onChange={(e) => setOnly(e.target.value)}>
                  <option value="all">Alles: Firmen, Kontakte, Listen, Deals</option>
                  <option value="companies">Nur Firmen</option>
                  <option value="contacts">Nur Kontakte</option>
                  <option value="lists">Nur Listen (Segmente)</option>
                  <option value="deals">Nur Deals</option>
                </select>
              </label>
              {showTypeFilter && (
                <label className="block w-full">
                  <span className="eyebrow">Nur diese Firmen-Typen (optional)</span>
                  <input
                    className="input mt-1 w-full text-sm"
                    placeholder="z. B. Kunde, nicht aktiver Kunde"
                    value={types}
                    onChange={(e) => setTypes(e.target.value)}
                  />
                  <span className="block text-[11px] mt-1" style={{ color: "var(--ink-mute)" }}>
                    Kommagetrennt. Filter greift auf das HubSpot-Feld „Firmentyp". Leer lassen, um alle zu holen.
                  </span>
                </label>
              )}
              <button className="btn btn-primary w-full" disabled={starting || running} onClick={startSync}>
                {starting || running ? (<><span className="spinner" /> Import läuft ...</>) : "Import starten"}
              </button>
            </div>
          )}
        </div>
      </div>
      {job && (
        <div className="scrollbox mono px-5 py-3" style={{ color: "var(--ink-mute)" }}>
          {job.logs.length === 0
            ? "Startet ..."
            : job.logs.slice(-100).map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

type SourceRow = {
  id: number;
  url: string;
  title: string | null;
  publisher: string | null;
  published_at: string | null;
  fetched_at: string;
  language: string | null;
  source_quality: number | null;
  discovered_via: string;
  company: string | null;
  case_class: string | null;
  case_priority: number | null;
  case_id: number | null;
  no_signal_found: boolean | null;
};

function SourcesModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    params.set("limit", String(pageSize));
    params.set("offset", String(page * pageSize));
    const res = await fetch(`/api/sources?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { rows: SourceRow[]; total: number };
    setRows(data.rows);
    setTotal(data.total);
  }, [query, page]);

  useEffect(() => { load(); }, [load]);

  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const start = page * pageSize + 1;
  const end = Math.min(total, start + rows.length - 1);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" style={{ width: "min(1080px, 96vw)", maxHeight: "88vh", overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-base font-semibold">Alle Quellen</h2>
            <div className="text-xs" style={{ color: "var(--ink-mute)" }}>
              Alle Artikel und Meldungen, die der Bot bisher eingelesen und ausgewertet hat.
            </div>
          </div>
          <button className="btn" onClick={onClose}>Schliessen</button>
        </div>
        <div className="flex items-center gap-3 mb-3">
          <input
            className="input flex-1"
            placeholder="Suchen (Titel, Publisher, Firma, URL)"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          />
          <div className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
            {total > 0 ? `${start}-${end} von ${total.toLocaleString("de-DE")}` : "0 Ergebnisse"}
          </div>
          <div className="flex gap-1">
            <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Zurück</button>
            <button className="btn" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>Weiter</button>
          </div>
        </div>
        <div className="panel" style={{ flex: 1, overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Titel / URL</th>
                <th>Firma</th>
                <th>Publisher</th>
                <th>Publiziert</th>
                <th>Fall</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} style={{ color: "var(--ink-mute)", padding: "24px 14px" }}>
                  Keine Quellen gefunden.
                </td></tr>
              )}
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <a className="hover:underline" style={{ color: "var(--accent)" }}
                       href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title ?? s.url.slice(0, 90)}
                    </a>
                    <div className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
                      {hostFromUrl(s.url)}
                    </div>
                  </td>
                  <td className="text-sm">{s.company ?? "-"}</td>
                  <td className="text-xs">{s.publisher ?? hostFromUrl(s.url)}</td>
                  <td className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
                    {s.published_at ? formatDateShort(s.published_at) : "-"}
                  </td>
                  <td>
                    {s.case_class ? (
                      <>
                        <span className={classChip(s.case_class)}>{s.case_class}</span>
                        <div className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
                          Score {s.case_priority}
                        </div>
                      </>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--ink-mute)" }}>-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HubspotTable({
  rows, total, page, pageSize, query, onQueryChange, onPageChange,
}: {
  rows: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  onQueryChange: (v: string) => void;
  onPageChange: (p: number) => void;
}) {
  const start = page * pageSize + 1;
  const end = Math.min(total, start + rows.length - 1);
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  return (
    <div>
      <div className="px-5 py-3 border-b flex items-center gap-3" style={{ borderColor: "var(--line)" }}>
        <input
          className="input flex-1 max-w-[420px]"
          placeholder="Suchen (Name, E-Mail, Firma, Berater)"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <div className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
          {total > 0 ? `${start}-${end} von ${total.toLocaleString("de-DE")}` : "0 Ergebnisse"}
        </div>
        <div className="ml-auto flex gap-1">
          <button className="btn" disabled={page === 0} onClick={() => onPageChange(page - 1)}>Zurück</button>
          <button className="btn" disabled={page >= maxPage} onClick={() => onPageChange(page + 1)}>Weiter</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>E-Mail / Telefon</th>
              <th>Firma</th>
              <th>Berater</th>
              <th>Leadstatus</th>
              <th>Letzte Aktivität</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "var(--ink-mute)", padding: "24px 14px" }}>
                  Keine Kontakte gefunden.
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className="font-semibold">{[c.first_name, c.last_name].filter(Boolean).join(" ") || "-"}</div>
                  {c.hubspot_id && (
                    <div className="mono text-xs" style={{ color: "var(--ink-mute)" }}>ID {c.hubspot_id}</div>
                  )}
                </td>
                <td className="mono text-xs">
                  {c.email && <div>{c.email}</div>}
                  {c.phone && <div style={{ color: "var(--ink-mute)" }}>{c.phone}</div>}
                </td>
                <td className="text-xs">{c.company_name ?? "-"}</td>
                <td className="text-xs">{c.owner ?? "-"}</td>
                <td className="text-xs">{c.lead_status ?? "-"}</td>
                <td className="mono text-xs" style={{ color: "var(--ink-mute)" }}>
                  {c.last_activity ? formatDateShort(c.last_activity) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Body-Views (jeweils eigene Route) ---------- */

function filterByCompany<T extends { company: string }>(rows: T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) => r.company.toLowerCase().includes(s));
}

export function HotView() {
  const ctx = useDashboard();
  const rows = useMemo(() => {
    const list = ctx.cases.filter((c) => c.case_class === "Hot" && !c.no_signal_found);
    return filterByCompany(list, ctx.companyFilter);
  }, [ctx.cases, ctx.companyFilter]);
  return (
    <CasesTable
      rows={rows}
      expanded={ctx.expanded}
      onToggle={ctx.toggleExpand}
      onPatch={ctx.patchCase}
      variant="hot"
      onCompanyClick={ctx.openDossier}
    />
  );
}

export function EmergingView() {
  const ctx = useDashboard();
  const rows = useMemo(
    () => filterByCompany(ctx.emerging.filter((r) => r.cases >= 2), ctx.companyFilter),
    [ctx.emerging, ctx.companyFilter]
  );
  return <EmergingTable rows={rows} onCompanyClick={ctx.openDossier} />;
}

export function WatchlistView() {
  const ctx = useDashboard();
  const groups = useMemo(() => {
    const buckets = new Map<string, CaseRow[]>();
    for (const c of ctx.cases) {
      if (c.no_signal_found) continue;
      if (c.case_class !== "Warm" && c.case_class !== "Watchlist") continue;
      if (!buckets.has(c.company)) buckets.set(c.company, []);
      buckets.get(c.company)!.push(c);
    }
    const all = Array.from(buckets.entries())
      .map(([company, rows]) => ({
        company,
        rows: rows.sort((a, b) => b.case_priority - a.case_priority),
        max_priority: Math.max(...rows.map((r) => r.case_priority)),
      }))
      .sort((a, b) => b.max_priority - a.max_priority);
    const q = ctx.companyFilter.trim().toLowerCase();
    return q ? all.filter((g) => g.company.toLowerCase().includes(q)) : all;
  }, [ctx.cases, ctx.companyFilter]);
  return (
    <WatchlistGroupedTable
      groups={groups}
      expanded={ctx.expanded}
      onToggle={ctx.toggleExpand}
      onPatch={ctx.patchCase}
      onCompanyClick={ctx.openDossier}
    />
  );
}

export function CompaniesView() {
  return <CompaniesTab />;
}

export function KontakteView() {
  const ctx = useDashboard();
  return (
    <HubspotCompaniesTable
      query={ctx.hubspotQuery}
      onQueryChange={ctx.setHubspotQuery}
    />
  );
}

export function KampagnenView() {
  const ctx = useDashboard();
  return <CampaignsTab onCountChange={ctx.setCampaignCount} />;
}
