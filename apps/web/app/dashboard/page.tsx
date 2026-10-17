"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface DeckRow {
  id: string;
  title: string;
  format: string;
  status: string;
}

function statusLabel(status: string): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "generating":
      return "Generating";
    case "error":
      return "Needs retry";
    case "outline":
      return "Outline ready";
    default:
      return "Draft";
  }
}

/**
 * The deck dashboard: every deck the signed-in user owns, newest first
 * (the API already scopes to the session). Signed-out visitors bounce to
 * the login form with a `next` back-link.
 */
export default function DashboardPage() {
  const router = useRouter();
  const [decks, setDecks] = useState<DeckRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/deck");
      if (cancelled) return;
      if (res.status === 401) {
        router.replace("/login?next=/dashboard");
        return;
      }
      if (!res.ok) {
        setLoadError("Couldn't load your decks — refresh to try again.");
        return;
      }
      const body = (await res.json().catch(() => null)) as { decks?: DeckRow[] } | null;
      if (!cancelled) setDecks(body?.decks ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <main className="dashboard">
      <header className="dashboard-topbar">
        <Link className="home-brand" href="/" aria-label="Carddeck home">
          <span className="home-brand-mark" aria-hidden="true">
            C
          </span>
          Carddeck
        </Link>
        <div className="dashboard-actions">
          <Link className="btn-primary" href="/new">
            Create new
          </Link>
          <button type="button" className="btn-secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <section aria-labelledby="dashboard-title" className="dashboard-body">
        <h1 id="dashboard-title">Your decks</h1>

        {loadError ? (
          <p className="auth-error" role="alert">
            {loadError}
          </p>
        ) : null}

        {decks === null && !loadError ? <p className="page-note">Loading your decks…</p> : null}

        {decks?.length === 0 ? (
          <div className="dashboard-empty">
            <p>No decks yet — your first one starts with a single prompt.</p>
            <Link className="btn-primary" href="/new">
              Create your first deck
            </Link>
          </div>
        ) : null}

        {decks && decks.length > 0 ? (
          <ul className="deck-grid">
            {decks.map((deck) => (
              <li key={deck.id}>
                <Link className="deck-tile" href={`/deck/${deck.id}`}>
                  <span className="deck-tile-title">{deck.title}</span>
                  <span className="deck-tile-meta">
                    <span className={`deck-badge deck-badge-${deck.status}`}>
                      {statusLabel(deck.status)}
                    </span>
                    <span className="deck-tile-format">{deck.format}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
