// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ExportMenu } from "../components/share/ExportMenu";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    blob: async () => new Blob(["PK"], { type: "application/octet-stream" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  // Stubs so the component can trigger a download.
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  HTMLAnchorElement.prototype.click = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ExportMenu", () => {
  it("opens a menu and exports the chosen format via the API", async () => {
    render(<ExportMenu deckId="d1" deckTitle="Launch Plan" />);

    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    const item = await screen.findByRole("menuitem", { name: /powerpoint/i });
    fireEvent.click(item);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/deck/d1/export/pptx"));
  });

  it("exports the theme template when that item is chosen", async () => {
    render(<ExportMenu deckId="d1" deckTitle="Deck" />);

    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /theme template/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/deck/d1/export/potx"));
  });

  it("surfaces a failed export as an inline error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    render(<ExportMenu deckId="d1" deckTitle="Deck" />);

    fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /powerpoint/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/deck/d1/export/pptx");
  });
});
