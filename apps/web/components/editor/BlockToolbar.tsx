"use client";

/** Block kinds the toolbar can insert after the selected block. */
export type InsertKind =
  | "heading"
  | "paragraph"
  | "bulletList"
  | "numberedList"
  | "quote"
  | "callout"
  | "image"
  | "divider"
  | "chart"
  | "columns";

const INSERT_LABELS: Record<InsertKind, string> = {
  heading: "Add heading",
  paragraph: "Add paragraph",
  bulletList: "Add bullet list",
  numberedList: "Add numbered list",
  quote: "Add quote",
  callout: "Add callout",
  image: "Add image",
  divider: "Add divider",
  chart: "Add chart",
  columns: "Add columns",
};

const INSERT_TEXT: Record<InsertKind, string> = {
  heading: "Heading",
  paragraph: "Text",
  bulletList: "Bullets",
  numberedList: "Numbers",
  quote: "Quote",
  callout: "Callout",
  image: "Image",
  divider: "Divider",
  chart: "Chart",
  columns: "Columns",
};

/** Insert toolbar: adds a new block after the currently selected row. */
export function BlockToolbar({
  onInsert,
}: {
  onInsert: (kind: InsertKind) => void;
}) {
  return (
    <div className="block-toolbar" role="toolbar" aria-label="Insert block">
      {(Object.keys(INSERT_LABELS) as InsertKind[]).map((kind) => (
        <button
          key={kind}
          type="button"
          aria-label={INSERT_LABELS[kind]}
          className="block-tool"
          onClick={() => onInsert(kind)}
        >
          {INSERT_TEXT[kind]}
        </button>
      ))}
    </div>
  );
}

/** Per-row formatting controls: bold / italic on the block's text, and delete. */
export function RowToolbar({
  canFormat,
  onBold,
  onItalic,
  onDelete,
}: {
  canFormat: boolean;
  onBold: () => void;
  onItalic: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="row-toolbar" role="toolbar" aria-label="Block formatting">
      <button
        type="button"
        aria-label="Bold"
        className="row-tool"
        disabled={!canFormat}
        onClick={onBold}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        aria-label="Italic"
        className="row-tool"
        disabled={!canFormat}
        onClick={onItalic}
      >
        <em>I</em>
      </button>
      <button type="button" aria-label="Delete block" className="row-tool" onClick={onDelete}>
        ✕
      </button>
    </div>
  );
}
