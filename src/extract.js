// Extraction layer: text + taxonomie -> strukturierte Signale.
// Verwendet OpenAI Structured Outputs (json_schema, strict) fuer garantierte Schema-Konformitaet.
//
// Konzeptbezug:
//   - 7 Signalgruppen aus b+p Mandate Radar Konzept Kap. 2.
//   - Zusaetzliche Felder aus Langdock-Vorbild Kap. 5:
//       source_quality (1-5), search_relevance (0-100), recommended_action.
//   - Qualitaetsanforderung: keine Bewertung ohne Quelle/Datum/Evidenztext/Unsicherheit.

import OpenAI from "openai";

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const DEFAULT_MAX_TEXT_CHARS = Number(process.env.SIGNAL_TEXT_MAX_CHARS) || 40000;

const SIGNAL_IDS = [
  "C_LEVEL_DEPARTURE",
  "PE_TRANSACTION",
  "RESTRUCTURING",
];

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

C_LEVEL_DEPARTURE: Jede Erwaehnung eines Fuehrungspersonalwechsels - bestaetigt, geplant, geruechtet oder abgeleitet. Umfasst: neue Berufung, Interimschef, Nachfolgesuche, Freistellung, Aufsichtsratswechsel, Ruecktritt, Vertragsnichtverlaengerung.

PE_TRANSACTION: Investoren-, Uebernahme-, Beteiligungs-, Mehrheits-/Minderheits-, Buyout-, Add-on-, Carve-out- oder Exit-Meldung. Auch Fondsmeldungen mit konkretem Firmenbezug. NICHT: strategische Partnerschaften ohne Kapitalbeteiligung, reine Lieferantenbeziehungen.

RESTRUCTURING: Sparprogramm, Stellenabbau, Standortschliessung, Insolvenz, Sanierung, Ergebniswarnung, Covenant-Bruch, Liquiditaetsproblem, CRO-Suche.

no_signal_found=true wenn:
  - keiner der 3 Typen passt (reine Produkt-, Wachstums-, Veranstaltungs-, Technologiemeldung ohne Fuehrungs-/PE-/Krisenbezug)
  - Firmenbezug zu schwach (siehe R1)
  - Ereignis zu alt oder undatiert (siehe R2)

=== SCORING-KALIBRIERUNG ===

signal_strength (0-100):
  85-95: bestaetigter C-Level-Abgang ohne Nachfolger; PE-Uebernahme mit Mgmt-Austausch; Insolvenzantrag; CRO-Suche
  65-84: bestaetigter Fuehrungswechsel mit Nachfolger; PE-Mehrheitsbeteiligung; konkrete Sanierungsmassnahme mit Namen
  45-64: angekuendigte/geplante Veraenderung; Aufsichtsratswechsel; Minderheitsbeteiligung; Stellenabbau-Welle
  25-44: Geruecht; indirekter Bezug; allgemeine Reorganisationsankuendigung
  10-24: sehr schwache Erwaehnung, nur ableitbar

confidence (0-100):
  85+   offizielle Firmenmeldung, Handelsregister, Fachpresse mit Namensnennung und Zitat
  60-84 Regionalpresse, grosse Onlineportale, Fachpresse ohne Primaerquelle
  30-59 Blog, Social Media, Portal ohne klare Quelle, indirekte Erwaehnung
  <30   sehr vage, Hoerensagen

urgency (0-100): 80+ akut (<=3 Monate), 50-79 kommende 3-6 Monate, 25-49 6-12 Monate, <25 langfristig.
search_relevance (0-100): Wie relevant fuer Executive Search. Bei erkennbarer Firma mindestens 35.
source_quality (1-5): 5=offiziell, 4=Fachpresse, 3=Regional, 2=Portal, 1=Social/Blog.
likely_search_window: "0-3 Monate" | "3-6 Monate" | "6-12 Monate" | "12+ Monate" | "unklar".

event_status:
  confirmed  - offiziell bestaetigt (Firmenmeldung, PM, Handelsregister)
  reported   - Medium meldet, keine offizielle Bestaetigung
  rumored    - Geruecht
  hypothesis - nur aus Kontext abgeleitet, nicht explizit genannt

=== WEITERE REGELN ===

- counter_arguments: Was spricht gegen die Vakanz-Interpretation? (Nachfolger benannt, interne Loesung, temporaere Freistellung). Wenn nichts dagegen spricht, kurz erklaeren warum.
- recommended_action: konkret, z.B. "Research und Partnerpruefung", "Watchlist beobachten", "Sales Navigator Alert setzen", "In 3 Monaten wieder pruefen".
- Ein Ereignis ist noch KEINE Vakanz. reasoning ist eine Bedarfshypothese.
- Sprache der Felder evidence_quote, reasoning, counter_arguments, recommended_action, summary: die des Quelltextes.

