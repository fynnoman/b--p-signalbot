// Scoring layer: Priority Score pro Signal + Aggregate pro Fall.

import type { DetectedSignal, OpportunityCaseScore, ScoredSignal, ScoringDimensions } from "./types";

const WEIGHTS: Record<keyof ScoringDimensions, number> = {
  signal_strength: 0.35,
  account_fit: 0.25,
  actionability: 0.20,
  confidence: 0.15,
  recency: 0.05,
};

const CLASSES: { name: string; minScore: number; minConfidence?: number }[] = [
  { name: "Hot",       minScore: 75, minConfidence: 70 },
  { name: "Warm",      minScore: 55 },
  { name: "Watchlist", minScore: 35 },
  { name: "Archiv",    minScore: 0  },
];

function recencyScore(isoDate: string | null, refIso: string): number {
  if (!isoDate) return 30;
  const then = new Date(isoDate).getTime();
  const now = new Date(refIso).getTime();
  if (!Number.isFinite(then)) return 30;
  const days = Math.max(0, (now - then) / (1000 * 60 * 60 * 24));
  if (days <= 7) return 100;
  if (days <= 30) return 85;
  if (days <= 90) return 65;
  if (days <= 180) return 45;
  if (days <= 365) return 25;
  return 10;
}

export function scoreSignal(
  signal: DetectedSignal,
  context: { account_fit?: number | null; actionability?: number | null; reference_date?: string } = {},
): ScoredSignal["scoring"] {
  const refDate = context.reference_date ?? new Date().toISOString();
  const dims: ScoringDimensions = {
    signal_strength: signal.signal_strength,
    account_fit: context.account_fit ?? null,
    actionability: context.actionability ?? null,
    confidence: signal.confidence,
    recency: recencyScore(signal.event_date, refDate),
  };

  let weightSum = 0;
  let weighted = 0;
  const missing: string[] = [];
  for (const key of Object.keys(WEIGHTS) as (keyof ScoringDimensions)[]) {
    const value = dims[key];
    const weight = WEIGHTS[key];
    if (value === null || value === undefined) {
      missing.push(key);
      continue;
    }
    weighted += value * weight;
    weightSum += weight;
  }

  const priority = weightSum > 0 ? Math.round(weighted / weightSum) : 0;
  const priorityClass = classify(priority, signal.confidence);

  return {
    priority_score: priority,
    priority_class: priorityClass,
    dimensions: dims,
    missing_dimensions: missing,
    weights: WEIGHTS,
  };
}

function classify(score: number, confidence: number | null): string {
  for (const cls of CLASSES) {
    if (score >= cls.minScore) {
      if (cls.minConfidence && (confidence ?? 0) < cls.minConfidence) continue;
      return cls.name;
    }
  }
  return "Archiv";
}

export function aggregateCase(scoredSignals: ScoredSignal["scoring"][]): OpportunityCaseScore {
  if (scoredSignals.length === 0) {
    return { case_priority: 0, case_class: "Archiv", supporting_signals: 0 };
  }
  const max = Math.max(...scoredSignals.map((s) => s.priority_score));
  const supporting = scoredSignals.filter((s) => s.priority_score >= 55).length;
  const bonus = Math.min(10, Math.max(0, supporting - 1) * 5);
  const casePriority = Math.min(100, max + bonus);
  const bestConfidence = Math.max(...scoredSignals.map((s) => s.dimensions.confidence ?? 0));
  return {
    case_priority: casePriority,
    case_class: classify(casePriority, bestConfidence),
    supporting_signals: supporting,
    bonus_applied: bonus,
  };
}
