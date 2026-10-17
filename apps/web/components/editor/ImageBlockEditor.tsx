"use client";

import { useRef, useState } from "react";
import type { Block } from "@carddeck/core";

type Image = Extract<Block, { type: "image" }>;
type ImageLayout = Image["layout"];

/**
 * The editable form for an image block, in the editor only.
 *
 * The read path (`components/blocks/image.tsx`) stays presentational and
 * shared with the public reader + exporters. This component is what an editor
 * user actually interacts with: pick a file from their machine, paste a URL,
 * set a caption, cycle the layout. Uploads go to the owner-gated asset route
 * and come back as a same-origin `/api/deck/.../assets/...` path, which is the
 * `src` we store on the block.
 *
 * Every change reports a brand-new block upward through `onChange`; the block
 * array itself is owned by the parent editor.
 */
export function ImageBlockEditor({
  deckId,
  block,
  onChange,
}: {
  deckId: string;
  block: Image;
  onChange: (next: Image) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlDraft, setUrlDraft] = useState(block.src);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (partial: Partial<Image>) => onChange({ ...block, ...partial });

  const onFileChosen = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/deck/${deckId}/assets`, { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Upload failed (${res.status})`);
        return;
      }
      const { asset } = (await res.json()) as { asset: { id: string; url: string } };
      setUrlDraft(asset.url);
      patch({ src: asset.url });
    } catch {
      setError("Upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const applyUrl = () => {
    const value = urlDraft.trim();
    // Only same-origin-ish http(s) or our own asset paths. Anything else
    // (notably javascript:) would be an XSS vector the moment it reaches an
    // <img src> or an exported file.
    const ok = /^https?:\/\/\S+/i.test(value) || /^\/\S*/.test(value) || value === "";
    if (!ok) {
      setError("Use an http(s) URL or an uploaded image.");
      return;
    }
    setError(null);
    patch({ src: value });
  };

  const layouts: ImageLayout[] = ["full", "side", "behind"];

  return (
    <div className="image-editor" data-block="image-editor">
      {block.src ? (
        <img className="image-editor-preview" src={block.src} alt={block.caption ?? ""} />
      ) : (
        <div className="image-placeholder" role="img" aria-label={block.caption ?? "Image"}>
          {busy ? "Uploading…" : "No image yet"}
        </div>
      )}

      <div className="image-editor-controls">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? "Uploading…" : "Upload image"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="visually-hidden"
          aria-label="Upload image"
          disabled={busy}
          onChange={(e) => {
            void onFileChosen(e.target.files?.[0]);
            // Reset so re-choosing the same file fires a change event.
            e.target.value = "";
          }}
        />

        <label className="image-editor-url">
          <span>Image URL</span>
          <input
            type="url"
            value={urlDraft}
            placeholder="https://…"
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyUrl();
              }
            }}
          />
        </label>
        <button type="button" className="btn-secondary" onClick={applyUrl}>
          Use
        </button>

        <label className="image-editor-layout">
          <span>Layout</span>
          <select
            aria-label="Image layout"
            value={block.layout}
            onChange={(e) => patch({ layout: e.target.value as ImageLayout })}
          >
            <option value="full">Full width</option>
            <option value="side">Side</option>
            <option value="behind">Behind text</option>
          </select>
        </label>
      </div>

      <label className="image-editor-caption">
        <span>Caption</span>
        <input
          type="text"
          value={block.caption ?? ""}
          placeholder="Optional caption"
          onChange={(e) => patch({ caption: e.target.value || undefined })}
        />
      </label>

      {error ? (
        <p className="image-editor-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
