// Extraction layer: Text + Taxonomie -> strukturierte Signale via OpenAI structured outputs.

import OpenAI from "openai";
import type { ExtractionResult } from "./types";

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const DEFAULT_MAX_TEXT_CHARS = Number(process.env.SIGNAL_TEXT_MAX_CHARS) || 40000;

const SIGNAL_IDS = ["C_LEVEL_DEPARTURE", "PE_TRANSACTION", "RESTRUCTURING"] as const;

const SYSTEM_PROMPT = `Du bist "Signal Classifier" fuer b+p Mandate Radar, ein Frueherkennungssystem fuer Executive-Search-Anlaesse.

Deine Aufgabe: Aus dem uebergebenen Quelltext Signale extrahieren, die fuer Executive Search relevant sein KOENNTEN. Lieber ein schwaches Signal mit niedriger Confidence melden als einen echten Hinweis verpassen. b+p filtert spaeter, nicht du.

=== HARTE REGELN (nicht verhandelbar) ===

R1 FIRMENBEZUG
Die evidence_quote muss die Zielfirma NAMENTLICH nennen oder sich unzweideutig auf sie beziehen. Reine Branchen-, Regional- oder Konjunkturberichte, in denen die Firma nur als Mitglied einer Gruppe erscheint ("die Chemieindustrie", "laut IHK-Umfrage", "mittelstaendische Betriebe im Saarland") sind KEIN Signal. Bei Kammern (IHK, HWK) zaehlen nur Meldungen zu deren eigenen Fuehrungspositionen (Praesidium, Hauptgeschaeftsfuehrer); Konjunkturreports der Kammer nicht.

R2 AKTUALITAET
Im User-Prompt wird dir das "Heutige Datum" uebergeben. Berechne Alter immer gegen dieses Datum, nicht gegen Trainingswissen. Nur Ereignisse innerhalb der letzten 365 Tage sind ein aktives Signal.
Setze no_signal_found=true wenn:
  - event_date aelter als 12 Monate ODER
  - kein event_date bestimmbar ODER
  - Publikationsdatum aelter als 12 Monate ODER
  - der Artikel erwaehnt rein rueckblickend ein altes Ereignis ohne aktuellen Anlass.

R3 SIGNAL-IDS
Nur eine dieser drei IDs verwenden: C_LEVEL_DEPARTURE, PE_TRANSACTION, RESTRUCTURING. Nichts anderes.

R4 EVIDENCE
Jedes Signal MUSS eine woertliche evidence_quote aus dem Quelltext enthalten. Keine Paraphrase, keine Umschreibung. Erfinde keine Personen, Datumsangaben, Zahlen. Wenn unklar: Feld auf null.

R5 DEDUP
Wenn mehrere Textstellen dasselbe Ereignis beschreiben (ein CEO-Wechsel in 3 Absaetzen), erzeuge NUR EIN Signal mit der aussagekraeftigsten Quote. Mehrere Signale aus einem Artikel sind nur erlaubt, wenn es wirklich unterschiedliche Ereignisse sind (z.B. PE-Deal UND separater CEO-Wechsel).

=== SIGNAL-ENTSCHEIDUNG ===

C_LEVEL_DEPARTURE: Jede Erwaehnung eines Fuehrungspersonalwechsels - bestaetigt, geplant, geruechtet oder abgeleitet.
PE_TRANSACTION: Investoren-, Uebernahme-, Beteiligungs-, Buyout-, Add-on-, Carve-out- oder Exit-Meldung.
RESTRUCTURING: Sparprogramm, Stellenabbau, Standortschliessung, Insolvenz, Sanierung, Ergebniswarnung, CRO-Suche.

no_signal_found=true wenn keiner der 3 Typen passt, Firmenbezug zu schwach oder Ereignis zu alt.

=== SCORING-KALIBRIERUNG ===

signal_strength (0-100):
  85-95: bestaetigter C-Level-Abgang ohne Nachfolger; PE-Uebernahme mit Mgmt-Austausch; Insolvenzantrag
  65-84: bestaetigter Fuehrungswechsel mit Nachfolger; PE-Mehrheitsbeteiligung; konkrete Sanierungsmassnahme
  45-64: angekuendigte/geplante Veraenderung; Aufsichtsratswechsel; Minderheitsbeteiligung
  25-44: Geruecht; indirekter Bezug; allgemeine Reorganisationsankuendigung
  10-24: sehr schwache Erwaehnung, nur ableitbar

confidence (0-100):
  85+   offizielle Firmenmeldung, Handelsregister, Fachpresse mit Namensnennung
  60-84 Regionalpresse, grosse Onlineportale, Fachpresse ohne Primaerquelle
  30-59 Blog, Social Media, Portal ohne klare Quelle
  <30   sehr vage, Hoerensagen

urgency (0-100): 80+ akut (<=3 Monate), 50-79 kommende 3-6 Monate, 25-49 6-12 Monate, <25 langfristig.
search_relevance (0-100): Wie relevant fuer Executive Search. Bei erkennbarer Firma mindestens 35.
source_quality (1-5): 5=offiziell, 4=Fachpresse, 3=Regional, 2=Portal, 1=Social/Blog.
likely_search_window: "0-3 Monate" | "3-6 Monate" | "6-12 Monate" | "12+ Monate" | "unklar".

event_status: confirmed | reported | rumored | hypothesis.

Sprache der Felder evidence_quote, reasoning, counter_arguments, recommended_action, summary: die des Quelltextes.`;

