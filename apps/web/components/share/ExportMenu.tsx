"use client";

import { useEffect, useRef, useState } from "react";

export interface ExportMenuProps {
  deckId: string;
  deckTitle: string;
}

interface ExportItem {
  label: string;
  ext: "pptx" | "potx" | "pdf";
}

const ITEMS: ExportItem[] = [
  { label: "PowerPoint (.pptx)", ext: "pptx" },
  { label: "PDF (.pdf)", ext: "pdf" },
  { label: "Theme template (.potx)", ext: "potx" },
];

/**
 * Download-menu for the deck's export routes.
 *
 * Each item fetches the export endpoint (which enforces owner-or-public) and
 * saves the attachment. The browser uses the `content-disposition` filename,
 * so we just hand the blob straight to a temporary anchor.
 */
export function ExportMenu({ deckId, deckTitle }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function download(item: ExportItem) {
    if (busy) return;
    setBusy(item);
    setError(null);
    setOpen(false);
    try {
      const res = await fetch(`/api/deck/${deckId}/export/${item.ext}`);
      if (!res.ok) throw new Error(`export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const clean = deckTitle.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
      a.download = `${clean || "deck"}.${item.ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="export-menu" ref={rootRef}>
      <button
        type="button"
        className="btn-secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy !== null}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? "Exporting…" : "Export"}
      </button>
      {open ? (
        <div className="export-menu-list" role="menu">
          {ITEMS.map((item) => (
            <button
              key={item.ext}
              type="button"
              role="menuitem"
              className="export-menu-item"
              disabled={busy !== null}
              onClick={() => void download(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <span role="alert" className="share-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
