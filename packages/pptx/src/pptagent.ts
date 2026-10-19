/**
 * PPTAgent export engine.
 *
 * Carddeck ships two independent PowerPoint renderers:
 *
 *   1. `buildDesignedPptxBuffer` — native PptxGenJS composition. Editable
 *      charts, motion injection, full control of every shape.
 *   2. This adapter — the designed HTML slides converted through PPTAgent's
 *      `html2pptx` (MIT, © 2025 ICIP-CAS; a fork of the Anthropic HTML-to-PPTX
 *      skill). Playwright reads the computed layout and emits positioned,
 *      editable PowerPoint objects, so the exported deck matches the browser
 *      design system used by the PDF export.
 *
 * The second engine exists because HTML is the highest-fidelity description of
 * a designed slide: gradients, layered cards, and CSS typography translate
 * without re-implementing every composition in PptxGenJS. It is complementary,
 * not a replacement — charts arrive as images under this engine, whereas the
 * native renderer keeps them as editable chart parts.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { renderDesignedSlidesHtml } from "./design-html";
import type { ImageResolver } from "./images";
import type { SlideDeck, SlideInput } from "./render-slides";

/** Resolved path to the vendored converter (renamed .cjs: this package is ESM). */
const VENDOR_REL_CANDIDATES = [
  "packages/pptx/vendor/pptagent/html2pptx/html2pptx_cli.cjs",
  "../packages/pptx/vendor/pptagent/html2pptx/html2pptx_cli.cjs",
  "../../packages/pptx/vendor/pptagent/html2pptx/html2pptx_cli.cjs",
];

function resolveConverter(): string {
  for (const rel of VENDOR_REL_CANDIDATES) {
    const candidate = path.resolve(process.cwd(), rel);
    if (existsSync(candidate)) return candidate;
  }
  // Installed package (production): resolve via Node module resolution.
  try {
    const nodeRequire =
      typeof require === "function" ? (require as NodeRequire) : null;
    if (nodeRequire) {
      const pkgJson = nodeRequire.resolve("@carddeck/pptx/package.json");
      const installed = path.join(
        path.dirname(pkgJson),
        "vendor",
        "pptagent",
        "html2pptx",
        "html2pptx_cli.cjs",
      );
      if (existsSync(installed)) return installed;
    }
  } catch {
    // ignore — fall through to the best-effort candidate below
  }
  return path.resolve(process.cwd(), VENDOR_REL_CANDIDATES[1]);
}

/** Absolute path to the vendored PPTAgent converter CLI. */
export const PPTAGENT_CONVERTER = resolveConverter();

export interface PptagentOptions {
  /** Resolve image blocks to data URLs before conversion. */
  resolveImage?: ImageResolver;
  /** Hard cap for the converter process (default 180s). */
  timeoutMs?: number;
  /**
   * Retry with `--soft` when strict validation rejects a slide (default true).
   * Soft mode keeps the deliverable instead of failing the export, and the
   * converter's warnings are forwarded to `onWarning`.
   */
  allowSoft?: boolean;
  /** Receives converter warnings and soft-mode fallback notices. */
  onWarning?: (message: string) => void;
  /** Override the converter path (tests). */
  converterPath?: string;
  /** Override the node binary (tests). */
  nodeBinary?: string;
}

/**
 * Is the vendored converter present together with the Node modules it
 * requires? Returns false rather than throwing so callers can fall back to the
 * native renderer with a clear message.
 */
export function isPptagentAvailable(): boolean {
  if (!existsSync(PPTAGENT_CONVERTER)) return false;
  const nodeRequire = typeof require === "function" ? (require as NodeRequire) : null;
  if (!nodeRequire) return true; // assume available in non-CJS contexts
  return ["playwright", "pptxgenjs", "fast-glob", "minimist"].every((dep) => {
    try {
      nodeRequire.resolve(dep);
      return true;
    } catch {
      return false;
    }
  });
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runNode(
  nodeBinary: string,
  args: string[],
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // The converter launches Chromium; keep its profile/temp files out of
        // the user's repo and inside the system temp directory.
        TMPDIR: process.env.TMPDIR ?? tmpdir(),
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`PPTAgent converter timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Render a deck to PPTX through PPTAgent's HTML → PPTX converter.
 *
 * Each card becomes a standalone 1280×720 HTML document, then the vendored
 * converter turns the set into a single 16:9 `.pptx` of native, editable
 * shapes and text.
 */
export async function buildPptagentPptxBuffer(
  deck: SlideDeck,
  cards: SlideInput[],
  options: PptagentOptions = {},
): Promise<Buffer> {
  if (cards.length === 0) throw new Error("PPTAgent export needs at least one card");
  const converter = options.converterPath ?? PPTAGENT_CONVERTER;
  if (!existsSync(converter)) {
    throw new Error(
      `PPTAgent converter not found at ${converter}; reinstall the vendored files`,
    );
  }

  const slides = await renderDesignedSlidesHtml(deck, cards, {
    resolveImage: options.resolveImage,
  });

  const dir = await mkdtemp(path.join(tmpdir(), "carddeck-pptagent-"));
  const timeoutMs = options.timeoutMs ?? 180_000;
  const nodeBinary = options.nodeBinary ?? process.execPath;
  const warn = options.onWarning ?? (() => {});
  try {
    const htmlArgs: string[] = [];
    for (const [index, html] of slides.entries()) {
      const file = path.join(dir, `slide${String(index + 1).padStart(2, "0")}.html`);
      await writeFile(file, html, "utf8");
      htmlArgs.push("--html", file);
    }

    const output = path.join(dir, "answer.pptx");
    const baseArgs = [
      converter,
      ...htmlArgs,
      "--layout",
      "16:9",
      "--output",
      output,
      "--title",
      deck.title,
      "--author",
      "Carddeck",
      "--company",
      "Carddeck",
    ];

    let result = await runNode(nodeBinary, baseArgs, timeoutMs);
    if (result.code !== 0 && (options.allowSoft ?? true)) {
      warn(
        `PPTAgent strict conversion failed; retrying in soft mode. ${firstLine(result.stderr)}`,
      );
      result = await runNode(nodeBinary, [...baseArgs, "--soft"], timeoutMs);
    }
    if (result.code !== 0) {
      throw new Error(
        `PPTAgent conversion failed (exit ${result.code}): ${firstLine(
          result.stderr || result.stdout,
        )}`,
      );
    }
    for (const line of result.stderr.split("\n")) {
      if (/warning|soft mode/i.test(line)) warn(line.trim());
    }
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function firstLine(value: string): string {
  const line = value.trim().split("\n").find(Boolean) ?? "unknown error";
  return line.length > 400 ? `${line.slice(0, 400)}…` : line;
}