=== BEISPIELE ===

Beispiel A (klares C-Level-Signal):
Text: "Die Mueller Industries AG gab heute bekannt, dass CFO Dr. Peter Schmidt das Unternehmen zum Jahresende verlaesst. Ein Nachfolger wurde noch nicht benannt."
-> 1 Signal, C_LEVEL_DEPARTURE, subtype=departure_confirmed, affected_person="Dr. Peter Schmidt", affected_function="CFO", event_status=confirmed, signal_strength ~90, confidence ~90, counter_arguments="Nachfolger noch nicht benannt - koennte intern geloest werden".

Beispiel B (kein Signal, Branchenbezug):
Text: "Laut IHK-Umfrage sehen 60% der saarlaendischen Mittelstaendler die Konjunktur kritisch. Auch die Fuchs Petrolub SE ist Mitglied der IHK."
-> no_signal_found=true. Begruendung: Firma nur als Mitglied einer Gruppe genannt, kein unternehmensspezifisches Ereignis (R1).

Beispiel C (zu altes Ereignis):
Heutiges Datum: 2026-10-12. Text (publication_date 2023-05): "Vor einem Jahr uebernahm CEO Hans Meyer die Leitung der Beta GmbH."
-> no_signal_found=true. Begruendung: Ereignis liegt zu weit zurueck (>12 Monate), kein aktueller Anlass (R2).

Beispiel D (Dedup):
Text: "CEO Meier verlaesst die Firma. [...] Der scheidende Meier war 8 Jahre im Amt. [...] Nach dem Abgang von Meier."
-> NUR EIN Signal, nicht drei (R5).

Beispiel E (zwei echte Signale):
Text: "Die XY GmbH wird von Finanzinvestor Z uebernommen. Im Zuge der Transaktion verlaesst CEO Mueller das Unternehmen."
-> 2 Signale: PE_TRANSACTION (subtype=majority_stake oder pe_entry) UND C_LEVEL_DEPARTURE (subtype=departure_confirmed).`;

const RESPONSE_SCHEMA = {
  name: "SignalExtractionResult",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      company_name: { type: "string" },
      language: { type: "string", description: "ISO-Code des Quelltextes, z.B. de, en" },
      publication_date: {
        type: ["string", "null"],
        description: "ISO-Datum der Meldung wenn im Text erkennbar, sonst null",
      },
      no_signal_found: { type: "boolean" },
      summary: { type: "string", description: "1-3 Saetze Zusammenfassung aus Executive-Search-Sicht" },
      source_quality: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description: "1-5 Bewertung der Quelle (siehe System-Prompt)",
      },
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
            event_date: { type: ["string", "null"], description: "ISO-Datum oder null" },
            event_status: {
              type: "string",
              enum: ["confirmed", "reported", "rumored", "hypothesis"],
            },
            evidence_quote: { type: "string", description: "Woertliches Zitat aus dem Quelltext" },
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
            "signal_id",
            "subtype",
            "affected_function",
            "affected_person",
            "event_date",
            "event_status",
            "evidence_quote",
            "signal_strength",
            "confidence",
            "urgency",
            "search_relevance",
            "likely_search_window",
            "reasoning",
            "counter_arguments",
            "recommended_action",
          ],
        },
      },
    },
    required: [
      "company_name",
      "language",
      "publication_date",
      "no_signal_found",
      "summary",
      "source_quality",
      "detected_signals",
    ],
  },
};

/**
 * @param {object} input
 * @param {string} input.text
 * @param {string} input.url
 * @param {string} input.companyHint
 * @param {object} input.taxonomy
 * @param {object} [opts]
 * @param {string} [opts.model]
 */
export async function extractSignals({ text, url, companyHint, taxonomy }, opts = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY ist nicht gesetzt. Siehe .env.example");
  }
  if (!text || text.trim().length < 50) {
    throw new Error("Quelltext zu kurz oder leer.");
  }

  const client = new OpenAI();
  const model = opts.model || DEFAULT_MODEL;

  const taxonomyForPrompt = taxonomy.signals.map((s) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    subtypes: s.subtypes,
    typical_roles: s.typical_roles,
    grundgewichtung: s.grundgewichtung,
    base_weight: s.base_weight,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const maxTextChars = Number.isFinite(opts.maxTextChars) ? opts.maxTextChars : DEFAULT_MAX_TEXT_CHARS;
  const sourceText = text.length > maxTextChars ? text.slice(0, maxTextChars) : text;

  const userPrompt = [
    `Heutiges Datum (fuer Aktualitaetsbewertung): ${today}`,
    `Zielunternehmen (Hypothese aus Kundenliste): ${companyHint}`,
    `Quelle-URL: ${url}`,
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
    result: JSON.parse(raw),
  };
}
