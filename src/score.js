// Scoring layer: erzeugt Priority Score gem. Konzept Kapitel 3.
//
// Priority Score = 0.35*SignalStrength + 0.25*AccountFit + 0.20*Actionability + 0.15*Confidence + 0.05*Recency
//
// Fuer den Prototyp koennen AccountFit und Actionability noch fehlen (kommen erst mit HubSpot in Phase 2).
// Fehlende Dimensionen werden fair behandelt: das Gewicht wird ueber die vorhandenen Dimensionen
// proportional neu verteilt, damit der Score interpretierbar bleibt.

const WEIGHTS = {
  signal_strength: 0.35,
  account_fit: 0.25,
  actionability: 0.20,
  confidence: 0.15,
  recency: 0.05,
};

const CLASSES = [
  { name: "Hot",       minScore: 75, minConfidence: 70 },
  { name: "Warm",      minScore: 55 },
  { name: "Watchlist", minScore: 35 },
  { name: "Archiv",    minScore: 0  },
];

/**
 * @param {string|null} isoDate
 * @param {string} refIso
 * @returns {number} 0-100
 */
function recencyScore(isoDate, refIso = new Date().toISOString()) {
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

/**
 * @param {object} signal - ein Eintrag aus detected_signals
 * @param {object} [context]
 * @param {number|null} [context.account_fit] - 0-100, spaeter aus HubSpot / Zielkundenprofil
 * @param {number|null} [context.actionability] - 0-100, spaeter aus Beziehungsdaten (Warm Path)
 * @param {string} [context.reference_date] - ISO, Default: jetzt
 */
export function scoreSignal(signal, context = {}) {
  const dims = {
    signal_strength: signal.signal_strength,
    account_fit: context.account_fit ?? null,
    actionability: context.actionability ?? null,
    confidence: signal.confidence,
    recency: recencyScore(signal.event_date, context.reference_date),
  };

  let weightSum = 0;
  let weighted = 0;
  const missing = [];
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const value = dims[key];
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

function classify(score, confidence) {
  for (const cls of CLASSES) {
    if (score >= cls.minScore) {
      if (cls.minConfidence && (confidence ?? 0) < cls.minConfidence) continue;
      return cls.name;
    }
  }
  return "Archiv";
}

/**
 * Aggregiert mehrere Signale eines Falls zu einem Opportunity-Case-Score.
 * Simple Regel fuer den Prototyp: max(priority) mit Bonus fuer mehrere bestaetigende Signale.
 */
export function aggregateCase(scoredSignals) {
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
