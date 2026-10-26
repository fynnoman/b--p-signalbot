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
  const s = Math.max(0, Math.round((end - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m}m ${rest.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`;
}

export function formatTimeShort(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: DATE_TZ });
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
  const k = cls.toLowerCase();
  if (k === "hot") return "hot";
  if (k === "warm") return "warm";
  if (k === "watchlist") return "watch";
  return "archiv";
}

export function timelineToneForClass(cls: string) {
  const k = cls.toLowerCase();
  if (k === "hot") return "hot";
  if (k === "warm") return "warm";
  if (k === "watchlist") return "watch";
  return "muted";
}

export function filterByCompany<T extends { company: string }>(rows: T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) => r.company.toLowerCase().includes(s));
}
