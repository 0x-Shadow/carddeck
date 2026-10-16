"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PresentStage } from "@/components/reader/PresentStage";
import { PRESET_THEMES, type Theme } from "@carddeck/core";
import Link from "next/link";

interface PresentData {
  deck: { id: string; title: string; themeId: string };
  cards: Array<{ id: string; title: string; blocks: string; position: number; status: string }>;
  theme: Theme | null;
}

type LoadState = "loading" | "ready" | "unauthorized" | "missing";

/**
 * Present mode shell for one deck (`/deck/[id]/present`).
 *
 * Fetches the owner-gated deck and hands it to `PresentStage`, which owns all
 * the keyboard navigation and progress UI. The page stays thin so the
 * interactive logic is unit-testable in isolation.
 */
export default function PresentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<PresentData | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const res = await fetch(`/api/deck/${id}`, { signal: ctrl.signal });
      if (res.status === 401) return setState("unauthorized");
      if (res.status === 404 || !res.ok) return setState("missing");
      setData((await res.json()) as PresentData);
      setState("ready");
    })();
    return () => ctrl.abort();
  }, [id]);

  if (state === "loading") {
    return (
      <main className="present-loading">
        <p className="page-note">Loading deck…</p>
      </main>
    );
  }
  if (state === "unauthorized" || state === "missing" || !data) {
    return (
      <main className="present-loading">
        <h1>{state === "unauthorized" ? "Sign in to present this deck" : "Deck not found"}</h1>
        <Link className="btn-primary" href="/">
          Go to Carddeck
        </Link>
      </main>
    );
  }

  const theme =
    data.theme ?? PRESET_THEMES.find((th) => th.id === data.deck.themeId) ?? PRESET_THEMES[0];

  return (
    <PresentStage
      deckTitle={data.deck.title}
      cards={data.cards}
      theme={theme}
      onExit={() => router.push(`/deck/${id}`)}
    />
  );
}
