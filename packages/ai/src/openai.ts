import type { Block, OutlineCard } from "@carddeck/core";
import type { AIProvider, CardRequest, OutlineRequest, ReviseRequest, ReviseResult } from "./types";
import { cardSystem, cardUser, outlineSystem, outlineUser, reviseSystem, reviseUser } from "./prompts";
import { validateBlocks, validateOutline } from "./validate";

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Typed error for a non-2xx or failed upstream response. */
export class AIProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AIProviderError";
  }
}

/**
 * An OpenAI-compatible chat-completions provider. Works against OpenAI or any
 * compatible endpoint (via baseUrl). Requests use `json_object` response
 * format, retry once on 5xx, and enforce a 30s timeout. Output is validated
 * before it is returned, so callers get typed, safe structures.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAIProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async chat(system: string, user: string): Promise<unknown> {
    const body = JSON.stringify({
      model: this.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const attempt = async (): Promise<unknown> => {
      const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        throw new AIProviderError(`upstream ${res.status}`, res.status);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new AIProviderError("missing completion content");
      }
      return JSON.parse(content) as unknown;
    };

    try {
      return await attempt();
    } catch (err) {
      // One retry on 5xx (transient) only.
      if (err instanceof AIProviderError && err.status && err.status >= 500) {
        return await attempt();
      }
      throw err;
    }
  }

  async generateOutline(req: OutlineRequest): Promise<OutlineCard[]> {
    const raw = await this.chat(outlineSystem(), outlineUser(req));
    return validateOutline(raw, req.numCards);
  }

  async generateCard(req: CardRequest): Promise<Block[]> {
    const raw = await this.chat(cardSystem(), cardUser(req));
    return validateBlocks(raw);
  }

  async revise(req: ReviseRequest): Promise<ReviseResult> {
    const raw = await this.chat(reviseSystem(), reviseUser(req));
    const obj = raw as { blocks?: unknown; note?: unknown };
    const blocks = validateBlocks(obj.blocks);
    const note = typeof obj.note === "string" ? obj.note : undefined;
    return note === undefined ? { blocks } : { blocks, note };
  }
}
