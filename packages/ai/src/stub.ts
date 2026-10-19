import { getThematicOnlineImage, type Block, type OutlineCard } from "@carddeck/core";
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
 * without credentials. Generates rich Gamma-style presentation cards with
 * metrics, charts, columns, quotes, and curated online imagery.
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
    const cardIdx = req.context.findIndex((c) => c.id === req.outline.id);
    const onlineImg = getThematicOnlineImage(req.outline.title, cardIdx >= 0 ? cardIdx : 0, "behind");

    if (req.outline.intent === "cover") {
      return [
        { type: "heading", level: 1, text: [req.outline.title] },
        { type: "image", src: onlineImg.src, layout: "behind", caption: req.themeName },
        { type: "callout", tone: "info", text: [`Executive Briefing · ${req.themeName} Edition`] },
        { type: "paragraph", text: [`A ${req.format} crafted with precision by Carddeck`] },
      ];
    }

    if (req.outline.intent === "close") {
      return [
        { type: "heading", level: 1, text: [req.outline.title] },
        { type: "callout", tone: "success", text: ["Strategic Alignment: Immediate deployment and execution phase."] },
        { type: "quote", text: [FILLER_SENTENCES[seed % FILLER_SENTENCES.length]], attribution: "Executive Steering Council" },
        { type: "paragraph", text: ["Thank you — discussion and strategic Q&A."] },
      ];
    }

    const mod = ((cardIdx >= 0 ? cardIdx : seed) % 6);

    if (mod === 1) {
      // KPI Stat Showcase: 3-column metric cards
      return [
        { type: "heading", level: 2, text: [req.outline.title] },
        { type: "paragraph", text: [FILLER_SENTENCES[seed % FILLER_SENTENCES.length]] },
        {
          type: "columns",
          columns: [
            [
              { type: "heading", level: 3, text: ["+148%"] },
              { type: "callout", tone: "success", text: ["YoY Growth"] },
              { type: "paragraph", text: ["Accelerating enterprise expansion across regions."] },
            ],
            [
              { type: "heading", level: 3, text: ["$24.5M"] },
              { type: "callout", tone: "info", text: ["ARR Milestone"] },
              { type: "paragraph", text: ["Exceeding target plan with durable unit economics."] },
            ],
            [
              { type: "heading", level: 3, text: ["99.98%"] },
              { type: "callout", tone: "info", text: ["System Uptime"] },
              { type: "paragraph", text: ["Enterprise SLA reliability with zero downtime."] },
            ],
          ],
        },
      ];
    }

    if (mod === 2) {
      // Data Chart Insights
      const isDonut = seed % 2 === 0;
      return [
        { type: "heading", level: 2, text: [req.outline.title] },
        {
          type: "callout",
          tone: "info",
          text: ["Performance Analytics: Benchmark metrics demonstrating sustained quarterly growth."],
        },
        {
          type: "chart",
          kind: isDonut ? "donut" : "bar",
          data: {
            labels: ["Q1 Baseline", "Q2 Scale", "Q3 Acceleration", "Q4 Peak"],
            series: [
              { name: "Delivered", values: [35, 68, 112, 175] },
              { name: "Target", values: [30, 60, 95, 140] },
            ],
          },
        },
        {
          type: "bulletList",
          items: [
            [FILLER_SENTENCES[(seed + 1) % FILLER_SENTENCES.length]],
            [FILLER_SENTENCES[(seed + 2) % FILLER_SENTENCES.length]],
          ],
        },
      ];
    }

    if (mod === 3) {
      // Split Layout: Narrative + Online Image
      const sideImg = getThematicOnlineImage(req.outline.title, cardIdx, "full");
      return [
        { type: "heading", level: 2, text: [req.outline.title] },
        {
          type: "columns",
          columns: [
            [
              { type: "paragraph", text: [FILLER_SENTENCES[seed % FILLER_SENTENCES.length]] },
              {
                type: "bulletList",
                items: [
                  [FILLER_SENTENCES[(seed + 1) % FILLER_SENTENCES.length]],
                  [FILLER_SENTENCES[(seed + 2) % FILLER_SENTENCES.length]],
                ],
              },
              { type: "callout", tone: "success", text: ["Key Takeaway: Validated by cross-functional review."] },
            ],
            [
              { type: "image", src: sideImg.src, layout: "full", caption: sideImg.caption },
            ],
          ],
        },
      ];
    }

    if (mod === 4) {
      // Process timeline: numbered stages across a row.
      return [
        { type: "heading", level: 2, text: [req.outline.title] },
        { type: "paragraph", text: [FILLER_SENTENCES[seed % FILLER_SENTENCES.length]] },
        {
          type: "columns",
          columns: [
            [
              { type: "heading", level: 3, text: ["01"] },
              { type: "callout", tone: "info", text: ["DISCOVER"] },
              { type: "paragraph", text: ["Frame the problem and align on the outcome."] },
            ],
            [
              { type: "heading", level: 3, text: ["02"] },
              { type: "callout", tone: "info", text: ["DESIGN"] },
              { type: "paragraph", text: ["Shape the solution and validate with stakeholders."] },
            ],
            [
              { type: "heading", level: 3, text: ["03"] },
              { type: "callout", tone: "success", text: ["DELIVER"] },
              { type: "paragraph", text: ["Ship, measure, and iterate toward the goal."] },
            ],
          ],
        },
      ];
    }

    if (mod === 5) {
      // Comparison: two options evaluated side by side.
      return [
        { type: "heading", level: 2, text: [req.outline.title] },
        {
          type: "columns",
          columns: [
            [
              { type: "heading", level: 3, text: ["Before"] },
              { type: "callout", tone: "warn", text: ["LEGACY"] },
              { type: "bulletList", items: [[FILLER_SENTENCES[seed % FILLER_SENTENCES.length]], [FILLER_SENTENCES[(seed + 1) % FILLER_SENTENCES.length]]] },
            ],
            [
              { type: "heading", level: 3, text: ["After"] },
              { type: "callout", tone: "success", text: ["CARDECK"] },
              { type: "bulletList", items: [[FILLER_SENTENCES[(seed + 2) % FILLER_SENTENCES.length]], [FILLER_SENTENCES[(seed + 3) % FILLER_SENTENCES.length]]] },
            ],
          ],
        },
        { type: "quote", text: [FILLER_SENTENCES[(seed + 4) % FILLER_SENTENCES.length]], attribution: "Carddeck" },
      ];
    }

    // Default Pillars & Quote
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
      {
        type: "quote",
        text: [FILLER_SENTENCES[(seed + 4) % FILLER_SENTENCES.length]],
        attribution: "Carddeck Leadership Council",
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
