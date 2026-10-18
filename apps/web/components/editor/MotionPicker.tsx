"use client";

import { useState } from "react";
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
 */
export function MotionPicker({ deckId, preset, onChange }: MotionPickerProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(next: MotionPreset) {
    if (next === preset || saving) return;
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

  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Deck motion">
      {PRESETS.map((p) => (
        <button
          key={p.value}
          type="button"
          role="radio"
          aria-checked={preset === p.value}
          aria-label={`Motion: ${p.label}`}
          disabled={saving}
          onClick={() => pick(p.value)}
          className={preset === p.value ? "btn-secondary motion-option-active" : "btn-secondary"}
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
