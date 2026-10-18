"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  PRESET_THEMES,
  parseMotionPlan,
  type Block,
  type MotionPreset,
  type Theme,
} from "@carddeck/core";
import {
  CardCanvas,
  type CanvasCard,
  type CanvasDeck,
} from "@/components/editor/CardCanvas";
import { GenerationView } from "@/components/editor/GenerationView";
import { ThemePicker } from "@/components/theme/ThemePicker";
import { MotionPicker } from "@/components/editor/MotionPicker";
import { ShareControl } from "@/components/share/ShareControl";
import { ExportMenu } from "@/components/share/ExportMenu";

interface DeckResponse {
  deck: CanvasDeck & { shareSlug?: string | null; isPublic?: number; motion?: string | null };
  cards: CanvasCard[];
  theme?: Theme | null;
}

type DeckWithShare = CanvasDeck & {
  shareSlug?: string | null;
  isPublic?: number;
  motion?: string | null;
};

type PageState = "loading" | "ready" | "unauthorized" | "missing";
type SaveState = "idle" | "saving" | "error";

/**
 * The deck editor: one long scroll of card surfaces (Gamma's canvas), each
 * editable in place. Card content is fetched once and then edited optimistically
 * — every keystroke updates local state immediately and PATCHes the API on a
 * short debounce, so editing never waits on the network.
 *
 * Deck status drives which surface is shown:
 *
 * - `generating` → attach to the run's SSE stream (idempotent POST, so a
 *   refresh re-attaches to the live job instead of starting a second one);
 * - `outline` / `draft`-with-cards → the not-yet-generated canvas with a
 *   **Generate content** action;
 * - `draft` with no cards → a CTA back into the creation flow;
 * - `error` → per-card Retry buttons plus a whole-deck retry banner;
 * - `ready` → the plain editing canvas.
 */
