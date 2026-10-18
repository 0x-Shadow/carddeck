import type { Block, MotionPlan, MotionPreset, OutlineCard } from "@carddeck/core";

export type DeckFormat = "presentation" | "document";

export interface OutlineRequest {
  prompt: string;
  format: DeckFormat;
  numCards: number;
  tone?: string;
}

export interface CardRequest {
  outline: OutlineCard;
  context: OutlineCard[];
  format: DeckFormat;
  themeName: string;
}

export interface ReviseRequest {
  instruction: string;
  blocks: Block[];
  cardTitle: string;
}

export interface ReviseResult {
  blocks: Block[];
  note?: string;
}

export interface MotionRequest {
  /** The preset the deck's owner chose. */
  preset: MotionPreset;
  /**
   * Settled cards in slide order. `blocks` may be a JSON string (a DB row) or
   * an array (an API payload) — lenient readers accept both.
   */
  cards: Array<{ title: string; blocks: unknown }>;
}

/**
 * A swappable LLM backend. `StubProvider` (deterministic, key-free) is the
 * default; `OpenAIProvider` activates when an API key is present. Every method
 * returns validated, typed output so callers never parse raw model text.
 */
export interface AIProvider {
  readonly name: string;
  generateOutline(req: OutlineRequest): Promise<OutlineCard[]>;
  generateCard(req: CardRequest): Promise<Block[]>;
  revise(req: ReviseRequest): Promise<ReviseResult>;
  /**
   * Optional deck-level motion design. Returns a validated plan, or
   * `undefined` when the backend can't provide one; callers fall back to the
   * deterministic `planMotionForDeck` expansion of the deck's preset.
   */
  generateMotion?(req: MotionRequest): Promise<MotionPlan | undefined>;
}
