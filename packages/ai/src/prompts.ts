import type { OutlineRequest, CardRequest, ReviseRequest } from "./types";

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
    "You are a slide content writer.",
    "Return ONLY a JSON array of block objects.",
    "Valid block types: heading, paragraph, bulletList, numberedList, image, quote, divider, columns, callout, chart.",
    "No prose, no markdown fences.",
  ].join(" ");
}

export function cardUser(req: CardRequest): string {
  const outlineList = req.context.map((c) => `- ${c.title}`).join("\n");
  return `Theme: ${req.themeName}. Format: ${req.format}.\nFull outline:\n${outlineList}\n\nWrite the content blocks for the card titled "${req.outline.title}" (intent: ${req.outline.intent || "general"}).`;
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
