import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAIProvider } from "../src/openai";

afterEach(() => vi.unstubAllGlobals());

describe("OpenAIProvider", () => {
  it("parses a chat completion into an outline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify([{ title: "One", intent: "a" }]) } }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const p = new OpenAIProvider({ apiKey: "k", model: "gpt-4o-mini", baseUrl: "https://x/v1" });
    const out = await p.generateOutline({ prompt: "p", format: "presentation", numCards: 1 });
    expect(out[0].title).toBe("One");
  });
  it("throws a typed error on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const p = new OpenAIProvider({ apiKey: "k", model: "m", baseUrl: "https://x/v1" });
    await expect(p.generateOutline({ prompt: "p", format: "presentation", numCards: 1 })).rejects.toThrow();
  });

  it("parses a valid deck motion design", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        motion: {
          preset: "punchy",
          slides: [{ transition: "push", builds: [{ effect: "zoom", delayMs: 120 }] }],
        },
      }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const p = new OpenAIProvider({ apiKey: "k", model: "m", baseUrl: "https://x/v1" });
    const plan = await p.generateMotion({
      preset: "punchy",
      cards: [{ title: "One", blocks: [{ type: "paragraph", text: "x" }] }],
    });
    expect(plan).toEqual({
      preset: "punchy",
      slides: [{ transition: "push", builds: [{ effect: "zoom", delayMs: 120 }] }],
    });
  });

  it("returns undefined when the motion design is invalid or missing", async () => {
    const req = { preset: "subtle" as const, cards: [{ title: "One", blocks: [] }] };

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ motion: { preset: "nope" } }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const invalid = new OpenAIProvider({ apiKey: "k", model: "m", baseUrl: "https://x/v1" });
    expect(await invalid.generateMotion(req)).toBeUndefined();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ blocks: [] }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const missing = new OpenAIProvider({ apiKey: "k", model: "m", baseUrl: "https://x/v1" });
    expect(await missing.generateMotion(req)).toBeUndefined();
  });
});
