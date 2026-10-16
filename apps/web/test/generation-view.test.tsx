// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { GenerationView, type GenerationViewProps } from "../components/editor/GenerationView";
import type { CanvasCard } from "../components/editor/CardCanvas";

/**
 * jsdom ships no EventSource, so stand one up that records listeners and lets
 * tests push server-sent events by hand.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState = 1;
  private listeners = new Map<string, Set<(e: { data?: string }) => void>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: { data?: string }) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (e: { data?: string }) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  close() {
    this.readyState = 2;
  }

  /** Simulate the server pushing one event. */
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
  }
}

const pendingCard = (position: number, title: string): CanvasCard => ({
  id: `c${position}`,
  position,
  title,
  blocks: "[]",
  status: "pending",
});

/** Simulate the server pushing one event, flushing React's update queue. */
function emit(source: FakeEventSource, type: string, data: unknown) {
  act(() => source.emit(type, data));
}

function setup(overrides: Partial<GenerationViewProps> = {}) {
  const onCardsChange = vi.fn();
  const onDone = vi.fn();
  const props: GenerationViewProps = {
    deckId: "d1",
    jobId: "j1",
    cards: [pendingCard(0, "Cover"), pendingCard(1, "Body")],
    onCardsChange,
    onDone,
    ...overrides,
  };
  const view = render(<GenerationView {...props} />);
  const source = FakeEventSource.instances.at(-1)!;
  return { props, view, source, onCardsChange, onDone };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GenerationView", () => {
  it("subscribes to the job stream and shows pending skeletons", () => {
    const { source } = setup();

    expect(source.url).toContain("/api/generation/j1/stream");
    // One shimmering skeleton per card the worker hasn't filled in yet.
    expect(document.querySelectorAll(".card-pending")).toHaveLength(2);
    expect(screen.getByText(/2 cards|of 2/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /stop/i })).toBeTruthy();
  });

  it("fills a card as its event arrives and reports the merged list up", () => {
    const { source, onCardsChange } = setup();

    emit(source, "progress", { done: 1, total: 2 });
    emit(source, "card", {
      id: "c0",
      position: 0,
      title: "Cover",
      blocks: JSON.stringify([{ type: "heading", level: 1, text: ["Hello"] }]),
      status: "ready",
    });

    expect(onCardsChange).toHaveBeenCalledTimes(1);
    const merged = onCardsChange.mock.calls[0][0] as CanvasCard[];
    expect(merged[0].status).toBe("ready");
    expect(merged[1].status).toBe("pending"); // untouched sibling
    // The filled card renders its content, not a skeleton.
    expect(screen.getByDisplayValue("Hello")).toBeTruthy();
    expect(document.querySelectorAll(".card-pending")).toHaveLength(1);
    // Progress reflects the numbers the server sent.
    expect(screen.getByText(/1\/2/)).toBeTruthy();
  });

  it("calls onDone when the stream reports done", () => {
    const { source, onDone } = setup();
    emit(source, "done", { status: "done" });
    expect(onDone).toHaveBeenCalledWith("done");
  });

  it("shows the server's error and offers a retry when the job fails", async () => {
    const onRetry = vi.fn();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ jobId: "j2" }) });
    const { source } = setup({ onRetry });

    emit(source, "error", { status: "error", error: "upstream exploded" });

    expect(screen.getByRole("alert").textContent).toContain("upstream exploded");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledWith("j2"));
  });

  it("ignores connection-level errors that carry no payload", () => {
    const { source, onDone } = setup();
    // EventSource fires "error" on drops/retries too; those have no data and
    // must not surface as a job failure (the browser reconnects on its own).
    act(() => {
      for (const fn of (source as any).listeners.get("error") ?? []) fn({});
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("sends a cancel PATCH when Stop is clicked", async () => {
    const { source } = setup();

    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/generation/j1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "cancel" });

    // The server answers the stream with a terminal done(cancelled) event.
    emit(source, "done", { status: "cancelled" });
    expect(screen.getByText(/stopped/i)).toBeTruthy();
  });
});
