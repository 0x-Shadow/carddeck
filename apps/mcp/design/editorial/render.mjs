#!/usr/bin/env node
/**
 * Editorial deck renderer.
 *
 *   node render.mjs deck.mjs [--out ./out] [--no-pdf] [--scale 1.3333]
 *
 * Pipeline: deck spec -> HTML per slide -> Chromium screenshot (2560x1440)
 * -> contact sheet + PPTX (one full-bleed image per slide + speaker notes)
 * -> optional PDF. The PPTX is the deliverable; the PNG/JPEGs are the slides.
 *
 * Requires `playwright` (with Chromium installed) and `pptxgenjs`, resolved
 * from the carddeck repo. Run it from inside the repo, or install both next to
 * this file.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { BASE_CSS, PAGE_W, PAGE_H } from "./theme.mjs";
import { LAYOUTS } from "./layouts.mjs";

const require = createRequire(import.meta.url);

function loadDep(name) {
  try {
    return require(name);
  } catch {
    throw new Error(
      `missing dependency "${name}". Run this from the carddeck repo (npm ci, npx playwright install chromium) or install it next to render.mjs.`,
    );
  }
}

const { chromium } = loadDep("playwright");
const PptxGenJS = loadDep("pptxgenjs");

// ── CLI ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--no-pdf") flags.pdf = false;
  else if (a === "--out") flags.out = argv[++i];
  else if (a === "--scale") flags.scale = Number(argv[++i]);
  else if (a === "--allow-local-hosts") flags.allowLocalHosts = true;
  else if (a === "--help" || a === "-h") flags.help = true;
  else positional.push(a);
}

if (flags.help) {
  console.log(`Editorial deck renderer

  node render.mjs <deck.mjs> [--out <dir>] [--no-pdf] [--scale 1.3333] [--allow-local-hosts]

The deck module default-exports:
  { title, author?, footer: { left, right }, images: { name: url|path }, slides: [...] }
Each slide is { layout, ...props, notes? }. Layouts: ${Object.keys(LAYOUTS).join(", ")}.

Remote images must be public http(s) hosts; loopback, private ranges and
link-local addresses are refused so a hostile deck spec cannot probe the
machine or the LAN. Pass --allow-local-hosts for assets on a local server.
`);
  process.exit(0);
}

const deckPath = path.resolve(positional[0] ?? "deck.mjs");
const outDir = path.resolve(flags.out ?? path.join(path.dirname(deckPath), "out"));
const scale = flags.scale ?? 1.3333;
const withPdf = flags.pdf !== false;

const deck = (await import(pathToFileURL(deckPath).href)).default;
if (!deck?.slides?.length) throw new Error(`${deckPath} must default-export { slides: [...] }`);
for (const [i, s] of deck.slides.entries()) {
  if (!LAYOUTS[s.layout]) {
    throw new Error(`slide ${i + 1}: unknown layout "${s.layout}" (expected ${Object.keys(LAYOUTS).join(", ")})`);
  }
}

const slug = (deck.title ?? "deck")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60) || "deck";

fs.mkdirSync(outDir, { recursive: true });

// ── images: remote URLs are cached next to the deck ─────────────────────────
const cacheDir = path.join(path.dirname(deckPath), ".image-cache");
const imageUrls = new Map();
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * Refuse loopback, RFC1918, link-local and mDNS hosts. The deck spec is
 * model-written, so a photo URL must not become a way to probe the machine or
 * the local network. (Hostname-based: a DNS name that resolves inward is out of
 * scope for a local design tool.)
 */
function assertPublicHost(raw) {
  if (flags.allowLocalHosts) return;
  const host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const m172 = /^172\.(\d{1,3})\./.exec(host);
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    (!!m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) ||
    /^f[cd][0-9a-f]{2}:/i.test(host) ||
    /^fe80:/i.test(host);
  if (isPrivate) {
    throw new Error(
      `refusing private/loopback image host "${host}" (pass --allow-local-hosts for LAN assets): ${raw}`,
    );
  }
}

async function readCapped(res, max) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error(`image too large (max ${max / 1024 / 1024}MB)`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function fetchImage(url, hops = 0) {
  if (hops > 3) throw new Error(`too many redirects: ${url}`);
  assertPublicHost(url);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; carddeck-editorial/1.0)" },
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) throw new Error(`redirect without a location: ${url}`);
    return fetchImage(new URL(location, url).href, hops + 1);
  }
  if (!res.ok) throw new Error(`image download failed (${res.status}): ${url}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`not an image (${type}): ${url}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new Error(`image too large (max ${MAX_IMAGE_BYTES / 1024 / 1024}MB): ${url}`);
  }
  return readCapped(res, MAX_IMAGE_BYTES);
}

async function download(url) {
  const key = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16) + ".jpg";
  const file = path.join(cacheDir, key);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const bytes = await fetchImage(url);
    fs.writeFileSync(file, bytes);
    console.log(`  ↓ ${path.basename(file)}  ${url.slice(0, 72)}…`);
  }
  return file;
}

async function resolveImage(name) {
  if (!name) return null;
  if (imageUrls.has(name)) return imageUrls.get(name);
  const src = deck.images?.[name];
  if (!src) throw new Error(`unknown image "${name}" — add it to deck.images`);
  const file = /^https?:/i.test(src) ? await download(src) : path.resolve(path.dirname(deckPath), src);
  if (!fs.existsSync(file)) throw new Error(`image not found: ${file}`);
  const mime = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
  const url = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  imageUrls.set(name, url);
  return url;
}

