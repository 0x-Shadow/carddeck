// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ChatPanel } from "../components/ai/ChatPanel";
import type { Block } from "@carddeck/core";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      blocks: [{ type: "paragraph", text: ["revised"] }] as Block[],
      note: "Made it shorter.",
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => cleanup());

describe("ChatPanel", () => {
  it("POSTs the instruction and reports the revised blocks upward", async () => {
    const onApplied = vi.fn();
    render(<ChatPanel deckId="d1" cardId="c1" onApplied={onApplied} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "make this shorter" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    const [blocks, note] = onApplied.mock.calls[0];
    expect(blocks).toEqual([{ type: "paragraph", text: ["revised"] }]);
    expect(note).toBe("Made it shorter.");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/deck/d1/chat");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      cardId: "c1",
      instruction: "make this shorter",
    });
  });

  it("disables the button until there is an instruction", () => {
    render(<ChatPanel deckId="d1" cardId="c1" onApplied={vi.fn()} />);
    expect(screen.getByRole("button", { name: /apply/i })).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: /apply/i })).toHaveProperty("disabled", true);
  });

  it("surfaces a failed revision as an alert instead of throwing", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: "model unavailable" }),
    });
    const onApplied = vi.fn();
    render(<ChatPanel deckId="d1" cardId="c1" onApplied={onApplied} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "rewrite" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("model unavailable"),
    );
    expect(onApplied).not.toHaveBeenCalled();
    // The panel is usable again after the failure.
    expect(screen.getByRole("button", { name: /apply/i })).toHaveProperty("disabled", false);
  });

  it("clears the input only after a successful apply", async () => {
    render(<ChatPanel deckId="d1" cardId="c1" onApplied={vi.fn()} />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "rewrite" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => expect(input.value).toBe(""));
  });
});
