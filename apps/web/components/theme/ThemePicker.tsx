"use client";

import { useState } from "react";
import type { Theme } from "@carddeck/core";
import { PRESET_THEMES } from "@carddeck/core";

interface ThemePickerProps {
  deckId: string;
  themeId: string;
  onChange: (themeId: string) => void;
  /** Themes to offer. Defaults to the shipped presets. */
  themes?: Theme[];
}

/**
 * Swatch picker for a deck's theme.
 *
 * Clicking a swatch PATCHes `/api/deck/[id]/theme` and, on success, reports the
 * new id via `onChange` so the parent can re-skin instantly (the deck's blocks
 * are untouched — only the CSS custom properties on the deck root change).
 */
export function ThemePicker({ deckId, themeId, onChange, themes }: ThemePickerProps) {
  const options = themes ?? PRESET_THEMES;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(id: string) {
    if (id === themeId || saving) return;
    setSaving(true);
    setError(null);
    // Optimistic: re-skin immediately, roll back if the server rejects it.
    const previous = themeId;
    onChange(id);
    try {
      const res = await fetch(`/api/deck/${deckId}/theme`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeId: id }),
      });
      if (!res.ok) throw new Error(`theme switch failed (${res.status})`);
    } catch (err) {
      onChange(previous);
      setError(err instanceof Error ? err.message : "theme switch failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Deck theme">
      {options.map((theme) => {
        const selected = theme.id === themeId;
        return (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Theme: ${theme.name}`}
            title={theme.name}
            disabled={saving}
            onClick={() => pick(theme.id)}
            className="theme-swatch h-9 w-9 border-2"
            style={{
              background: theme.colors.page,
              borderColor: selected ? theme.colors.accent : "transparent",
            }}
          >
            <span
              className="mx-auto block h-3 w-3 rounded-full"
              style={{ background: theme.colors.accent }}
            />
          </button>
        );
      })}
      {error ? (
        <span role="alert" className="text-sm text-red-500">
          {error}
        </span>
      ) : null}
    </div>
  );
}
