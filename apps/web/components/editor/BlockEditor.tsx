"use client";

import { useState } from "react";
import type { Block, Inline, Theme } from "@carddeck/core";
import { inlineToPlainText } from "@carddeck/core";
import { BlockRenderer } from "@/components/blocks";
import { BlockToolbar, RowToolbar, type InsertKind } from "./BlockToolbar";
import { ImageBlockEditor } from "./ImageBlockEditor";

export interface BlockEditorProps {
  /** Owning deck id — image uploads post to `/api/deck/<deckId>/assets`. */
  deckId: string;
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  theme?: Theme;
}

type FormattableType = "heading" | "paragraph" | "quote" | "callout";

/**
 * Blocks whose textual content lives in a single `text: Inline[]` field and can
 * therefore be edited with one textarea.
 */
function textRuns(block: Block): Inline[] | null {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "quote":
    case "callout":
      return block.text;
    default:
      return null;
  }
}

/** A text run normalized to an object so shared formatting can be inspected. */
type RunObject = { text: string; bold?: boolean; italic?: boolean; link?: string };

function toRunObject(run: Inline): RunObject {
  return typeof run === "string" ? { text: run } : { ...run };
}

/** Formatting shared by every run (so a plain-text edit keeps it). */
function sharedStyle(runs: Inline[]): { bold?: boolean; italic?: boolean; link?: string } | null {
  if (runs.length === 0) return null;
  const objs = runs.map(toRunObject);
  const style: { bold?: boolean; italic?: boolean; link?: string } = {};
  if (objs.every((o) => o.bold === true)) style.bold = true;
  if (objs.every((o) => o.italic === true)) style.italic = true;
  const link = objs[0].link;
  if (link && objs.every((o) => o.link === link)) style.link = link;
  return Object.keys(style).length > 0 ? style : null;
}

/** Replace a block's text with `value`, preserving formatting the runs shared. */
function withPlainText(block: Block, value: string): Block {
  const runs = textRuns(block);
  if (!runs) return block;
  const style = sharedStyle(runs);
  const text: Inline[] = [style ? { text: value, ...style } : value];
  return { ...block, text } as Block;
}

/**
 * Toggle bold/italic across a block's runs. When the result has no formatting
 * left, runs collapse back to plain strings (so toggling twice is a no-op).
 */
function toggleMark(blocks: Block[], index: number, mark: "bold" | "italic"): Block[] {
  const block = blocks[index];
  const runs = textRuns(block);
  if (!runs) return blocks;

  const objs: { text: string; bold?: boolean; italic?: boolean; link?: string }[] = runs.map((r) =>
    typeof r === "string" ? { text: r } : { ...r },
  );
  const allMarked = objs.every((o) => o[mark] === true);

  const nextRuns: Inline[] = objs.map((o) => {
    const copy = { ...o };
    if (allMarked) {
      delete copy[mark];
      return !copy.bold && !copy.italic && !copy.link ? copy.text : copy;
    }
    copy[mark] = true;
    return copy;
  });

  return blocks.map((b, i) => (i === index ? ({ ...block, text: nextRuns } as Block) : b));
}

/** A fresh block for a toolbar insert. */
function makeBlock(kind: InsertKind): Block {
  switch (kind) {
    case "heading":
      return { type: "heading", level: 2, text: ["New heading"] };
    case "paragraph":
      return { type: "paragraph", text: ["New paragraph"] };
    case "bulletList":
      return { type: "bulletList", items: [["New item"]] };
    case "numberedList":
      return { type: "numberedList", items: [["New item"]] };
    case "quote":
      return { type: "quote", text: ["New quote"] };
    case "callout":
      return { type: "callout", tone: "info", text: ["New callout"] };
    case "image":
      return { type: "image", src: "", layout: "full" };
    case "divider":
      return { type: "divider" };
    case "chart":
      return {
        type: "chart",
        kind: "bar",
        data: { labels: ["A", "B"], series: [{ name: "Series", values: [3, 5] }] },
      };
    case "columns":
      return {
        type: "columns",
        columns: [
          [{ type: "paragraph", text: ["Left"] }],
          [{ type: "paragraph", text: ["Right"] }],
        ],
      };
  }
}

/**
 * Controlled editor for one card's block list — no rich-text engine.
 *
 * Text blocks edit through plain textareas (bold/italic applied per block from
 * the row toolbar); complex blocks (columns, chart, image, divider) show their
 * rendered preview and can be deleted or followed by a new block. Every change
 * reports a brand-new array, never a mutation of `blocks`.
 */
export function BlockEditor({ deckId, blocks, onChange, theme }: BlockEditorProps) {
  const [selected, setSelected] = useState(0);

  const apply = (next: Block[]) => onChange(next);

  const insert = (kind: InsertKind) => {
    const base = Math.max(0, Math.min(selected, blocks.length - 1));
    const at = blocks.length === 0 ? 0 : base + 1;
    apply([...blocks.slice(0, at), makeBlock(kind), ...blocks.slice(at)]);
    setSelected(at);
  };

  const remove = (index: number) => {
    apply(blocks.filter((_, i) => i !== index));
    setSelected((s) => Math.max(0, Math.min(s, blocks.length - 2)));
  };

  const setText = (index: number, value: string) => {
    apply(blocks.map((b, i) => (i === index ? withPlainText(b, value) : b)));
  };

  const setListItem = (index: number, itemIndex: number, value: string) => {
    const block = blocks[index];
    if (block.type !== "bulletList" && block.type !== "numberedList") return;
    const items = block.items.map((item, j) => (j === itemIndex ? [value] : item));
    apply(blocks.map((b, i) => (i === index ? { ...block, items } : b)));
  };

  const renderBody = (block: Block, index: number) => {
    if (block.type === "bulletList" || block.type === "numberedList") {
      return (
        <div className="list-editor">
          {block.items.map((item, j) => (
            <textarea
              key={j}
              rows={1}
              aria-label={`Item ${j + 1} of ${block.type === "bulletList" ? "bullet list" : "numbered list"}`}
              value={inlineToPlainText(item)}
              onChange={(e) => setListItem(index, j, e.target.value)}
            />
          ))}
        </div>
      );
    }

    const runs = textRuns(block);
    if (runs) {
      return (
        <textarea
          aria-label={`Edit ${block.type} ${index + 1}`}
          rows={block.type === "heading" ? 1 : 3}
          value={inlineToPlainText(runs)}
          onChange={(e) => setText(index, e.target.value)}
        />
      );
    }

    return block.type === "image" ? (
      <ImageBlockEditor
        deckId={deckId}
        block={block}
        onChange={(next) => apply(blocks.map((b, i) => (i === index ? next : b)))}
      />
    ) : (
      <BlockRenderer block={block} theme={theme} />
    );
  };

  return (
    <div className="block-editor">
      <BlockToolbar onInsert={insert} />
      {blocks.map((block, index) => (
        <div
          key={index}
          className="block-row"
          data-index={index}
          data-selected={index === selected ? "true" : undefined}
          onClick={() => setSelected(index)}
        >
          <RowToolbar
            canFormat={textRuns(block) !== null}
            onBold={() => apply(toggleMark(blocks, index, "bold"))}
            onItalic={() => apply(toggleMark(blocks, index, "italic"))}
            onDelete={() => remove(index)}
          />
          <div className="block-row-body">{renderBody(block, index)}</div>
        </div>
      ))}
      {blocks.length === 0 ? (
        <p className="block-empty">This card has no content yet — add a block above.</p>
      ) : null}
    </div>
  );
}
