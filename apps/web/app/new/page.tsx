"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemePicker } from "@/components/theme/ThemePicker";

type Phase = "setup" | "working" | "outline";
type Mode = "prompt" | "paste";

interface OutlineCard {
  id: string;
  title: string;
}

interface DeckPayload {
  deck: { id: string; title: string; themeId: string; format: string; status: string };
  cards: Array<{ id: string; title: string; position: number }>;
}

const NUM_CARD_OPTIONS = ["3", "4", "5", "6", "8", "10", "12", "15", "20"];

const TONE_OPTIONS = [
  { value: "", label: "Default" },
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "bold", label: "Bold" },
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Deck title fallback: the prompt's first few words. */
function deriveTitle(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 8).join(" ");
  return (words || "Untitled deck").slice(0, 60);
}

/** "1. Section" / "- Section" / "• Section" → "Section" (one leading marker). */
function cleanCardLine(line: string): string {
  return line.replace(/^([-*•]|\d+[.)])\s+/, "").trim();
}

/**
 * The creation flow (Gamma's "New deck"): collect the brief, draft an outline
 * with the worker, let the user reshape it and pick a theme, then hand off to
 * the deck page, which streams the generated cards in over SSE.
 *
 * Nothing here calls a model — outline generation is an enqueued job polled to
 * completion, so the flow survives slow providers and page reloads (a reload
 * mid-run re-enters at the deck page, which re-attaches idempotently).
 */
