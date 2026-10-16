"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PRESET_THEMES, type Block } from "@carddeck/core";
import {
  CardCanvas,
  type CanvasCard,
  type CanvasDeck,
} from "@/components/editor/CardCanvas";
import { ThemePicker } from "@/components/theme/ThemePicker";

interface DeckResponse {
  deck: CanvasDeck & { shareSlug?: string | null; isPublic?: number };
  cards: CanvasCard[];
}

type PageState = "loading" | "ready" | "unauthorized" | "missing";
type SaveState = "idle" | "saving" | "error";

/**
 * The deck editor: one long scroll of card surfaces (Gamma's canvas), each
 * editable in place. Card content is fetched once and then edited optimistically
 * — every keystroke updates local state immediately and PATCHes the API on a
 * short debounce, so editing never waits on the network.
 */
export default function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [deck, setDeck] = useState<CanvasDeck | null>(null);
  const [cards, setCards] = useState<CanvasCard[]>([]);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Debounce timers live in refs so re-renders (every keystroke) don't reset them.
  const titleTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/deck/${id}`);
      if (cancelled) return;
      if (res.status === 401) return setPageState("unauthorized");
      if (res.status === 404) return setPageState("missing");
      if (!res.ok) return setPageState("missing");
      const body = (await res.json()) as DeckResponse;
      setDeck(body.deck);
      setCards(body.cards);
      setPageState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(
    () => () => {
      for (const timer of titleTimers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const theme = deck ? PRESET_THEMES.find((th) => th.id === deck.themeId) ?? PRESET_THEMES[0] : null;

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
    const existing = titleTimers.current.get(cardId);
    if (existing) clearTimeout(existing);
    titleTimers.current.set(
      cardId,
      setTimeout(() => {
        titleTimers.current.delete(cardId);
        void patch(`/api/deck/${id}/cards/${cardId}`, { title });
      }, 500),
    );
  }

  function changeTheme(themeId: string) {
    setDeck((prev) => (prev ? { ...prev, themeId } : prev));
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
          <ThemePicker deckId={id} themeId={deck!.themeId} onChange={changeTheme} />
        </div>
      </header>

      <CardCanvas
        deck={deck!}
        cards={cards}
        theme={theme ?? undefined}
        onEditCard={editCard}
        onEditTitle={editCardTitle}
      />
    </main>
  );
}