// ── render ──────────────────────────────────────────────────────────────────
const PHOTO_LAYOUTS = new Set(["cover", "split", "band", "fullBleedList", "quote", "close"]);
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: PAGE_W, height: PAGE_H },
  deviceScaleFactor: scale,
});

const fontOk = await page
  .setContent(`<style>body{font-family:"Segoe UI"}</style><div style="font-weight:900">A</div>`)
  .then(() => page.evaluate(() => document.fonts.check("900 100px 'Segoe UI'")))
  .catch(() => false);
if (!fontOk) {
  console.warn("! Segoe UI Black is not available — the display type will fall back. Install Segoe UI or change BASE_CSS.");
}

const ctxBase = {
  total: String(deck.slides.length).padStart(2, "0"),
  footer: deck.footer ?? { left: deck.title ?? "Deck", right: "Edited with Carddeck" },
};

const manifest = [];
for (const [i, s] of deck.slides.entries()) {
  await resolveImage(s.image);
  const ctx = {
    ...ctxBase,
    n: i + 1,
    img: (name) => {
      const url = imageUrls.get(name);
      if (!url) throw new Error(`image "${name}" was not resolved — check deck.images`);
      return url;
    },
  };
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>${LAYOUTS[s.layout](s, ctx)}</body></html>`;
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(180);

  const kind = PHOTO_LAYOUTS.has(s.layout) ? "jpg" : "png";
  const file = path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.${kind}`);
  await page.screenshot({
    path: file,
    clip: { x: 0, y: 0, width: PAGE_W, height: PAGE_H },
    ...(kind === "jpg" ? { type: "jpeg", quality: 94 } : { type: "png" }),
  });
  manifest.push({ n: i + 1, layout: s.layout, file, kind, notes: s.notes ?? "" });
  console.log(`  ${String(i + 1).padStart(2, "0")}  ${s.layout.padEnd(14)} ${Math.round(fs.statSync(file).size / 1024)}KB`);
}

// ── contact sheet ───────────────────────────────────────────────────────────
const cells = manifest
  .map((m) => {
    const mime = m.kind === "png" ? "image/png" : "image/jpeg";
    const b64 = fs.readFileSync(m.file).toString("base64");
    return `<div style="position:relative"><img src="data:${mime};base64,${b64}" style="width:100%;display:block"/>
      <span style="position:absolute;left:8px;top:8px;background:#FF4A1C;color:#fff;font:800 20px Arial;padding:2px 9px">${m.n}</span></div>`;
  })
  .join("");
await page.setContent(
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:#000;padding:14px;font-family:Arial}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}</style></head><body><div class="g">${cells}</div></body></html>`,
);
await page.waitForTimeout(800);
const preview = path.join(outDir, "preview.jpg");
await page.screenshot({ path: preview, type: "jpeg", quality: 86, fullPage: true });

// ── pptx ────────────────────────────────────────────────────────────────────
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = deck.author ?? "Carddeck";
pptx.company = deck.company ?? "Carddeck";
pptx.title = deck.title ?? "Deck";
pptx.subject = deck.subject ?? "";
pptx.lang = "en-US";
pptx.theme = { headFontFace: "Segoe UI", bodyFontFace: "Segoe UI", lang: "en-US" };

for (const m of manifest) {
  const slide = pptx.addSlide();
  slide.background = { color: "0B0D10" };
  const mime = m.kind === "png" ? "image/png" : "image/jpeg";
  slide.addImage({
    data: `data:${mime};base64,${fs.readFileSync(m.file).toString("base64")}`,
    x: 0,
    y: 0,
    w: 13.333333,
    h: 7.5,
    altText: `${deck.title} — slide ${m.n}`,
  });
  if (m.notes) slide.addNotes(m.notes);
}
const pptxPath = path.join(outDir, `${slug}.pptx`);
await pptx.writeFile({ fileName: pptxPath });

// ── pdf (optional): image pages, same pixels as the PPTX ────────────────────
let pdfPath = null;
if (withPdf) {
  const printPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pages = manifest
    .map((m) => {
      const mime = m.kind === "png" ? "image/png" : "image/jpeg";
      return `<div class="page"><img src="data:${mime};base64,${fs.readFileSync(m.file).toString("base64")}"></div>`;
    })
    .join("");
  await printPage.setContent(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page{size:13.333in 7.5in;margin:0}
      html,body{margin:0;padding:0;background:#000}
      .page{width:13.333in;height:7.5in;overflow:hidden;page-break-after:always;break-after:page}
      .page:last-child{page-break-after:auto;break-after:auto}
      .page img{width:100%;height:100%;object-fit:cover;display:block}
    </style></head><body>${pages}</body></html>`,
    { waitUntil: "load" },
  );
  await printPage.waitForTimeout(1200);
  pdfPath = path.join(outDir, `${slug}.pdf`);
  await printPage.pdf({
    path: pdfPath,
    width: "13.333in",
    height: "7.5in",
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    printBackground: true,
    preferCSSPageSize: true,
  });
  await printPage.close();
}

await browser.close();
fs.writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify({ title: deck.title, source: deckPath, slides: manifest, pptx: pptxPath, pdf: pdfPath, preview }, null, 1),
);

console.log(`\n  deck   ${pptxPath}  ${Math.round(fs.statSync(pptxPath).size / 1024)}KB`);
if (pdfPath) console.log(`  pdf    ${pdfPath}  ${Math.round(fs.statSync(pdfPath).size / 1024)}KB`);
console.log(`  sheet  ${preview}`);
console.log(`  ${manifest.length} slides · ${manifest.length} notes · done`);
