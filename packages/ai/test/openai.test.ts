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
});
