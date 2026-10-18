"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { MotionPreset } from "@carddeck/core";

const PRESETS: Array<{ value: MotionPreset; label: string }> = [
  { value: "none", label: "None" },
  { value: "subtle", label: "Subtle" },
  { value: "punchy", label: "Punchy" },
  { value: "cinematic", label: "Cinematic" },
];

interface MotionPickerProps {
  deckId: string;
  preset: MotionPreset;
  onChange: (preset: MotionPreset) => void;
}

/**
 * Preset picker for a deck's motion plan, mirroring ThemePicker's optimistic
 * pattern: flip the preset immediately, PATCH the deck, roll back if the
 * server rejects it. The server derives the full per-slide plan (or the
 * worker fills it after generation) — the client never builds plans itself.
 *
 * Re-picking the checked preset is deliberate, not a no-op: it re-sends the
 * PATCH so the server re-derives the plan from the deck's current cards
 * (cards appended since the last pick leave the stored plan stale otherwise).
 *
 * Keyboard behavior follows the ARIA radiogroup pattern: arrows move
 * selection with focus, Home/End jump to the ends, and only the checked
 * radio sits in the tab order.
 *
 * While a PATCH is in flight the radios use `aria-disabled` (with the same
 * dimmed style), never the native `disabled` attribute: a disabled element
 * loses focus, which would kill arrow-key traversal after the first step.
 * `pick` and `onKeyDown` gate on `saving` instead.
 */
export function MotionPicker({ deckId, preset, onChange }: MotionPickerProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  async function pick(next: MotionPreset) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const previous = preset;
    onChange(next); // optimistic
    try {
      const res = await fetch(`/api/deck/${deckId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motionPreset: next }),
      });
      if (!res.ok) throw new Error(`motion switch failed (${res.status})`);
    } catch (err) {
      onChange(previous);
      setError(err instanceof Error ? err.message : "motion switch failed");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (saving) return;
    const last = PRESETS.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    void pick(PRESETS[next].value);
  }

  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Deck motion">
      {PRESETS.map((p, i) => (
        <button
          key={p.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={preset === p.value}
          aria-label={`Motion: ${p.label}`}
          aria-disabled={saving}
          tabIndex={preset === p.value ? 0 : -1}
          onClick={() => pick(p.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
          className={`btn-secondary${preset === p.value ? " motion-option-active" : ""}${
            saving ? " opacity-50 cursor-default" : ""
          }`}
        >
          {p.label}
        </button>
      ))}
      {error ? (
        <span role="alert" className="text-sm text-red-500">
          {error}
        </span>
      ) : null}
    </div>
  );
}
