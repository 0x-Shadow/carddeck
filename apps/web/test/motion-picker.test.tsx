// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MotionPicker } from "../components/editor/MotionPicker";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => cleanup());

describe("MotionPicker", () => {
  it("offers the four presets and marks the current one", () => {
    render(<MotionPicker deckId="d1" preset="punchy" onChange={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: /motion/i });
    expect(group).toBeTruthy();
    for (const name of [/none/i, /subtle/i, /punchy/i, /cinematic/i]) {
      expect(screen.getByRole("radio", { name })).toBeTruthy();
    }
    expect(screen.getByRole("radio", { name: /punchy/i }).getAttribute("aria-checked")).toBe("true");
  });

  it("PATCHes the deck with motionPreset and reports the change", async () => {
    const onChange = vi.fn();
    render(<MotionPicker deckId="d1" preset="none" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /cinematic/i }));

    expect(onChange).toHaveBeenCalledWith("cinematic");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/deck/d1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ motionPreset: "cinematic" }),
      }),
    );
  });

  it("rolls back and alerts when the server rejects the preset", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "no" }) });
    const onChange = vi.fn();
    render(<MotionPicker deckId="d1" preset="subtle" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /punchy/i }));

    expect(onChange).toHaveBeenCalledWith("punchy");
    // Optimistic change is rolled back once the server says no.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("subtle"));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
