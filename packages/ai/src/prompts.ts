import type { OutlineRequest, CardRequest, MotionRequest, ReviseRequest } from "./types";

/** System prompt for outline generation: demands a strict JSON array. */
export function outlineSystem(): string {
  return [
    "You are a presentation outline writer.",
    "Return ONLY a JSON array of objects with keys title (string) and intent (string).",
    "No prose, no markdown fences, no commentary.",
  ].join(" ");
}

export function outlineUser(req: OutlineRequest): string {
  const tone = req.tone ? ` Tone: ${req.tone}.` : "";
  return `Create a ${req.numCards}-card ${req.format} outline for: "${req.prompt}".${tone}`;
}

/** System prompt for single-card content generation: a JSON array of blocks. */
export function cardSystem(): string {
  return [
    "You are an extraordinary Gamma-grade presentation designer.",
    "Return ONLY a JSON array of block objects (or an object with a 'blocks' array).",
    "Valid block types: heading (level 1-3), paragraph, bulletList, numberedList, image (src, layout: full|side|behind, caption), quote (text, attribution), divider, columns (nested block columns), callout (tone: info|warn|success), chart (kind: bar|line|donut, data: {labels, series: [{name, values}]}).",
    "Design high-impact slides like Gamma.app:",
    "- Cover cards: Title (level 1), compelling subtitle, and an image (layout 'behind' or 'side' with an unsplash url).",
    "- KPI/Metrics cards: 'columns' block with 2-3 stats (e.g., heading level 3 for the big metric like '+148%' or '$24M', callout badge, concise paragraph).",
    "- Data cards: 'chart' block with realistic data series paired with key insight callouts.",
    "- Multi-pillar/feature cards: 'columns' block with 2-3 columns.",
    "- Executive insights: 'quote' block with attribution and 'callout' summary.",
    "No markdown fences, no conversational prose, return pure JSON.",
  ].join(" ");
}

export function cardUser(req: CardRequest): string {
  const outlineList = req.context.map((c) => `- ${c.title}`).join("\n");
  return `Theme: ${req.themeName}. Format: ${req.format}.\nFull outline:\n${outlineList}\n\nCreate extraordinary, professional Gamma-style presentation blocks for card titled "${req.outline.title}" (intent: ${req.outline.intent || "general"}).`;
}

/** System prompt for revision: a JSON object with blocks (+ optional note). */
export function reviseSystem(): string {
  return [
    "You revise slide content.",
    'Return ONLY a JSON object: {"blocks": [...], "note": "optional short summary"}.',
    "No prose, no markdown fences.",
  ].join(" ");
}

export function reviseUser(req: ReviseRequest): string {
  return `Instruction: ${req.instruction}\nCard: ${req.cardTitle}\nCurrent blocks: ${JSON.stringify(req.blocks)}`;
}

/** Lenient block count: cards arrive as JSON strings (DB) or arrays (API). */
function blockCount(raw: unknown): number {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return 0;
    }
  }
  return Array.isArray(value) ? value.length : 0;
}

/** System prompt for deck motion design: a JSON object with a motion plan. */
export function motionSystem(): string {
  return [
    "You are a presentation motion designer.",
    'Return ONLY a JSON object: {"motion": {"preset": ..., "slides": [{"transition": "fade|push|wipe|cover|split", "builds": [{"effect": "fade|wipeUp|flyLeft|zoom", "delayMs": number}]}]}}.',
    "One slides entry per deck slide, in order; the first build is the title, then one build per content block; delayMs is 0-5000.",
    "No prose, no markdown fences.",
  ].join(" ");
}

export function motionUser(req: MotionRequest): string {
  const lines = req.cards
    .map((c, i) => `${i + 1}. "${c.title}" — title + ${blockCount(c.blocks)} content block(s)`)
    .join("\n");
  return `Deck motion preset: ${req.preset}.\nSlides:\n${lines}\nDesign the animation plan for every slide.`;
}
