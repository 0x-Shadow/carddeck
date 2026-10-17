// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BlockRenderer } from "../components/blocks";
import { safeHref } from "../components/blocks/shared";
import { BlockEditor } from "../components/editor/BlockEditor";
import { CardCanvas } from "../components/editor/CardCanvas";
import { PRESET_THEMES, type Block } from "@carddeck/core";

// Vitest runs without globals, so RTL's automatic cleanup never registers —
// call it explicitly or the DOM leaks between tests.
afterEach(() => cleanup());

const theme = PRESET_THEMES[0];

describe("block renderers", () => {
  it("renders a heading with theme font var", () => {
    const { container } = render(
      <BlockRenderer block={{ type: "heading", level: 1, text: ["Big Idea"] }} theme={theme} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Big Idea" })).toBeTruthy();
    // The theme arrives as CSS custom properties on the block wrapper, so the
    // deck re-skins by swapping vars — no per-block style logic.
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue("--font-display")).toBe(
      theme.fonts.display,
    );
  });

  it("renders a quote with accent border class", () => {
    const { container } = render(
      <BlockRenderer block={{ type: "quote", text: ["trust"] }} theme={theme} />,
    );
    const quote = container.querySelector("[data-block=quote]");
    expect(quote).toBeTruthy();
    expect(quote!.className).toContain("quote");
  });

  it("renders columns with one cell per column", () => {
    const { container } = render(
      <BlockRenderer
        block={{
          type: "columns",
          columns: [
            [{ type: "paragraph", text: ["a"] }],
            [{ type: "paragraph", text: ["b"] }],
          ],
        }}
        theme={theme}
      />,
    );
    expect(container.querySelectorAll("[data-column]").length).toBe(2);
  });

  it("renders a chart without crashing", () => {
    render(
      <BlockRenderer
        block={{
          type: "chart",
          kind: "bar",
          data: { labels: ["a"], series: [{ name: "s", values: [1] }] },
        }}
        theme={theme}
      />,
    );
    expect(screen.getByText("s")).toBeTruthy();
  });

  it("renders bold/italic inline runs and links", () => {
    render(
      <BlockRenderer
        block={{ type: "paragraph", text: ["plain ", { text: "bold", bold: true }, { text: "there", link: "https://x.dev" }] }}
        theme={theme}
      />,
    );
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    const link = screen.getByText("there");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://x.dev");
  });

  it("renders bullets, numbered items, divider, callout tone, and image placeholder", () => {
    const { container } = render(
      <>
        <BlockRenderer block={{ type: "bulletList", items: [["one"], ["two"]] }} theme={theme} />
        <BlockRenderer block={{ type: "numberedList", items: [["first"]] }} theme={theme} />
        <BlockRenderer block={{ type: "divider" }} theme={theme} />
        <BlockRenderer block={{ type: "callout", tone: "warn", text: ["careful"] }} theme={theme} />
        <BlockRenderer block={{ type: "image", src: "", layout: "full" }} theme={theme} />
      </>,
    );
    expect(screen.getByText("one").tagName).toBe("LI");
    expect(screen.getByText("first").tagName).toBe("LI");
    expect(container.querySelector("[data-block=divider]")).toBeTruthy();
    expect(container.querySelector(".callout-warn")).toBeTruthy();
    expect(container.querySelector("[data-block=image]")).toBeTruthy();
  });
});

describe("CardCanvas", () => {
  const deck = { id: "d1", title: "Deck", format: "presentation", status: "ready", themeId: "light" };

  it("renders one surface per card, editing ready cards and skeletons pending ones", () => {
    const cards = [
      {
        id: "c1",
        position: 0,
        title: "Cover",
        blocks: JSON.stringify([{ type: "heading", level: 1, text: ["Hi"] }]),
        status: "ready",
      },
      {
        id: "c2",
        position: 1,
        title: "Later",
        blocks: "[]",
        status: "pending",
      },
    ];
    const onEditCard = vi.fn();
    const { container } = render(
      <CardCanvas deck={deck} cards={cards} theme={theme} onEditCard={onEditCard} />,
    );

    expect(container.querySelectorAll(".card")).toHaveLength(2);
    // The ready card's heading lives in a textarea (React sets its value as a
    // property, so match on display value rather than text content).
    expect(screen.getByDisplayValue("Hi")).toBeTruthy();
    // A card the worker hasn't filled in yet shows a generating state, not a
    // blank surface the user could mistake for finished.
    expect(screen.getByText(/still generating/i)).toBeTruthy();
    expect(screen.queryByText("Later", { selector: "textarea" })).toBeNull();
  });
});

