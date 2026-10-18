import type { Block, OutlineCard } from "@carddeck/core";
import type { AIProvider, CardRequest, OutlineRequest, ReviseRequest, ReviseResult } from "./types";

/** Deterministic string hash so a prompt always yields the same outline. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SECTION_TEMPLATES = [
  "Overview of {topic}",
  "Why {topic} matters",
  "Key pillars of {topic}",
  "How {topic} works",
  "Evidence and results",
  "Risks and mitigations",
  "Roadmap for {topic}",
  "Team and ownership",
  "Investment and returns",
  "Next steps for {topic}",
];

const FILLER_SENTENCES = [
  "This section sets the stage and frames the core argument.",
  "We ground the claim in concrete, measurable outcomes.",
  "The trade-offs are real, and we name them explicitly.",
  "Execution discipline is what separates intent from impact.",
  "Every metric here is tracked weekly and reviewed monthly.",
];

export interface StubOptions {
  /**
   * E2E test hook. When enabled, `generateCard` throws the *first* time it
   * sees an outline title containing `[fail]` (keyed by card id, so a retry
   * succeeds) — letting end-to-end suites exercise the per-card error and
   * retry path with a deterministic provider. Off unless the process runs
   * with `CARDDECK_E2E_HOOKS=1`.
   */
  failureHook?: boolean;
}

/** Card ids that already failed under the hook (one failure per id, ever). */
const hookFailedOnce = new Set<string>();

/**
 * A deterministic, offline AI provider. Same input → same output, no network,
 * no API key. Used by tests and as the dev default so the app is fully usable
 * without credentials. Content is realistic-but-generic placeholder copy.
 */
export class StubProvider implements AIProvider {
  readonly name = "stub";
  private readonly opts: StubOptions;

  constructor(opts: StubOptions = {}) {
    this.opts = opts;
  }

  async generateOutline(req: OutlineRequest): Promise<OutlineCard[]> {
    const seed = hash(req.prompt + req.format + req.tone);
    const topic = req.prompt.trim().split(/\s+/).slice(0, 4).join(" ") || "this topic";
    return Array.from({ length: req.numCards }, (_, i) => {
      const template = SECTION_TEMPLATES[(seed + i) % SECTION_TEMPLATES.length];
      return {
        id: `card-${i}`,
        title: template.replace("{topic}", topic),
        intent: i === 0 ? "cover" : i === req.numCards - 1 ? "close" : "body",
      };
    });
  }

  async generateCard(req: CardRequest): Promise<Block[]> {
    // E2E failure hook: fail the first attempt for flagged titles so suites
    // can watch a card error and then recover through per-card retry.
    if (
      this.opts.failureHook &&
      req.outline.title.includes("[fail]") &&
      !hookFailedOnce.has(req.outline.id)
    ) {
      hookFailedOnce.add(req.outline.id);
      throw new Error(`forced card failure for "${req.outline.title}" (test hook)`);
    }

    const seed = hash(req.outline.title + req.themeName);
    if (req.outline.intent === "cover") {
      return [
        { type: "heading", level: 1, text: [req.outline.title] },
        { type: "image", src: "", layout: "behind", caption: req.themeName },
        { type: "paragraph", text: [`A ${req.format} by Carddeck`] },
      ];
    }
    if (req.outline.intent === "close") {
      return [
        { type: "heading", level: 1, text: [req.outline.title] },
        { type: "quote", text: [FILLER_SENTENCES[seed % FILLER_SENTENCES.length]], attribution: "Carddeck" },
        { type: "paragraph", text: ["Thank you — questions welcome."] },
      ];
    }
    return [
      { type: "heading", level: 2, text: [req.outline.title] },
      { type: "paragraph", text: [FILLER_SENTENCES[seed % FILLER_SENTENCES.length]] },
      {
        type: "bulletList",
        items: [
          [FILLER_SENTENCES[(seed + 1) % FILLER_SENTENCES.length]],
          [FILLER_SENTENCES[(seed + 2) % FILLER_SENTENCES.length]],
          [FILLER_SENTENCES[(seed + 3) % FILLER_SENTENCES.length]],
        ],
      },
    ];
  }

  async revise(req: ReviseRequest): Promise<ReviseResult> {
    // Echo blocks back (deterministic) with a note describing the instruction.
    return { blocks: req.blocks, note: `Applied: ${req.instruction}` };
  }

  /**
   * The stub designs no custom motion: the worker always expands the deck's
   * preset deterministically via `planMotionForDeck`. That is the same path
   * OpenAI falls back to when its design is missing or invalid, so keyless
   * decks animate exactly like the zero-key parity case promises.
   */
  async generateMotion(): Promise<undefined> {
    return undefined;
  }
}
