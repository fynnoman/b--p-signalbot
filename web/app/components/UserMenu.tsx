"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";

export default function UserMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await authClient.getSession();
      if (!cancelled) setEmail(data?.user?.email ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function signOut() {
    setBusy(true);
    try {
      await authClient.signOut();
      router.replace("/auth/sign-in");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const initial = email ? email[0]!.toUpperCase() : "?";

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Konto"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "1px solid var(--line)",
          background: "var(--surface-2)",
          color: "var(--ink)",
          fontSize: 13,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            minWidth: 220,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            zIndex: 50,
          }}
        >
          <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink-mute)" }}>
            {email ?? "…"}
          </div>
          <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              borderRadius: 6,
              background: "transparent",
              border: "none",
              fontSize: 13,
              color: "var(--ink)",
              cursor: busy ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {busy ? "Abmelden…" : "Abmelden"}
          </button>
        </div>
      )}
    </div>
  );
}
