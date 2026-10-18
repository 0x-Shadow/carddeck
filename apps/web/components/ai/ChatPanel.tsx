"use client";

import { useState } from "react";
import type { Block } from "@carddeck/core";

export interface ChatPanelProps {
  deckId: string;
  cardId: string;
  /** Hand the revised blocks (and the model's note) back to the caller. */
  onApplied: (blocks: Block[], note: string) => void;
}

/**
 * Ask the AI to revise one card.
 *
 * A single textarea and an Apply button — deliberately not a chat transcript.
 * v1 revises one card per instruction, so the panel's job is to collect the
 * instruction, call the synchronous revision endpoint, and hand the new blocks
 * back; history lives in the `chatMessage` table if a transcript is wanted
 * later. Failures render inline (role=alert) and leave the input intact so the
 * user can retry rather than retype.
 */
export function ChatPanel({ deckId, cardId, onApplied }: ChatPanelProps) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = instruction.trim();

  async function apply() {
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deck/${deckId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId, instruction: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as {
        blocks?: Block[];
        note?: string;
        error?: string;
      } | null;

      if (!res.ok || !body?.blocks) {
        setError(body?.error ?? `revision failed (${res.status})`);
        return;
      }
      setInstruction("");
      onApplied(body.blocks, body.note ?? "Updated this card.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "revision failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-panel">
      <label className="chat-label" htmlFor="chat-instruction">
        Ask AI to revise this card
      </label>
      <textarea
        id="chat-instruction"
        className="chat-input"
        rows={2}
        value={instruction}
        placeholder="e.g. make this shorter, add a concrete example, punch up the headline"
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter submits; plain Enter keeps the newline.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void apply();
          }
        }}
      />
      {error ? (
        <p role="alert" className="chat-error">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="btn-primary"
        disabled={!trimmed || busy}
        onClick={() => void apply()}
      >
        {busy ? "Applying…" : "Apply"}
      </button>
    </div>
  );
}
