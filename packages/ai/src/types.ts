import type { Block, OutlineCard } from "@carddeck/core";

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
}
