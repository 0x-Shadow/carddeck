"use client";

import { useState } from "react";

export interface ShareControlProps {
  deckId: string;
  isPublic: boolean;
  shareSlug: string | null;
}

/**
 * Owner-only share control for a deck.
 *
 * Toggling sharing on mints a stable slug through `POST`? No — PATCH on the
 * existing `/api/deck/[id]/share` route, which mints the slug the first time
 * and reuses it from then on (stable URLs across shares). The link row stays
 * around until the owner stops sharing; the slug is retained so re-sharing
 * restores the same URL instead of breaking stale links.
 */
export function ShareControl({ deckId, isPublic: initial, shareSlug }: ShareControlProps) {
  const [shared, setShared] = useState(initial);
  const [slug, setSlug] = useState(shareSlug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const url = slug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/view/${slug}`
    : "";

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deck/${deckId}/share`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isPublic: next }),
      });
      if (!res.ok) throw new Error(`share update failed (${res.status})`);
      const body = (await res.json().catch(() => null)) as
        | { isPublic?: boolean; shareSlug?: string }
        | null;
      setShared(next);
      if (body?.shareSlug) setSlug(body.shareSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "share update failed");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — leave the link selectable */
    }
  }

  if (!shared) {
    return (
      <div className="share-control">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => toggle(true)}
        >
          Share
        </button>
        {error ? <span role="alert" className="share-error">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="share-control share-control-on">
      <input
        className="share-input"
        aria-label="Share link"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" className="btn-primary" onClick={copy}>
        {copied ? "Copied!" : "Copy"}
      </button>
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={() => toggle(false)}
      >
        Stop sharing
      </button>
      {error ? <span role="alert" className="share-error">{error}</span> : null}
    </div>
  );
}
