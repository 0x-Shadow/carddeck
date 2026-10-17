// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BlockEditor } from "../components/editor/BlockEditor";
import type { Block } from "@carddeck/core";

let fetchMock: ReturnType<typeof vi.fn>;

const imageBlock = (src = ""): Block => ({ type: "image", src, layout: "full" });

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ asset: { id: "a1", url: "/api/deck/d1/assets/a1" } }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => cleanup());

function editImage(src = "") {
  const onChange = vi.fn();
  render(
    <BlockEditor
      deckId="d1"
      blocks={[imageBlock(src)]}
      theme={undefined}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe("BlockEditor image block", () => {
  it("exposes an upload control and a URL field for the image block", () => {
    editImage();
    expect(screen.getByRole("button", { name: /upload image/i })).toBeTruthy();
    expect(screen.getByLabelText(/image url/i)).toBeTruthy();
  });

  it("uploads a chosen file and reports a src pointing at the asset route", async () => {
    const { onChange } = editImage();
    const file = new File([new Uint8Array([137, 80])], "dot.png", { type: "image/png" });

    const input = screen.getByLabelText(/upload image/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/deck/d1/assets");
    expect(init.method).toBe("POST");
    // The body really is multipart with the chosen file.
    expect(init.body).toBeInstanceOf(FormData);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)![0] as Block[];
    expect(next[0]).toEqual({
      type: "image",
      src: "/api/deck/d1/assets/a1",
      layout: "full",
    });
  });

  it("keeps the previous src and shows an alert when the upload fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => ({ error: "file too large (max 10MB)" }),
    });
    const { onChange } = editImage("/api/deck/d1/assets/existing");
    const file = new File([new Uint8Array([1])], "big.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/upload image/i), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/file too large/i),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("applies a pasted http(s) URL directly, without an upload", async () => {
    const { onChange } = editImage();
    fireEvent.change(screen.getByLabelText(/image url/i), {
      target: { value: "https://example.com/pic.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^use$/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)![0] as Block[];
    expect((next[0] as { src: string }).src).toBe("https://example.com/pic.png");
  });

  it("rejects a javascript: URL without touching the block", () => {
    const { onChange } = editImage();
    fireEvent.change(screen.getByLabelText(/image url/i), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^use$/i }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/http/i);
  });

  it("shows the current src so an existing image can be replaced", () => {
    editImage("/api/deck/d1/assets/old");
    expect((screen.getByLabelText(/image url/i) as HTMLInputElement).value).toBe(
      "/api/deck/d1/assets/old",
    );
  });
});