export default function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [deck, setDeck] = useState<DeckWithShare | null>(null);
  const [cards, setCards] = useState<CanvasCard[]>([]);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Card showing the AI refine panel (at most one).
  const [refiningCardId, setRefiningCardId] = useState<string | null>(null);
  // Deck's motion preset (the server owns the full plan; this mirrors it).
  const [motionPreset, setMotionPreset] = useState<MotionPreset>("none");

  // Debounce timers live in refs so re-renders (every keystroke) don't reset them.
  const titleTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Latest queued title per card, so a flush can persist without a render.
  const pendingTitleEdits = useRef(new Map<string, string>());
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of activeJobId for closures that outlive their render (timers).
  const activeJobRef = useRef<string | null>(null);

  function setJob(jobId: string | null) {
    activeJobRef.current = jobId;
    setActiveJobId(jobId);
  }

  function applyDeck(body: DeckResponse) {
    setDeck(body.deck);
    setCards(body.cards);
    setTheme(body.theme ?? null);
    setMotionPreset(parseMotionPlan(body.deck.motion)?.preset ?? "none");
  }

  async function fetchDeck(): Promise<DeckResponse | null> {
    const res = await fetch(`/api/deck/${id}`);
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as DeckResponse | null;
  }

  /**
   * Ask the server for a run and attach to it.
   *
   * `POST /generate` is idempotent per (deck, stage): while a cards job is
   * live it returns the *same* jobId, so attaching after a refresh can never
   * double-start a run. A 409 means an outline job is still in flight —
   * schedule a slow re-check instead of spinning.
   */
  async function attachGeneration(): Promise<void> {
    const res = await fetch(`/api/deck/${id}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { jobId?: string } | null;
      if (body?.jobId) {
        setActionError(null);
        setJob(body.jobId);
        return;
      }
    }
    if (res.status === 409) {
      scheduleReload();
      return;
    }
    setActionError("Couldn't start generation. Try again.");
  }

  function scheduleReload() {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(() => {
      pollTimer.current = null;
      void reload();
    }, 1000);
  }

  async function reload(): Promise<void> {
    const body = await fetchDeck();
    if (!body) return;
    applyDeck(body);
    // Landed mid-run (fresh tab, outline just finished): attach now.
    if (body.deck.status === "generating" && !activeJobRef.current) {
      void attachGeneration();
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/deck/${id}`);
      if (cancelled) return;
      if (res.status === 401) return setPageState("unauthorized");
      if (res.status === 404 || !res.ok) return setPageState("missing");
      const body = (await res.json()) as DeckResponse;
      if (cancelled) return;
      applyDeck(body);
      setPageState("ready");
      // Mid-run tab: stream the remaining cards in.
      if (body.deck.status === "generating") void attachGeneration();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(
    () => () => {
      for (const timer of titleTimers.current.values()) clearTimeout(timer);
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  const effectiveTheme = theme ?? PRESET_THEMES[0];

  async function patch(url: string, body: unknown): Promise<boolean> {
    setSaveState("saving");
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaveState(res.ok ? "idle" : "error");
    return res.ok;
  }

  function editCard(cardId: string, blocks: Block[]) {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, blocks: JSON.stringify(blocks) } : c)),
    );
    void patch(`/api/deck/${id}/cards/${cardId}`, { blocks });
  }

  function editCardTitle(cardId: string, title: string) {
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, title } : c)));
    pendingTitleEdits.current.set(cardId, title);
    const existing = titleTimers.current.get(cardId);
    if (existing) clearTimeout(existing);
    titleTimers.current.set(
      cardId,
      setTimeout(() => {
        titleTimers.current.delete(cardId);
        const queued = pendingTitleEdits.current.get(cardId);
        pendingTitleEdits.current.delete(cardId);
        if (queued !== undefined) {
          void patch(`/api/deck/${id}/cards/${cardId}`, { title: queued });
        }
      }, 500),
    );
  }

  /**
   * Persist in-flight debounced title edits right now.
   *
   * Generation reads card titles from the database, so a rename still inside
   * its 500ms debounce would otherwise be ignored by the run the user just
   * started with that very title on screen.
   */
  function flushTitleEdits() {
    for (const timer of titleTimers.current.values()) clearTimeout(timer);
    titleTimers.current.clear();
    for (const [cardId, title] of pendingTitleEdits.current) {
      void patch(`/api/deck/${id}/cards/${cardId}`, { title });
    }
    pendingTitleEdits.current.clear();
  }

  function changeTheme(themeId: string) {
    setDeck((prev) => (prev ? { ...prev, themeId } : prev));
    // ThemePicker offers presets, so the new skin always resolves from them.
    setTheme(PRESET_THEMES.find((th) => th.id === themeId) ?? null);
  }

  /** Stream end: re-read the authoritative deck (status was settled first by
   * the worker/route, so this can't bounce back into "generating"). */
  async function generationDone() {
    setJob(null);
    await reload();
  }

  if (pageState === "loading") {
    return (
      <main className="page-shell">
        <p className="page-note">Loading deck…</p>
      </main>
    );
  }

  if (pageState === "unauthorized" || pageState === "missing") {
    return (
      <main className="page-shell">
        <h1>{pageState === "unauthorized" ? "Sign in to open this deck" : "Deck not found"}</h1>
        <p className="page-note">
          {pageState === "unauthorized"
            ? "This deck belongs to another account (or you need to sign in)."
            : "It may have been deleted, or the link is wrong."}
        </p>
        <Link className="btn-primary" href="/">
          Go to Carddeck
        </Link>
      </main>
    );
  }

  // Outline stage: cards exist but have no content yet (also covers a stopped
  // run, which returns the deck to "outline" with partial content kept).
  const outlineMode =
    !activeJobId &&
    (deck!.status === "outline" || (deck!.status === "draft" && cards.length > 0));
  const emptyDraft = !activeJobId && deck!.status === "draft" && cards.length === 0;
  const attachPending = !activeJobId && deck!.status === "generating";

  return (
    <main className="deck-page">
      <header className="deck-topbar">
        <div className="deck-topbar-left">
          <Link href="/dashboard" className="deck-back">
            ← Decks
          </Link>
          <h1 className="deck-heading">{deck!.title}</h1>
          <span className={`save-indicator save-${saveState}`} aria-live="polite">
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : ""}
          </span>
        </div>
        <div className="deck-topbar-right">
          <Link className="btn-secondary" href={`/deck/${id}/present`}>
            Present
          </Link>
          <ShareControl
            deckId={id}
            isPublic={deck!.isPublic === 1}
            shareSlug={deck!.shareSlug ?? null}
          />
          <ExportMenu deckId={id} deckTitle={deck!.title} />
          <ThemePicker deckId={id} themeId={deck!.themeId} onChange={changeTheme} />
          <MotionPicker deckId={id} preset={motionPreset} onChange={setMotionPreset} />
        </div>
      </header>

      {actionError ? (
        <p className="deck-alert" role="alert">
          {actionError}
        </p>
      ) : null}

      {deck!.status === "error" && !activeJobId ? (
        <div className="deck-alert" role="alert">
          <p>Generation finished with errors — some cards failed.</p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              flushTitleEdits();
              void attachGeneration();
            }}
          >
            Retry failed cards
          </button>
        </div>
      ) : null}

      {attachPending ? (
        <p className="page-note" role="status">
          Preparing your deck…
        </p>
      ) : null}

      {activeJobId ? (
        <GenerationView
          deckId={id}
          jobId={activeJobId}
          cards={cards}
          theme={effectiveTheme ?? undefined}
          onCardsChange={setCards}
          onDone={generationDone}
          onRetry={(jobId) => setJob(jobId)}
          onRetryCard={() => void attachGeneration()}
        />
      ) : outlineMode ? (
        <>
          <div className="deck-actionbar">
            <p className="page-note">Outline ready — generate the content for each card.</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                flushTitleEdits();
                void attachGeneration();
              }}
            >
              Generate content
            </button>
          </div>
          <CardCanvas
            deck={deck!}
            cards={cards}
            theme={effectiveTheme ?? undefined}
            pendingLabel="Outline only — not generated yet."
            onEditCard={editCard}
            onEditTitle={editCardTitle}
          />
        </>
      ) : emptyDraft ? (
        <div className="deck-empty">
          <p>This deck has no cards yet.</p>
          <Link className="btn-primary" href="/new">
            Start from a prompt
          </Link>
        </div>
      ) : (
        <CardCanvas
          deck={deck!}
          cards={cards}
          theme={effectiveTheme ?? undefined}
          onEditCard={editCard}
          onEditTitle={editCardTitle}
          onRetryCard={() => void attachGeneration()}
          refiningCardId={refiningCardId}
          onToggleRefine={setRefiningCardId}
        />
      )}
    </main>
  );
}