const RESPONSE_SCHEMA = {
  name: "SignalExtractionResult",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      company_name: { type: "string" },
      language: { type: "string" },
      publication_date: { type: ["string", "null"] },
      no_signal_found: { type: "boolean" },
      summary: { type: "string" },
      source_quality: { type: "integer", minimum: 1, maximum: 5 },
      detected_signals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            signal_id: { type: "string", enum: SIGNAL_IDS },
            subtype: { type: "string" },
            affected_function: { type: ["string", "null"] },
            affected_person: { type: ["string", "null"] },
            event_date: { type: ["string", "null"] },
            event_status: { type: "string", enum: ["confirmed", "reported", "rumored", "hypothesis"] },
            evidence_quote: { type: "string" },
            signal_strength: { type: "integer", minimum: 0, maximum: 100 },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            urgency: { type: "integer", minimum: 0, maximum: 100 },
            search_relevance: { type: "integer", minimum: 0, maximum: 100 },
            likely_search_window: { type: "string" },
            reasoning: { type: "string" },
            counter_arguments: { type: ["string", "null"] },
            recommended_action: { type: "string" },
          },
          required: [
            "signal_id", "subtype", "affected_function", "affected_person",
            "event_date", "event_status", "evidence_quote",
            "signal_strength", "confidence", "urgency", "search_relevance",
            "likely_search_window", "reasoning", "counter_arguments", "recommended_action",
          ],
        },
      },
    },
    required: [
      "company_name", "language", "publication_date",
      "no_signal_found", "summary", "source_quality", "detected_signals",
    ],
  },
} as const;

export type TaxonomyFile = {
  signals: {
    id: string;
    label: string;
    description?: string;
    subtypes?: unknown;
    typical_roles?: unknown;
    grundgewichtung?: unknown;
    base_weight?: unknown;
  }[];
};

export async function extractSignals(input: {
  text: string;
  url: string;
  companyHint: string;
  taxonomy: TaxonomyFile;
  model?: string;
  maxTextChars?: number;
}): Promise<{ model: string; usage: OpenAI.CompletionUsage | undefined; result: ExtractionResult }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY ist nicht gesetzt.");
  }
  if (!input.text || input.text.trim().length < 50) {
    throw new Error("Quelltext zu kurz oder leer.");
  }

  const client = new OpenAI();
  const model = input.model || DEFAULT_MODEL;

  const taxonomyForPrompt = input.taxonomy.signals.map((s) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    subtypes: s.subtypes,
    typical_roles: s.typical_roles,
    grundgewichtung: s.grundgewichtung,
    base_weight: s.base_weight,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const maxTextChars = Number.isFinite(input.maxTextChars) ? (input.maxTextChars as number) : DEFAULT_MAX_TEXT_CHARS;
  const sourceText = input.text.length > maxTextChars ? input.text.slice(0, maxTextChars) : input.text;

  const userPrompt = [
    `Heutiges Datum (fuer Aktualitaetsbewertung): ${today}`,
    `Zielunternehmen (Hypothese aus Kundenliste): ${input.companyHint}`,
    `Quelle-URL: ${input.url}`,
    ``,
    `Signal-Taxonomie (nur diese IDs verwenden):`,
    JSON.stringify(taxonomyForPrompt, null, 2),
    ``,
    `Quelltext:`,
    `"""`,
    sourceText,
    `"""`,
  ].join("\n");

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Leere Antwort vom LLM.");
  return {
    model,
    usage: response.usage,
    result: JSON.parse(raw) as ExtractionResult,
  };
}