describe("BlockEditor", () => {
  const blocks: Block[] = [
    { type: "heading", level: 2, text: ["Title"] },
    { type: "paragraph", text: ["Body copy"] },
  ];

  it("renders one editor row per block and reports text edits", () => {
    const onChange = vi.fn();
    render(<BlockEditor blocks={blocks} onChange={onChange} />);

    const textareas = screen.getAllByRole("textbox");
    expect(textareas.length).toBeGreaterThanOrEqual(2);

    fireEvent.change(textareas[1], { target: { value: "Edited body" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Block[];
    expect(next[1]).toEqual({ type: "paragraph", text: ["Edited body"] });
    // Original array untouched (controlled + pure updates).
    expect(blocks[1]).toEqual({ type: "paragraph", text: ["Body copy"] });
  });

  it("inserts a new block from the toolbar after the selected one", () => {
    const onChange = vi.fn();
    render(<BlockEditor blocks={blocks} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /add callout/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Block[];
    expect(next).toHaveLength(3);
    expect(next[1]).toMatchObject({ type: "callout", tone: "info" });
    expect(next[0]).toEqual(blocks[0]);
  });

  it("deletes the selected block", () => {
    const onChange = vi.fn();
    render(<BlockEditor blocks={blocks} onChange={onChange} />);

    fireEvent.click(screen.getAllByRole("button", { name: /delete block/i })[1]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Block[];
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual(blocks[0]);
  });

  it("toggles bold across the selected block's text runs", () => {
    const onChange = vi.fn();
    render(<BlockEditor blocks={blocks} onChange={onChange} />);

    fireEvent.click(screen.getAllByRole("button", { name: /^bold$/i })[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Block[];
    expect(next[0]).toEqual({ type: "heading", level: 2, text: [{ text: "Title", bold: true }] });
  });
});

describe("renderInline link safety", () => {
  it("renders http(s)/mailto/relative links but drops scriptable schemes", () => {
    const { container } = render(
      <BlockRenderer
        block={{
          type: "paragraph",
          text: [
            { text: "ok", link: "https://example.com" },
            { text: "mail", link: "mailto:a@b.c" },
            { text: "rel", link: "/view/x" },
            { text: "bad", link: "javascript:alert(1)" },
            { text: "data", link: "data:text/html,x" },
          ],
        }}
        theme={theme}
      />,
    );
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://example.com", "mailto:a@b.c", "/view/x"]);
    // Unsafe parts survive as plain text — never as anchors.
    expect(container.textContent).toContain("bad");
    expect(container.textContent).toContain("data");
  });

  it("safeHref accepts only navigable, non-scripting targets", () => {
    expect(safeHref("https://x.dev")).toBe("https://x.dev");
    expect(safeHref(" http://x.dev ")).toBe("http://x.dev");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("/view/slug")).toBe("/view/slug");
    expect(safeHref("#top")).toBe("#top");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("vbscript:x")).toBeNull();
    expect(safeHref("")).toBeNull();
    expect(safeHref("   ")).toBeNull();
  });
});

describe("CardCanvas refine panel", () => {
  const deck = {
    id: "d1",
    title: "Deck",
    format: "presentation",
    status: "ready",
    themeId: "light",
  };
  const cards = [
    {
      id: "c1",
      position: 0,
      title: "One",
      blocks: JSON.stringify([{ type: "paragraph", text: ["hi"] }]),
      status: "ready",
    },
    { id: "c2", position: 1, title: "Two", blocks: "[]", status: "ready" },
  ];

  it("hides the affordance entirely when no handler is wired", () => {
    render(<CardCanvas deck={deck} cards={cards} theme={theme} />);
    expect(screen.queryByRole("button", { name: "Refine with AI" })).toBeNull();
  });

  it("shows the panel on the active card and toggles per card", () => {
    const onToggleRefine = vi.fn();
    render(
      <CardCanvas
        deck={deck}
        cards={cards}
        theme={theme}
        refiningCardId="c1"
        onToggleRefine={onToggleRefine}
        onEditCard={vi.fn()}
      />,
    );
    // The active card renders the chat panel…
    expect(screen.getByLabelText("Ask AI to revise this card")).toBeTruthy();
    // …its own button closes it…
    fireEvent.click(screen.getByRole("button", { name: "Close refine" }));
    expect(onToggleRefine).toHaveBeenCalledWith(null);
    // …and the other card's button opens it there.
    fireEvent.click(screen.getByRole("button", { name: "Refine with AI" }));
    expect(onToggleRefine).toHaveBeenCalledWith("c2");
  });

  it("hands the revised blocks to onEditCard when the panel applies", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        blocks: [{ type: "paragraph", text: ["revised"] }] as Block[],
        note: "shorter",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const onEditCard = vi.fn();
      render(
        <CardCanvas
          deck={deck}
          cards={cards}
          theme={theme}
          refiningCardId="c1"
          onToggleRefine={vi.fn()}
          onEditCard={onEditCard}
        />,
      );
      fireEvent.change(screen.getByLabelText("Ask AI to revise this card"), {
        target: { value: "shorten" },
      });
      fireEvent.click(screen.getByRole("button", { name: /apply/i }));
      await waitFor(() =>
        expect(onEditCard).toHaveBeenCalledWith("c1", [
          { type: "paragraph", text: ["revised"] },
        ]),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
