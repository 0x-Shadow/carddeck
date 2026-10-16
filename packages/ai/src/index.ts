import type { AIProvider } from "./types";
import { StubProvider } from "./stub";
import { OpenAIProvider } from "./openai";

interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
}

/**
 * Pick the AI backend. Returns an `OpenAIProvider` only when an API key is
 * configured; otherwise the deterministic, key-free `StubProvider`. This is why
 * the whole app runs with zero credentials.
 */
export function createProvider(env: Env = process.env): AIProvider {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return new StubProvider();
  }
  return new OpenAIProvider({
    apiKey,
    model: env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    baseUrl: env.OPENAI_BASE_URL?.trim() || undefined,
  });
}
