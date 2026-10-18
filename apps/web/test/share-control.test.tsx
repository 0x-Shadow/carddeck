// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ShareControl } from "../components/share/ShareControl";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ isPublic: true, shareSlug: "minted-slug" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  // jsdom ships no clipboard; the control copies through it when available.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ShareControl", () => {
  it("mints a share slug on demand and shows the public link", async () => {
    render(<ShareControl deckId="d1" isPublic={false} shareSlug={null} />);

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/deck/d1/share",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ isPublic: true });

    const link = (await screen.findByLabelText(/share link/i)) as HTMLInputElement;
    expect(link.value).toContain("/view/minted-slug");
    expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /stop sharing/i })).toBeTruthy();
  });

  it("copies the link to the clipboard", async () => {
    render(<ShareControl deckId="d1" isPublic={true} shareSlug="already-there" />);

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("/view/already-there"),
    );
    expect(await screen.findByRole("button", { name: /copied/i })).toBeTruthy();
  });

  it("stops sharing and returns to the Share button", async () => {
    render(<ShareControl deckId="d1" isPublic={true} shareSlug="abc" />);

    fireEvent.click(screen.getByRole("button", { name: /stop sharing/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^share$/i })).toBeTruthy());

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ isPublic: false });
    expect(screen.queryByLabelText(/share link/i)).toBeNull();
  });

  it("keeps the link hidden when the PATCH fails, with an inline error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<ShareControl deckId="d1" isPublic={false} shareSlug={null} />);

    fireEvent.click(screen.getByRole("button", { name: /^share$/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByLabelText(/share link/i)).toBeNull();
  });
});
