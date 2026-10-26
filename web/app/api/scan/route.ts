import { runSingleScan, type JobMode } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    if (request.headers.get("content-length")) body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const b = body as { company?: unknown; limit?: unknown; mode?: unknown; stream?: unknown };
  const company = typeof b.company === "string" ? b.company : "";
  if (!company.trim()) {
    return new Response(JSON.stringify({ error: "company fehlt" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const limit = typeof b.limit === "number" ? b.limit : 5;
  const mode: JobMode = b.mode === "broad" ? "broad" : "focused";
  const wantsStream = b.stream === true || request.headers.get("accept")?.includes("application/x-ndjson");

  if (!wantsStream) {
    try {
      const job = await runSingleScan({ company, limit, mode });
      return new Response(JSON.stringify(job), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Unbekannter Fehler" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(JSON.stringify({ ...event, t: Date.now() - startedAt }) + "\n"),
        );
      };

      emit({ type: "start", company, limit, mode });

      try {
        const job = await runSingleScan({
          company, limit, mode,
          onEvent: (ev) => emit(ev as unknown as Record<string, unknown>),
        });
        emit({ type: "done", job });
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
