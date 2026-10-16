import type { AIProvider } from "./types";
import { StubProvider } from "./stub";
import { OpenAIProvider } from "./openai";

export type {
  AIProvider,
  CardRequest,
  DeckFormat,
  OutlineRequest,
  ReviseRequest,
  ReviseResult,
} from "./types";
export { StubProvider } from "./stub";
export { OpenAIProvider, AIProviderError } from "./openai";
export { AIValidationError, validateBlocks, validateOutline } from "./validate";

interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
}

/**
 * Pick the AI backend. Returns an `OpenAIProvider` only when an API key is
 * configured; otherwise the deterministic, key-free `StubProvider`. This is why
 * the whole app runs with zero credentials.
 *
 * Accepts a plain env record (or `process.env`) so callers and tests can pass
 * either without depending on @types/node's `ProcessEnv` alias.
 */
export function createProvider(env: Env | NodeJS.ProcessEnv = process.env): AIProvider {
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
