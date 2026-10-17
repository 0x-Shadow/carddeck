"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

interface AuthPanelProps {
  mode: "login" | "register";
}

/**
 * Shared sign-in / sign-up form.
 *
 * Posts to the matching auth route and lands on `?next=` (sanitized to a
 * same-app path — never an external URL) or the dashboard. Server-side
 * validation messages (`{ error }`) surface inline in an alert.
 */
export function AuthPanel({ mode }: AuthPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const body = isRegister
      ? {
          name: String(form.get("name") ?? "").trim(),
          email: String(form.get("email") ?? "").trim(),
          password: String(form.get("password") ?? ""),
        }
      : {
          email: String(form.get("email") ?? "").trim(),
          password: String(form.get("password") ?? ""),
        };

    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Something went wrong — try again.");
      setBusy(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <main className="auth-page">
      <header className="home-header">
        <Link className="home-brand" href="/" aria-label="Carddeck home">
          <span className="home-brand-mark" aria-hidden="true">
            C
          </span>
          Carddeck
        </Link>
      </header>

      <section className="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title">{isRegister ? "Create your account" : "Welcome back"}</h1>
        <p className="auth-switch">
          {isRegister ? "Already have an account? " : "New to Carddeck? "}
          <Link href={isRegister ? "/login" : "/register"}>
            {isRegister ? "Sign in" : "Create one"}
          </Link>
        </p>

        <form onSubmit={(e) => void submit(e)} noValidate={false}>
          {isRegister ? (
            <>
              <label htmlFor="auth-name">Name</label>
              <input
                id="auth-name"
                name="name"
                type="text"
                autoComplete="name"
                required
                placeholder="Ada Lovelace"
              />
            </>
          ) : null}

          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />

          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            name="password"
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            required
            minLength={8}
            placeholder={isRegister ? "At least 8 characters" : "Your password"}
          />

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn-primary auth-submit" disabled={busy}>
            {busy ? "Working…" : isRegister ? "Create account" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
