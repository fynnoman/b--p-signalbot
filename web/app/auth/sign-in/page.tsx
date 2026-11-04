"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ALLOWED_EMAIL_DOMAIN, authClient, isAllowedEmail } from "@/lib/auth/client";

type Phase = "email" | "otp";

function SignInInner() {
  const router = useRouter();
  const params = useSearchParams();
  const reason = params.get("reason");

  const [phase, setPhase] = useState<Phase>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (reason === "domain") {
      setError(`Dieses Portal ist nur für @${ALLOWED_EMAIL_DOMAIN}-Accounts.`);
    }
  }, [reason]);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const normalized = email.trim().toLowerCase();
    if (!isAllowedEmail(normalized)) {
      setError(`Nur E-Mail-Adressen auf @${ALLOWED_EMAIL_DOMAIN} sind erlaubt.`);
      return;
    }
    setBusy(true);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email: normalized,
        type: "sign-in",
      });
      if (error) {
        setError(error.message || "Senden fehlgeschlagen.");
        return;
      }
      setEmail(normalized);
      setPhase("otp");
      setNotice(`Code an ${normalized} gesendet. Gültig 5 Minuten.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error } = await authClient.signIn.emailOtp({
        email,
        otp: otp.trim(),
      });
      if (error) {
        setError(error.message || "Code ungültig.");
        return;
      }
      router.replace("/hot");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
    } finally {
      setBusy(false);
    }
  }

  async function resendOtp() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      if (error) {
        setError(error.message || "Senden fehlgeschlagen.");
      } else {
        setNotice(`Neuer Code an ${email} gesendet.`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm card p-8 space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">b+p Mandate Radar</h1>
          <p className="text-sm text-[color:var(--ink-mute)]">
            Login mit deiner @{ALLOWED_EMAIL_DOMAIN}-Adresse. Es wird ein 6-stelliger Code per E-Mail verschickt.
          </p>
        </header>

        {error && (
          <div className="text-sm rounded-md border border-[color:var(--hot-border)] bg-[color:var(--hot-bg)] text-[color:var(--hot)] px-3 py-2">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="text-sm rounded-md border border-[color:var(--line)] bg-[color:var(--surface-2)] text-[color:var(--ink-2)] px-3 py-2">
            {notice}
          </div>
        )}

        {phase === "email" && (
          <form onSubmit={requestOtp} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                E-Mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`name@${ALLOWED_EMAIL_DOMAIN}`}
                className="input w-full"
                disabled={busy}
              />
            </div>
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? "Senden…" : "Code anfordern"}
            </button>
          </form>
        )}

        {phase === "otp" && (
          <form onSubmit={verifyOtp} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="otp" className="text-sm font-medium">
                6-stelliger Code
              </label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="input w-full tracking-widest text-center text-lg"
                disabled={busy}
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary w-full" disabled={busy || otp.length < 6}>
              {busy ? "Prüfe…" : "Einloggen"}
            </button>
            <div className="flex items-center justify-between text-xs text-[color:var(--ink-mute)]">
              <button
                type="button"
                className="underline underline-offset-2 hover:text-[color:var(--ink-2)]"
                onClick={() => {
                  setPhase("email");
                  setOtp("");
                  setNotice(null);
                  setError(null);
                }}
                disabled={busy}
              >
                Andere E-Mail
              </button>
              <button
                type="button"
                className="underline underline-offset-2 hover:text-[color:var(--ink-2)]"
                onClick={resendOtp}
                disabled={busy}
              >
                Code erneut senden
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}
