import { NextResponse } from "next/server";
import { fetchUsage } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OpenAI-Preise (Stand 09/2026, USD pro 1M Tokens).
// Werte grob aus platform.openai.com Pricing. Anpassen falls andere Modelle im Einsatz.
const PRICING_PER_1M = {
  "gpt-4o-mini":       { input: 0.15, output: 0.60 },
  "gpt-4.1-mini":      { input: 0.40, output: 1.60 },
  "gpt-4o":            { input: 2.50, output: 10.00 },
  "gpt-4.1":           { input: 2.00, output: 8.00 },
} as const;

function costFor(model: string | null, prompt: number, completion: number) {
  const p = model && (PRICING_PER_1M as Record<string, { input: number; output: number }>)[model];
  if (!p) return null;
  return (prompt * p.input + completion * p.output) / 1_000_000;
}

export async function GET() {
  const rows = await fetchUsage();
  const withCost = rows.map((r) => ({
    ...r,
    cost_usd: costFor(r.model, r.total_prompt_tokens, r.total_completion_tokens),
  }));
  const total = withCost.reduce(
    (acc, r) => ({
      prompt: acc.prompt + r.total_prompt_tokens,
      completion: acc.completion + r.total_completion_tokens,
      tokens: acc.tokens + r.total_tokens,
      cost_usd: acc.cost_usd + (r.cost_usd ?? 0),
      cases: acc.cases + r.cases_with_llm,
    }),
    { prompt: 0, completion: 0, tokens: 0, cost_usd: 0, cases: 0 },
  );
  return NextResponse.json({ by_model: withCost, total });
}
