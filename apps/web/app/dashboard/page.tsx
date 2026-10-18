"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface DeckRow {
  id: string;
  title: string;
  format: string;
  status: string;
  cardCount?: number;
  shareSlug?: string | null;
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
  const [agentDecks, setAgentDecks] = useState<DeckRow[]>([]);
  const [query, setQuery] = useState("");
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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
      const body = (await res.json().catch(() => null)) as {
        decks?: DeckRow[];
        agentDecks?: DeckRow[];
      } | null;
      if (!cancelled) {
        setDecks(body?.decks ?? []);
        setAgentDecks(body?.agentDecks ?? []);
      }
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

  async function copyForEditing(deckId: string) {
    setCopyingId(deckId);
    setActionError(null);
    try {
      const res = await fetch(`/api/deck/${deckId}/duplicate`, { method: "POST" });
      if (res.status === 401) {
        router.replace("/login?next=/dashboard");
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        deck?: { id: string };
        error?: string;
      } | null;
      if (!res.ok || !body?.deck?.id) {
        setActionError(body?.error ?? "Couldn't create an editable copy. Try again.");
        return;
      }
      router.push(`/deck/${body.deck.id}`);
    } catch {
      setActionError("Couldn't create an editable copy. Check your connection and try again.");
    } finally {
      setCopyingId(null);
    }
  }

  const matchingDecks = (items: DeckRow[]) => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? items.filter((item) => item.title.toLocaleLowerCase().includes(normalized)) : items;
  };
  const ownDecks = decks ? matchingDecks(decks) : null;
  const matchingAgentDecks = matchingDecks(agentDecks);

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
          <Link className="btn-secondary" href="/">
            Home
          </Link>
          <Link className="btn-primary" href="/new">
            Create new
          </Link>
          <button type="button" className="btn-secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <section aria-labelledby="dashboard-title" className="dashboard-body">
        <div className="projects-heading">
          <div>
            <p className="projects-kicker">Carddeck workspace</p>
            <h1 id="dashboard-title">Projects</h1>
          </div>
          <label className="projects-search">
            <span>Search projects</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title"
            />
          </label>
        </div>

        {loadError ? (
          <p className="auth-error" role="alert">
            {loadError}
          </p>
        ) : null}

        {decks === null && !loadError ? <p className="page-note">Loading your decks…</p> : null}

        {actionError ? <p className="auth-error" role="alert">{actionError}</p> : null}

        {decks?.length === 0 && agentDecks.length === 0 ? (
          <div className="dashboard-empty">
            <p>No projects yet. Create a deck here or ask your connected MCP agent to make one.</p>
            <Link className="btn-primary" href="/new">
              Create a project
            </Link>
          </div>
        ) : null}

        {decks && ownDecks?.length === 0 && decks.length > 0 ? (
          <p className="projects-no-results">No projects match “{query}”.</p>
        ) : null}

        {ownDecks && ownDecks.length > 0 ? (
          <section className="project-section" aria-labelledby="your-projects-title">
            <div className="project-section-heading">
              <div>
                <h2 id="your-projects-title">Your projects</h2>
                <p>{ownDecks.length} {ownDecks.length === 1 ? "project" : "projects"}</p>
              </div>
            </div>
          <ul className="deck-grid">
            {ownDecks.map((deck) => (
              <li key={deck.id}>
                <article className="deck-tile">
                  <Link className="deck-tile-title" href={`/deck/${deck.id}`}>{deck.title}</Link>
                  <span className="deck-tile-meta">
                    <span className={`deck-badge deck-badge-${deck.status}`}>
                      {statusLabel(deck.status)}
                    </span>
                    <span className="deck-tile-format">
                      {deck.cardCount ?? 0} slides · {deck.format}
                    </span>
                  </span>
                  <span className="project-tile-actions">
                    <Link className="project-action" href={`/deck/${deck.id}`}>Edit</Link>
                    <a className="project-action" href={`/api/deck/${deck.id}/export/pptx`}>Download PPTX</a>
                  </span>
                </article>
              </li>
            ))}
          </ul>
          </section>
        ) : null}

        <section className="project-section" aria-labelledby="agent-projects-title">
          <div className="project-section-heading">
            <div>
              <h2 id="agent-projects-title">From your MCP agent</h2>
              <p>Preview or download originals. Copy a project to make it yours and edit it.</p>
            </div>
            <span className="project-count">{matchingAgentDecks.length}</span>
          </div>
          {decks !== null && matchingAgentDecks.length === 0 ? (
            <p className="projects-no-results">
              {agentDecks.length === 0
                ? "Agent-created projects will appear here when they are shared by your MCP server."
                : `No agent projects match “${query}”.`}
            </p>
          ) : null}
          {matchingAgentDecks.length > 0 ? (
            <ul className="deck-grid">
              {matchingAgentDecks.map((deck) => (
                <li key={deck.id}>
                  <article className="deck-tile agent-project-tile">
                    <span className="deck-tile-title">{deck.title}</span>
                    <span className="deck-tile-meta">
                      <span className={`deck-badge deck-badge-${deck.status}`}>
                        {statusLabel(deck.status)}
                      </span>
                      <span className="deck-tile-format">
                        {deck.cardCount ?? 0} slides · {deck.format}
                      </span>
                    </span>
                    <span className="project-tile-actions">
                      {deck.shareSlug ? (
                        <Link className="project-action" href={`/view/${deck.shareSlug}`}>Preview</Link>
                      ) : null}
                      <a
                        className="project-action"
                        href={`/api/deck/${deck.id}/export/pptx`}
                        aria-disabled={deck.status !== "ready"}
                        onClick={(event) => { if (deck.status !== "ready") event.preventDefault(); }}
                      >
                        Download PPTX
                      </a>
                      <button
                        className="project-action project-action-primary"
                        type="button"
                        disabled={deck.status !== "ready" || copyingId === deck.id}
                        onClick={() => void copyForEditing(deck.id)}
                      >
                        {copyingId === deck.id ? "Copying…" : "Copy & edit"}
                      </button>
                    </span>
                  </article>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </section>
    </main>
  );
}
