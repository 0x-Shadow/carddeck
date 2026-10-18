/**
 * Motion plans: how a deck animates — in the web present mode AND inside the
 * exported .pptx (slide transitions + entrance animations). A plan is a pure
 * data structure so the same plan drives both renderers.
 *
 * `planMotion` expands a preset into a full per-slide plan deterministically
 * (hash-seeded), so the key-free StubProvider and the OpenAI provider produce
 * the same quality of output for the same deck.
 */

export type MotionPreset = "none" | "subtle" | "punchy" | "cinematic";
export type TransitionKind = "fade" | "push" | "wipe" | "cover" | "split";
export type EntranceKind = "fade" | "wipeUp" | "flyLeft" | "zoom";

export interface SlideMotion {
  transition: TransitionKind;
  builds: Array<{ effect: EntranceKind; delayMs: number }>;
}

export interface MotionPlan {
  preset: MotionPreset;
  slides: SlideMotion[];
}

/** Deterministic string hash (FNV-1a), same pattern as the stub provider. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Never animate more than this many shapes on one slide. */
export const MAX_MOTION_BUILDS = 12;

interface PresetSpec {
  transitions: TransitionKind[];
  effects: EntranceKind[];
  /** Delay between consecutive shape entrances on a slide. */
  stagger: number;
  /** Delay of the first shape (the title) on each slide. */
  firstDelay: number;
}

const PRESETS: Record<Exclude<MotionPreset, "none">, PresetSpec> = {
  subtle: { transitions: ["fade"], effects: ["fade"], stagger: 300, firstDelay: 0 },
  punchy: {
    transitions: ["push", "wipe", "split"],
    effects: ["wipeUp", "zoom"],
    stagger: 250,
    firstDelay: 0,
  },
  cinematic: {
    transitions: ["cover", "split", "fade"],
    effects: ["flyLeft", "zoom", "fade"],
    stagger: 450,
    firstDelay: 200,
  },
};

/**
 * Expand a preset into a full plan. Deterministic: the same preset, shape
 * counts, and seed always produce the same plan.
 */
export function planMotion(
  preset: MotionPreset,
  counts: { slides: number; shapes: number[] },
  seed: string,
): MotionPlan {
  if (preset === "none") return { preset, slides: [] };
  const spec = PRESETS[preset];
  const slides: SlideMotion[] = [];
  for (let i = 0; i < counts.slides; i++) {
    const shapeCount = Math.min(counts.shapes[i] ?? 0, MAX_MOTION_BUILDS);
    const transition =
      spec.transitions[hash(seed + ":" + i) % spec.transitions.length];
    const builds = Array.from({ length: shapeCount }, (_, j) => ({
      effect: spec.effects[hash(seed + ":" + i + ":" + j) % spec.effects.length],
      delayMs: spec.firstDelay + j * spec.stagger,
    }));
    slides.push({ transition, builds });
  }
  return { preset, slides };
}

/** Lenient parse for blocks that may be a JSON string (DB) or array (API). */
function blocksOf(raw: unknown): unknown[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

/**
 * Derive a plan for a whole deck: each slide gets one shape per block plus
 * the title shape.
 */
export function planMotionForDeck(
  preset: MotionPreset,
  cards: Array<{ blocks: unknown }>,
  seed: string,
): MotionPlan {
  const shapes = cards.map((card) => 1 + blocksOf(card.blocks).length);
  return planMotion(preset, { slides: cards.length, shapes }, seed);
}

const PRESET_VALUES = new Set(["none", "subtle", "punchy", "cinematic"]);
const TRANSITION_VALUES = new Set(["fade", "push", "wipe", "cover", "split"]);
const ENTRANCE_VALUES = new Set(["fade", "wipeUp", "flyLeft", "zoom"]);

/**
 * Lenient parse for stored plans (deck.motion column). Returns null when the
 * value isn't a recognizable plan; drops malformed slides/builds rather than
 * throwing — a stored plan should never break the reader.
 */
/**
 * Parse a stored motion plan. Tolerates the two shapes it meets in practice:
 * the JSON string straight off the `deck.motion` column, and an already-parsed
 * object (API payloads, tests). Unparseable or unknown input yields `null`
 * rather than throwing, so a corrupt plan degrades to "no animation" instead
 * of taking a route down with it.
 */
export function parseMotionPlan(raw: unknown): MotionPlan | null {
  if (typeof raw === "string") {
    try {
      return parseMotionPlan(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.preset !== "string" || !PRESET_VALUES.has(obj.preset)) return null;
  const preset = obj.preset as MotionPreset;
  if (!Array.isArray(obj.slides)) return { preset, slides: [] };
  const slides: SlideMotion[] = [];
  for (const s of obj.slides) {
    if (typeof s !== "object" || s === null) continue;
    const slide = s as Record<string, unknown>;
    if (typeof slide.transition !== "string" || !TRANSITION_VALUES.has(slide.transition)) {
      continue;
    }
    const builds = Array.isArray(slide.builds)
      ? slide.builds.flatMap((b) => {
          if (typeof b !== "object" || b === null) return [];
          const build = b as Record<string, unknown>;
          if (typeof build.effect !== "string" || !ENTRANCE_VALUES.has(build.effect)) {
            return [];
          }
          const delayMs =
            typeof build.delayMs === "number" && Number.isFinite(build.delayMs)
              ? Math.max(0, Math.min(5000, Math.round(build.delayMs)))
              : 0;
          return [{ effect: build.effect as EntranceKind, delayMs }];
        })
      : [];
    slides.push({ transition: slide.transition as TransitionKind, builds });
  }
  return { preset, slides };
}