export default function NewDeckPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("setup");
  const [mode, setMode] = useState<Mode>("prompt");
  const [prompt, setPrompt] = useState("");
  const [paste, setPaste] = useState("");
  const [numCards, setNumCards] = useState("8");
  const [tone, setTone] = useState("");
  const [format, setFormat] = useState("presentation");

  const [deckId, setDeckId] = useState<string | null>(null);
  const [deckTitle, setDeckTitle] = useState("");
  const [themeId, setThemeId] = useState("");
  const [outline, setOutline] = useState<OutlineCard[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced PATCH queue: renames land 400ms after the last keystroke, but
  // are flushed synchronously before the flow navigates away — otherwise a
  // quick "Generate outline → rename → Generate deck" would silently drop the
  // rename (the deck page re-reads titles from the server).
  const deckIdRef = useRef<string | null>(null);
  const pendingCardRenames = useRef(new Map<string, string>());
  const pendingDeckTitle = useRef<string | null>(null);
  const renameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  function setDeck(id: string | null) {
    deckIdRef.current = id;
    setDeckId(id);
  }

  /** Persist every queued rename now; resolves when the PATCHes settle. */
  async function flushRenames(): Promise<void> {
    if (renameTimer.current) {
      clearTimeout(renameTimer.current);
      renameTimer.current = null;
    }
    if (titleTimer.current) {
      clearTimeout(titleTimer.current);
      titleTimer.current = null;
    }
    const id = deckIdRef.current;
    const jobs: Promise<unknown>[] = [];
    for (const [cardId, title] of pendingCardRenames.current) {
      if (!id) continue;
      jobs.push(
        fetch(`/api/deck/${id}/cards/${cardId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title }),
        }),
      );
    }
    pendingCardRenames.current.clear();
    const deckTitleQueued = pendingDeckTitle.current;
    if (id && deckTitleQueued !== null) {
      jobs.push(
        fetch(`/api/deck/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: deckTitleQueued }),
        }),
      );
      pendingDeckTitle.current = null;
    }
    await Promise.all(jobs);
  }

  function queueFlush() {
    if (renameTimer.current) clearTimeout(renameTimer.current);
    renameTimer.current = setTimeout(() => {
      renameTimer.current = null;
      void flushRenames();
    }, 400);
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Last-chance save for edits still in the debounce window.
      void flushRenames();
      if (renameTimer.current) clearTimeout(renameTimer.current);
      if (titleTimer.current) clearTimeout(titleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Session guard: creation needs an owner; bounce signed-out visitors.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/deck");
      if (res.status === 401) router.replace("/login?next=/new");
    })();
  }, [router]);

  async function waitForJob(jobId: string): Promise<{ status: string; error?: string | null }> {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const res = await fetch(`/api/generation/${jobId}`);
      if (!res.ok) throw new Error("Lost track of the outline job.");
      const body = (await res.json()) as { status: string; error?: string | null };
      if (body.status === "done" || body.status === "error" || body.status === "cancelled") {
        return body;
      }
      await sleep(400);
    }
    throw new Error("Outline generation timed out.");
  }

  async function createDeck(title: string): Promise<string> {
    const res = await fetch("/api/deck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, format }),
    });
    if (!res.ok) throw new Error("Couldn't create the deck.");
    const body = (await res.json()) as { deck: { id: string } };
    return body.deck.id;
  }

  async function loadOutline(id: string): Promise<void> {
    const res = await fetch(`/api/deck/${id}`);
    if (!res.ok) throw new Error("Couldn't load the outline.");
    const body = (await res.json()) as DeckPayload;
    if (!alive.current) return;
    setDeck(body.deck.id);
    setDeckTitle(body.deck.title);
    setThemeId(body.deck.themeId);
    setOutline(body.cards.map((card) => ({ id: card.id, title: card.title })));
  }

  /** Prompt mode: create → enqueue outline → wait → edit. */
  async function startOutline(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim()) {
      setError("Describe what your deck should be about.");
      return;
    }
    setBusy(true);
    setError(null);
    setPhase("working");
    let id: string | null = null;
    try {
      id = await createDeck(deriveTitle(prompt));
      const res = await fetch(`/api/deck/${id}/outline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), numCards: Number(numCards), tone: tone || undefined }),
      });
      const body = (await res.json().catch(() => null)) as { jobId?: string; error?: string } | null;
      if (!res.ok || !body?.jobId) throw new Error(body?.error ?? "Couldn't start the outline.");
      const job = await waitForJob(body.jobId);
      if (job.status !== "done") throw new Error(job.error ?? "Outline generation failed.");
      await loadOutline(id);
      setPhase("outline");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      // Keep any created draft reachable instead of orphaning it silently.
      if (id) setDeck(id);
      if (alive.current) setPhase("setup");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  /** Paste mode: one title per line → cards straight into a run. */
  async function startPaste(event: FormEvent) {
    event.preventDefault();
    const lines = paste
      .split("\n")
      .map(cleanCardLine)
      .filter(Boolean);
    if (lines.length === 0) {
      setError("Add at least one card title, one per line.");
      return;
    }
    if (lines.length > 30) {
      setError("A deck can hold at most 30 cards.");
      return;
    }
    setBusy(true);
    setError(null);
    let id: string | null = null;
    try {
      id = await createDeck(deriveTitle(lines[0]));
      for (const title of lines) {
        const res = await fetch(`/api/deck/${id}/cards`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) throw new Error(`Couldn't add the card "${title}".`);
      }
      const res = await fetch(`/api/deck/${id}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Couldn't start generation.");
      router.push(`/deck/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      if (id) {
        setDeck(id);
        setDeckTitle(deriveTitle(lines[0]));
      }
      if (alive.current) setBusy(false);
    }
  }

  function renameCard(cardId: string, title: string) {
    setOutline((prev) => prev.map((card) => (card.id === cardId ? { ...card, title } : card)));
    pendingCardRenames.current.set(cardId, title);
    queueFlush();
  }

  async function addCard() {
    if (!deckId) return;
    const res = await fetch(`/api/deck/${deckId}/cards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New card" }),
    });
    if (!res.ok) {
      setError("Couldn't add a card.");
      return;
    }
    const body = (await res.json()) as { card: { id: string; title: string } };
    setOutline((prev) => [...prev, { id: body.card.id, title: body.card.title }]);
  }

  async function removeCard(cardId: string) {
    if (!deckId) return;
    setOutline((prev) => prev.filter((card) => card.id !== cardId));
    await fetch(`/api/deck/${deckId}/cards/${cardId}`, { method: "DELETE" });
  }

  function renameDeck(title: string) {
    setDeckTitle(title);
    pendingDeckTitle.current = title;
    queueFlush();
  }

  /** Kick off content generation; the deck page streams the results. */
  async function generate() {
    if (!deckId) return;
    // Persist queued outline edits first — the deck page re-reads them.
    await flushRenames();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deck/${deckId}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Couldn't start generation.");
      }
      router.push(`/deck/${deckId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      if (alive.current) setBusy(false);
    }
  }

  return (
    <main className="new-page">
      <header className="dashboard-topbar">
        <Link className="home-brand" href="/" aria-label="Carddeck home">
          <span className="home-brand-mark" aria-hidden="true">
            C
          </span>
          Carddeck
        </Link>
        <div className="dashboard-actions">
          <Link className="btn-secondary" href="/dashboard">
            ← Decks
          </Link>
        </div>
      </header>

      {phase === "setup" ? (
        <section className="new-form-card" aria-labelledby="new-title">
          <h1 id="new-title">Create a deck</h1>

          <fieldset className="new-modes">
            <legend>Mode</legend>
            <label>
              <input
                type="radio"
                name="mode"
                value="prompt"
                checked={mode === "prompt"}
                onChange={() => setMode("prompt")}
              />
              Prompt
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                value="paste"
                checked={mode === "paste"}
                onChange={() => setMode("paste")}
              />
              Paste outline
            </label>
          </fieldset>

          <form onSubmit={(e) => void (mode === "prompt" ? startOutline(e) : startPaste(e))}>
            {mode === "prompt" ? (
              <>
                <label htmlFor="new-prompt">What is your deck about?</label>
                <textarea
                  id="new-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  maxLength={4000}
                  placeholder="Launch our developer platform in Europe — audience of prospective customers and partners."
                  required
                />
              </>
            ) : (
              <>
                <label htmlFor="new-paste">One card title per line</label>
                <textarea
                  id="new-paste"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={8}
                  placeholder={"The European opportunity\nWhy now\nLaunch plan\nNext steps"}
                  required
                />
              </>
            )}

            <div className="new-options">
              <p>
                <label htmlFor="new-format">Format</label>
                <select id="new-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="presentation">Presentation</option>
                  <option value="document">Document</option>
                </select>
              </p>

              {mode === "prompt" ? (
                <>
                  <p>
                    <label htmlFor="new-num-cards">Number of cards</label>
                    <select
                      id="new-num-cards"
                      value={numCards}
                      onChange={(e) => setNumCards(e.target.value)}
                    >
                      {NUM_CARD_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </p>
                  <p>
                    <label htmlFor="new-tone">Tone</label>
                    <select id="new-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
                      {TONE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </p>
                </>
              ) : null}
            </div>

            {error ? (
              <p className="auth-error" role="alert">
                {error}
                {deckId ? (
                  <>
                    {" "}
                    <Link href={`/deck/${deckId}`}>Open the draft deck</Link>
                  </>
                ) : null}
              </p>
            ) : null}

            <button type="submit" className="btn-primary" disabled={busy}>
              {busy
                ? mode === "prompt"
                  ? "Drafting outline…"
                  : "Creating…"
                : mode === "prompt"
                  ? "Generate outline"
                  : "Create deck"}
            </button>
          </form>
        </section>
      ) : phase === "working" ? (
        <section className="new-working" aria-live="polite">
          <h1>Drafting your outline…</h1>
          <p className="page-note" role="status">
            Shaping {numCards} sections from your prompt — this takes a moment.
          </p>
        </section>
      ) : (
        <section className="new-outline" aria-labelledby="outline-title">
          <h1 id="outline-title">Shape your outline</h1>
          <p className="page-note">
            Rename sections, drop what you don't need, then generate the deck.
          </p>

          <p className="new-title-row">
            <label htmlFor="new-deck-title">Deck title</label>
            <input
              id="new-deck-title"
              value={deckTitle}
              onChange={(e) => renameDeck(e.target.value)}
            />
          </p>

          <ol className="outline-list">
            {outline.map((card, index) => (
              <li key={card.id}>
                <span className="outline-index" aria-hidden="true">
                  {index + 1}
                </span>
                <input
                  aria-label={`Outline card ${index + 1} title`}
                  value={card.title}
                  onChange={(e) => renameCard(card.id, e.target.value)}
                />
                <button
                  type="button"
                  className="outline-remove"
                  aria-label={`Remove card ${index + 1}`}
                  onClick={() => void removeCard(card.id)}
                  disabled={outline.length <= 1}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>

          <button type="button" className="btn-secondary" onClick={() => void addCard()}>
            Add card
          </button>

          <fieldset className="outline-theme">
            <legend>Theme</legend>
            {deckId ? (
              <ThemePicker deckId={deckId} themeId={themeId} onChange={setThemeId} />
            ) : null}
          </fieldset>

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="outline-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                void flushRenames();
                setPhase("setup");
                setError(null);
              }}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void generate()}
              disabled={busy || outline.length === 0}
            >
              {busy ? "Starting…" : "Generate deck"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
