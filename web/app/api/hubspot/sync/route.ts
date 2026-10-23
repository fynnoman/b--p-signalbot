import { syncCompanies, syncContacts } from "@/lib/hubspot-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED_ONLY = ["all", "both", "companies", "contacts"] as const;
type OnlyMode = (typeof ALLOWED_ONLY)[number];

export async function POST(request: Request) {
  let body: unknown = {};
  try { if (request.headers.get("content-length")) body = await request.json(); }
  catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const b = body as { only?: unknown; types?: unknown };
  const onlyRaw = typeof b.only === "string" ? b.only : "both";
  if (!ALLOWED_ONLY.includes(onlyRaw as OnlyMode)) {
    return new Response(JSON.stringify({ error: `invalid only (allowed: ${ALLOWED_ONLY.join(", ")})` }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const only = onlyRaw as OnlyMode;
  const typesRaw = typeof b.types === "string" && b.types.trim() ? b.types.trim() : null;
  const acceptedTypes = typesRaw ? typesRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify({ ...event, t: Date.now() - startedAt }) + "\n"));
      };

      emit({ type: "start", only, acceptedTypes });

      try {
        if (only === "all" || only === "both" || only === "companies") {
          emit({ type: "phase", phase: "companies", label: "Firmen werden geladen" });
          const r = await syncCompanies({
            acceptedTypes,
            onProgress: (p) => emit({ type: "progress", phase: "companies", inserted: p.inserted, skipped: p.skipped }),
          });
          emit({ type: "phase_done", phase: "companies", inserted: r.inserted, skipped: r.skipped });
        }
        if (only === "all" || only === "both" || only === "contacts") {
          emit({ type: "phase", phase: "contacts", label: "Kontakte werden geladen" });
          const r = await syncContacts({
            onProgress: (p) => emit({ type: "progress", phase: "contacts", inserted: p.inserted }),
          });
          emit({ type: "phase_done", phase: "contacts", inserted: r.inserted, refreshed_targets: r.refreshed_targets });
        }
        emit({ type: "done" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: "error", message: msg });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
