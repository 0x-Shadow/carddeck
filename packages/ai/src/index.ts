import type { AIProvider } from "./types";
import { StubProvider } from "./stub";
import { OpenAIProvider } from "./openai";

export type {
  AIProvider,
  CardRequest,
  DeckFormat,
  MotionRequest,
  OutlineRequest,
  ReviseRequest,
  ReviseResult,
} from "./types";
export { StubProvider, type StubOptions } from "./stub";
export { OpenAIProvider, AIProviderError } from "./openai";
export { AIValidationError, validateBlocks, validateMotionPlan, validateOutline } from "./validate";

interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
  /** "1" arms the stub's per-card failure hook (E2E test runs only). */
  CARDDECK_E2E_HOOKS?: string;
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
    return new StubProvider({ failureHook: env.CARDDECK_E2E_HOOKS === "1" });
  }
  return new OpenAIProvider({
    apiKey,
    model: env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    baseUrl: env.OPENAI_BASE_URL?.trim() || undefined,
  });
}
