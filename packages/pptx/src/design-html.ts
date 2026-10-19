/**
 * Designed print/PDF renderer.
 *
 * The original print path renders semantic HTML: fine for long-form documents,
 * but a presentation flattened into that flow loses the card grids, KPI tiles,
 * cover photography, and real charts that define the deck. This renderer mirrors
 * the designed PowerPoint composition in the browser so `deck.pdf` is a
 * first-class deliverable, not a debug printout.
 *
 * Every slide is a fixed 1280x720 page. Images inline as data URLs, charts are
 * drawn as SVG, and the same theme tokens drive both this file and
 * `design-pptx.ts`.
 */
import type { Block, Inline, Theme } from "@carddeck/core";
import { resolveBlockImages, type ImageMap, type ImageResolver } from "./images";
import type { SlideDeck, SlideInput } from "./render-slides";

export interface DesignedPrintOptions {
  /**
   * Resolve image blocks to data URLs. Chromium's print path has no session or
   * base URL, so images must travel inside the document.
   */
  resolveImage?: ImageResolver;
}

const W = 1280;
const H = 720;
const M = 62;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hex(color: string): string {
  return color.replace("#", "");
}

function rgb(color: string): string {
  const value = color.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(", ");
}

function rgba(color: string, alpha: number): string {
  return `rgba(${rgb(color)}, ${alpha})`;
}

function plain(runs: Inline[] | string): string {
  if (typeof runs === "string") return runs;
  return runs.map((run) => (typeof run === "string" ? run : run.text)).join("");
}

function inlineHtml(runs: Inline[]): string {
  return runs
    .map((run) => {
      if (typeof run === "string") return esc(run);
      let value = esc(run.text);
      if (run.bold) value = `<strong>${value}</strong>`;
      if (run.italic) value = `<em>${value}</em>`;
      if (run.link) value = `<a href="${esc(run.link)}">${value}</a>`;
      return value;
    })
    .join("");
}

function headingText(card: SlideInput): string {
  const heading = card.blocks.find((block) => block.type === "heading");
  if (heading && heading.type === "heading") {
    const value = plain(heading.text).trim();
    if (value) return value;
  }
  return card.title;
}

function first<T extends Block["type"]>(
  blocks: Block[],
  type: T,
): Extract<Block, { type: T }> | undefined {
  return blocks.find((block) => block.type === type) as
    | Extract<Block, { type: T }>
    | undefined;
}

function isDuplicateTitle(block: Block, card: SlideInput): boolean {
  return (
    block.type === "heading" &&
    plain(block.text).trim().toLowerCase() === card.title.trim().toLowerCase()
  );
}

function imageFor(
  blocks: Block[],
  layout: "side" | "behind",
): Extract<Block, { type: "image" }> | undefined {
  return blocks.find(
    (block): block is Extract<Block, { type: "image" }> =>
      block.type === "image" && block.layout === layout,
  );
}

function imageUrl(images: ImageMap, block: Extract<Block, { type: "image" }> | undefined) {
  if (!block) return null;
  return images.get(block.src.trim()) ?? null;
}

function caption(label: string | undefined, extra = ""): string {
  return label ? `<div class="caption" ${extra}><span>${esc(label)}</span></div>` : "";
}

function columnStat(blocks: Block[]): { metric: string; label: string; body: string } {
  let metric = "";
  let label = "";
  const body: string[] = [];
  for (const block of blocks) {
    if (block.type === "heading" && !metric) metric = plain(block.text).trim();
    else if (block.type === "callout" && !label) label = plain(block.text).trim();
    else if (block.type === "paragraph" || block.type === "quote") body.push(plain(block.text).trim());
    else if (block.type === "bulletList" || block.type === "numberedList") {
      for (const item of block.items) body.push(plain(item).trim());
    } else if (block.type === "heading") body.push(plain(block.text).trim());
  }
  return { metric, label, body: body.filter(Boolean).join("  ·  ") };
}

function toneColor(tone: "info" | "warn" | "success", theme: Theme): string {
  if (tone === "warn") return "#f59e0b";
  if (tone === "success") return "#22c55e";
  return theme.colors.accent;
}

function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 10;
  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * power;
}

function chartColors(block: Extract<Block, { type: "chart" }>, theme: Theme): string[] {
  if (block.data.series.length === 1) {
    const values = block.data.series[0].values;
    const max = Math.max(...values);
    return block.data.labels.map((_, index) =>
      values[index] === max ? theme.colors.accent : theme.colors.muted,
    );
  }
  return [theme.colors.accent, "#22c55e", "#f59e0b", theme.colors.muted, theme.colors.ink];
}

function chartSvg(
  block: Extract<Block, { type: "chart" }>,
  theme: Theme,
  compact = false,
): { svg: string; legend: string; donut: boolean } {
  const labels = block.data.labels;
  const series = block.data.series;
  const colors = chartColors(block, theme);
  const muted = theme.colors.muted;
  const ink = theme.colors.ink;
  const surface = theme.colors.surface;

  if (block.kind === "donut") {
    const values = series[0]?.values ?? [];
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    const radius = 96;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const segments = values
      .map((value, index) => {
        const length = (Math.max(0, value) / total) * circumference;
        const color = colors[index % colors.length];
        const segment = `<circle cx="200" cy="150" r="${radius}" fill="none" stroke="${color}" stroke-width="42" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 200 150)" />`;
        offset += length;
        return segment;
      })
      .join("");
    const svg = `<svg viewBox="0 0 400 300" role="img" aria-label="${esc(block.kind)} chart">
      <circle cx="200" cy="150" r="${radius}" fill="none" stroke="${rgba(surface, 0.7)}" stroke-width="42" />
      ${segments}
      <text x="200" y="146" text-anchor="middle" fill="${ink}" font-family="inherit" font-size="34" font-weight="700">${total}</text>
      <text x="200" y="172" text-anchor="middle" fill="${muted}" font-family="inherit" font-size="12" letter-spacing="1.6">TOTAL</text>
    </svg>`;
    const legend = series
      .map(
        (entry, seriesIndex) =>
          `<span class="legend-item"><i style="background:${colors[seriesIndex % colors.length]}"></i>${esc(entry.name)}</span>`,
      )
      .join("");
    return { svg, legend, donut: true };
  }

  const values = series.flatMap((entry) => entry.values);
  const max = niceMax(Math.max(...values, 0));
  const plot = compact
    ? { x: 62, y: 8, w: 900, h: 102 }
    : { x: 62, y: 18, w: 900, h: 240 };
  const viewH = compact ? 156 : 300;
  const labelY = plot.y + plot.h + (compact ? 20 : 28);
  const labelSize = compact ? 12 : 14;
  const valueSize = compact ? 12 : 14;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const y = plot.y + (plot.h / 4) * index;
    const value = Math.round(max - (max / 4) * index);
    return `<line x1="${plot.x}" y1="${y}" x2="${plot.x + plot.w}" y2="${y}" stroke="${rgba(muted, 0.32)}" stroke-width="1" stroke-dasharray="2 5" />
      <text x="${plot.x - 12}" y="${y + 4}" text-anchor="end" fill="${muted}" font-family="inherit" font-size="${labelSize}">${value}</text>`;
  }).join("");

  if (block.kind === "line") {
    const pointsFor = (entry: { values: number[] }) =>
      entry.values
        .map((value, index) => {
          const x = plot.x + (plot.w / Math.max(1, labels.length - 1)) * index;
          const y = plot.y + plot.h - (Math.max(0, value) / max) * plot.h;
          return { x, y, value };
        });
    const lines = series
      .map((entry, seriesIndex) => {
        const points = pointsFor(entry);
        const color = series.length === 1 ? theme.colors.accent : colors[seriesIndex % colors.length];
        const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
        const dots = points
          .map(
            (point) =>
              `<circle cx="${point.x}" cy="${point.y}" r="${compact ? 4 : 5.5}" fill="${color}" stroke="${surface}" stroke-width="2" />`,
          )
          .join("");
        return `<polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="${compact ? 2.5 : 3.5}" stroke-linecap="round" stroke-linejoin="round" />${dots}`;
      })
      .join("");
    const xLabels = labels
      .map((label, index) => {
        const x = plot.x + (plot.w / Math.max(1, labels.length - 1)) * index;
        return `<text x="${x}" y="${labelY}" text-anchor="middle" fill="${muted}" font-family="inherit" font-size="${labelSize}">${esc(label)}</text>`;
      })
      .join("");
    const svg = `<svg viewBox="0 0 1000 ${viewH}" role="img" aria-label="line chart">${grid}${xLabels}${lines}</svg>`;
    const legend = series
      .map((entry, seriesIndex) => {
        const color = series.length === 1 ? theme.colors.accent : colors[seriesIndex % colors.length];
        return `<span class="legend-item"><i style="background:${color}"></i>${esc(entry.name)}</span>`;
      })
      .join("");
    return { svg, legend, donut: false };
  }

  const groupWidth = plot.w / Math.max(1, labels.length);
  const barWidth = Math.min(compact ? 46 : 58, (groupWidth * 0.62) / Math.max(1, series.length));
  const bars = series
    .map((entry, seriesIndex) => {
      const color =
        series.length === 1
          ? colors
          : colors[seriesIndex % colors.length];
      return entry.values
        .map((value, index) => {
          const barColor = Array.isArray(color) ? color[index % color.length] : color;
          const groupX = plot.x + index * groupWidth + groupWidth / 2;
          const totalWidth = barWidth * series.length;
          const x = groupX - totalWidth / 2 + seriesIndex * barWidth;
          const height = (Math.max(0, value) / max) * plot.h;
          const y = plot.y + plot.h - height;
          return `<rect x="${x}" y="${y}" width="${barWidth - 4}" height="${height}" rx="3" fill="${barColor}" />
            <text x="${x + (barWidth - 4) / 2}" y="${y - 6}" text-anchor="middle" fill="${ink}" font-family="inherit" font-size="${valueSize}" font-weight="700">${value}</text>`;
        })
        .join("");
    })
    .join("");
  const xLabels = labels
    .map((label, index) => {
      const x = plot.x + index * groupWidth + groupWidth / 2;
      return `<text x="${x}" y="${labelY}" text-anchor="middle" fill="${muted}" font-family="inherit" font-size="${labelSize}">${esc(label)}</text>`;
    })
    .join("");
  const svg = `<svg viewBox="0 0 1000 ${viewH}" role="img" aria-label="bar chart">${grid}${xLabels}${bars}</svg>`;
  const legend = series
    .map((entry, seriesIndex) => {
      const color = series.length === 1 ? theme.colors.accent : colors[seriesIndex % colors.length];
      return `<span class="legend-item"><i style="background:${color}"></i>${esc(entry.name)}</span>`;
    })
    .join("");
  return { svg, legend, donut: false };
}

function chartHtml(
  block: Extract<Block, { type: "chart" }>,
  theme: Theme,
  compact = false,
): string {
  const { svg, legend, donut } = chartSvg(block, theme, compact);
  const names = block.data.series.map((series) => series.name).join("  ·  ");
  return `<div class="chart-card">
    <div class="chart-kicker"><span>${esc(block.kind)} / ${esc(names)}</span></div>
    <div class="chart-canvas${donut ? " donut" : ""}">${svg}</div>
    <div class="legend">${legend}</div>
  </div>`;
}

function blockHtml(
  block: Block,
  ctx: { theme: Theme; card: SlideInput; images: ImageMap; inColumn?: boolean; compact?: boolean },
): string {
  const { theme, images } = ctx;
  switch (block.type) {
    case "heading": {
      const size = block.level === 3 ? 27 : block.level === 2 ? 32 : 40;
      return `<h2 style="font-size:${size}px">${inlineHtml(block.text)}</h2>`;
    }
    case "paragraph":
      return `<p>${inlineHtml(block.text)}</p>`;
    case "bulletList":
    case "numberedList": {
      const numbered = block.type === "numberedList";
      const rows = block.items
        .map(
          (item, index) =>
            `<div class="list-row"><span class="list-mark">${
              numbered ? String(index + 1).padStart(2, "0") : "•"
            }</span><span>${inlineHtml(item)}</span></div>`,
        )
        .join("");
      return `<div class="list">${rows}</div>`;
    }
    case "quote":
      return `<blockquote><p>${inlineHtml(block.text)}</p>${
        block.attribution
          ? `<p class="quote-attribution">${esc(block.attribution.toUpperCase())}</p>`
          : ""
      }</blockquote>`;
    case "callout": {
      const tone = toneColor(block.tone, theme);
      return `<div class="callout" style="--tone:${tone}"><span>${esc(plain(block.text).toUpperCase())}</span></div>`;
    }
    case "divider":
      return `<hr />`;
    case "columns": {
      const n = Math.max(1, block.columns.length);
      const cells = block.columns
        .map((column, index) => {
          const stat = columnStat(column);
          const metricIsLong = stat.metric.length > 18;
          const tightFit = n >= 4 && stat.metric.length > 8;
          const size = metricIsLong ? 27 : tightFit ? 32 : 40;
          return `<div class="col-card${index === 0 ? " accent" : ""}">
            <div class="col-rule"></div>
            <div class="col-number"><span>${String(index + 1).padStart(2, "0")}</span></div>
            <div class="col-metric" style="font-size:${size}px;color:${
              index === 0 ? theme.colors.accent : theme.colors.ink
            }"><span>${esc(stat.metric || stat.body.split("  ·  ")[0] || "")}</span></div>
            ${
              stat.label
                ? `<div class="col-label" style="color:${
                    index === 0 ? theme.colors.accent : theme.colors.muted
                  }"><span>${esc(stat.label.toUpperCase())}</span></div>`
                : ""
            }
            ${stat.body ? `<div class="col-body"><span>${esc(stat.body)}</span></div>` : ""}
          </div>`;
        })
        .join("");
      return `<div class="columns" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${cells}</div>`;
    }
    case "chart":
      return chartHtml(block, theme, ctx.compact);
    case "image": {
      if (block.layout !== "full") return "";
      const url = images.get(block.src.trim()) ?? null;
      if (!url) {
        return `<div class="image-placeholder"><span>${esc(block.caption ?? "Image unavailable")}</span></div>`;
      }
      return `<figure class="full-image"><img src="${esc(url)}" alt="${esc(
        block.caption ?? "",
      )}" />${block.caption ? `<figcaption>${esc(block.caption)}</figcaption>` : ""}</figure>`;
    }
    default: {
      const _never: never = block;
      void _never;
      return "";
    }
  }
}

function headerHtml(
  deck: SlideDeck,
  card: SlideInput,
  index: number,
  total: number,
  titleStyle: string,
): string {
  return `<div class="slide-header">
    <div class="kicker"><span>${esc(deck.title.toUpperCase())}</span></div>
    <div class="page-no"><span>${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span></div>
    <h1 style="${titleStyle}">${esc(card.title)}</h1>
    <div class="title-rule"></div>
  </div>`;
}

/**
 * A wrapped title must push the body down instead of being cut off with an
 * ellipsis: returns the inline style for the header and the top edge the body
 * should start from.
 */
function titleMetrics(title: string): { style: string; bodyTop: number } {
  const steps = [
    { size: 40, perLine: 54 },
    { size: 35, perLine: 62 },
    { size: 30, perLine: 73 },
  ];
  let chosen = steps[0];
  let lines = Math.max(1, Math.ceil(title.length / chosen.perLine));
  for (const step of steps) {
    const candidate = Math.max(1, Math.ceil(title.length / step.perLine));
    if (candidate === 1 || step.size === 30) {
      chosen = step;
      lines = candidate;
      break;
    }
  }
  return {
    style: `font-size:${chosen.size}px`,
    bodyTop: 167 + (lines - 1) * Math.round(chosen.size * 1.12),
  };
}

function footerHtml(deck: SlideDeck, index: number, total: number): string {
  return `<div class="slide-footer">
    <div class="footer-line"></div>
    <div class="footer-title"><span>${esc(deck.title.toUpperCase())}</span></div>
    <div class="footer-page"><span>${index + 1} / ${total}</span></div>
  </div>`;
}

function coverHtml(
  deck: SlideDeck,
  card: SlideInput,
  images: ImageMap,
  index: number,
  total: number,
): string {
  const behind = imageFor(card.blocks, "behind");
  const url = imageUrl(images, behind);
  const art = url
    ? `<div class="cover-art"><img src="${esc(url)}" alt="${esc(
        behind?.caption ?? "",
      )}" /></div>`
    : `<div class="cover-orbs"><div></div><div></div><div></div></div>`;
  const title = headingText(card);
  const subtitle = (() => {
    const paragraph = first(card.blocks, "paragraph");
    return paragraph ? plain(paragraph.text) : "";
  })();
  const callout = first(card.blocks, "callout");
  const chip = callout ? plain(callout.text) : "";
  const kicker = (() => {
    const block = card.blocks.slice(1).find((entry) => entry.type === "heading");
    return block && block.type === "heading" ? plain(block.text).trim() : "";
  })();

  return `<section class="slide-page cover">
    ${art}
    <div class="cover-shade"></div>
    <div class="cover-copy">
      ${kicker ? `<div class="cover-eyebrow"><span>${esc(kicker.toUpperCase())}</span></div>` : ""}
      <h1 class="cover-title" style="font-size:${title.length > 30 ? 56 : 66}px">${esc(title)}</h1>
      ${subtitle ? `<p class="cover-sub">${esc(subtitle)}</p>` : ""}
      ${chip ? `<div class="cover-chip"><span>${esc(chip.toUpperCase())}</span></div>` : ""}
      <div class="cover-meta"><span>${esc(
        `${deck.title.toUpperCase()}  ·  ${total} SLIDES  ·  16:9 PPTX`,
      )}</span></div>
    </div>
    <div class="cover-index"><span>${String(index + 1).padStart(2, "0")}</span></div>
    ${caption(behind?.caption)}
    <div class="cover-page"><span>${index + 1} / ${total}</span></div>
  </section>`;
}

function closingHtml(
  deck: SlideDeck,
  card: SlideInput,
  images: ImageMap,
  index: number,
  total: number,
): string {
  const behind = imageFor(card.blocks, "behind");
  const url = imageUrl(images, behind);
  const art = url
    ? `<div class="cover-art closing-art"><img src="${esc(url)}" alt="${esc(
        behind?.caption ?? "",
      )}" /></div>`
    : `<div class="cover-orbs closing-orbs"><div></div><div></div></div>`;
  const quote = first(card.blocks, "quote");
  const callout = first(card.blocks, "callout");
  const paragraph = first(card.blocks, "paragraph");
  const title = headingText(card);
  const cta = callout ? plain(callout.text) : `${deck.title} — presented in 16:9`;

  return `<section class="slide-page closing">
    ${art}
    <div class="cover-shade closing-shade"></div>
    <div class="closing-copy">
      <div class="cover-eyebrow"><span>${esc(`${deck.title.toUpperCase()}  ·  CLOSE`)}</span></div>
      <h1 class="closing-title">${esc(title)}</h1>
      ${
        quote
          ? `<blockquote class="closing-quote"><p>${inlineHtml(quote.text)}</p>${
              quote.attribution
                ? `<p class="quote-attribution">${esc(quote.attribution.toUpperCase())}</p>`
                : ""
            }</blockquote>`
          : ""
      }
      <div class="cover-chip closing-chip"><span>${esc(cta.toUpperCase())}</span></div>
      ${paragraph ? `<p class="closing-body">${inlineHtml(paragraph.text)}</p>` : ""}
    </div>
    ${caption(behind?.caption)}
    ${footerHtml(deck, index, total)}
  </section>`;
}

function contentHtml(
  deck: SlideDeck,
  card: SlideInput,
  images: ImageMap,
  index: number,
  total: number,
): string {
  const side = imageFor(card.blocks, "side");
  const sideUrl = imageUrl(images, side);
  const blocks = card.blocks.filter((block, blockIndex) => {
    if (block.type === "image" && (block.layout === "side" || block.layout === "behind")) {
      return false;
    }
    if (blockIndex === 0 && isDuplicateTitle(block, card)) return false;
    return true;
  });

  const body = blocks
    .map((block, blockIndex) =>
      blockHtml(block, {
        theme: deck.theme,
        card,
        images,
        compact:
          block.type === "chart" &&
          blocks.slice(0, blockIndex).some((entry) => entry.type === "columns"),
      }),
    )
    .join("");

  const title = titleMetrics(card.title);
  return `<section class="slide-page content" style="--body-top:${title.bodyTop}px">
    <div class="watermark"></div>
    ${headerHtml(deck, card, index, total, title.style)}
    ${
      sideUrl
        ? `<div class="side-image"><img src="${esc(sideUrl)}" alt="${esc(
            side?.caption ?? "",
          )}" /><div class="side-caption"><span>${esc(side?.caption ?? "")}</span></div></div>`
        : ""
    }
    <div class="body${sideUrl ? " has-side" : ""}">${body}</div>
    ${footerHtml(deck, index, total)}
  </section>`;
}

function baseCss(theme: Theme): string {
  return `
    :root { color-scheme: dark; }
    @page { size: ${W}px ${H}px; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #${hex(theme.colors.page)}; }
    body { font-family: '${theme.fonts.body}', 'Inter', 'DejaVu Sans', sans-serif; }
    .slide-page {
      --page: #${hex(theme.colors.page)};
      --page-rgb: ${rgb(theme.colors.page)};
      --surface: #${hex(theme.colors.surface)};
      --ink: #${hex(theme.colors.ink)};
      --muted: #${hex(theme.colors.muted)};
      --accent: #${hex(theme.colors.accent)};
      --display: '${theme.fonts.display}', 'Inter', 'DejaVu Sans', sans-serif;
      position: relative;
      width: ${W}px;
      height: ${H}px;
      overflow: hidden;
      background: var(--page);
      color: var(--ink);
      page-break-after: always;
      break-after: page;
    }
    .slide-page:last-child { page-break-after: auto; break-after: auto; }
    .slide-header { position: absolute; left: ${M}px; top: 35px; right: ${M}px; }
    .kicker { font-size: 13px; font-weight: 700; letter-spacing: 2.2px; color: var(--muted); }
    .page-no { position: absolute; right: 0; top: 0; font-size: 13px; font-weight: 700; color: var(--accent); }
    .slide-header h1 {
      margin: 20px 0 0;
      font-family: var(--display);
      font-size: 40px;
      font-weight: 700;
      line-height: 1.06;
      letter-spacing: -0.3px;
      color: var(--ink);
      max-width: 1100px;
      overflow-wrap: break-word;
    }
    .title-rule { width: 88px; height: 4px; margin-top: 17px; background: var(--accent); border-radius: 2px; }
    .body {
      position: absolute;
      left: ${M}px;
      top: var(--body-top, 167px);
      width: 1156px;
      height: calc(653px - var(--body-top, 167px));
      display: flex;
      flex-direction: column;
      gap: 19px;
    }
    .body.has-side { width: 706px; }
    .body > * { flex: 0 0 auto; }
    .body p { margin: 0; font-size: 20px; line-height: 1.6; color: var(--ink); }
    .body h2 { margin: 0; font-family: var(--display); line-height: 1.15; color: var(--ink); }
    .body hr { width: 100%; border: 0; border-top: 1px solid ${rgba(theme.colors.muted, 0.3)}; margin: 0; }
    .list { display: flex; flex-direction: column; gap: 12px; }
    .list-row { display: flex; gap: 14px; font-size: 17px; line-height: 1.55; color: var(--ink); }
    .list-mark { flex: 0 0 28px; font-weight: 700; color: var(--accent); }
    blockquote {
      margin: 0;
      padding: 2px 0 2px 20px;
      border-left: 4px solid var(--accent);
      color: var(--ink);
      font-style: italic;
      font-size: 30px;
      line-height: 1.45;
    }
    blockquote p { margin: 0; }
    blockquote .quote-attribution {
      display: block;
      margin: 11px 0 0;
      font-family: var(--body);
      font-style: normal;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1.4px;
      color: var(--accent);
    }
    .callout {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      min-height: 42px;
      padding: 9px 20px;
      border-radius: 12px;
      border: 1px solid ${rgba(theme.colors.accent, 0.7)};
      background: color-mix(in srgb, var(--tone, var(--accent)) 14%, transparent);
      color: var(--ink);
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 1.2px;
      white-space: nowrap;
    }
    .columns { display: grid; gap: 27px; width: 100%; }
    .col-card {
      position: relative;
      min-height: 235px;
      padding: 27px 23px 23px;
      border-radius: 14px;
      border: 1px solid ${rgba(theme.colors.muted, 0.34)};
      background: ${rgba(theme.colors.surface, 0.9)};
      box-shadow: 0 16px 38px rgba(0, 0, 0, 0.24);
    }
    .col-card.accent { border-color: ${rgba(theme.colors.accent, 0.9)}; }
    .col-rule { width: 37px; height: 3px; background: var(--accent); border-radius: 2px; }
    .col-number { position: absolute; right: 20px; top: 20px; font-size: 9px; font-weight: 700; color: var(--muted); }
    .col-metric {
      margin-top: 15px;
      font-family: var(--display);
      font-weight: 700;
      line-height: 1;
      letter-spacing: -0.5px;
    }
    .col-label {
      margin-top: 27px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1.3px;
    }
    .col-body {
      margin-top: 15px;
      font-size: 17px;
      line-height: 1.55;
      color: var(--muted);
    }
    .chart-card {
      flex: 1 1 auto;
      min-height: 210px;
      display: flex;
      flex-direction: column;
      padding: 20px 26px 16px;
      border-radius: 14px;
      border: 1px solid ${rgba(theme.colors.accent, 0.9)};
      background: ${rgba(theme.colors.surface, 0.92)};
      box-shadow: 0 16px 38px rgba(0, 0, 0, 0.24);
    }
    .chart-kicker { font-size: 13px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--accent); }
    .chart-canvas { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; }
    .chart-canvas svg { width: 100%; height: 100%; display: block; }
    .chart-canvas.donut svg { max-width: 440px; }
    .legend { display: flex; justify-content: center; gap: 22px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
    .legend-item { display: inline-flex; align-items: center; gap: 7px; }
    .legend-item i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
    .full-image { margin: 0; }
    .full-image img, .side-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .full-image { flex: 1 1 auto; min-height: 0; }
    .full-image img { border-radius: 10px; max-height: 100%; }
    .full-image figcaption, .caption {
      margin-top: 7px;
      font-size: 12px;
      font-style: italic;
      color: var(--muted);
      text-align: right;
    }
    .image-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 150px;
      border: 1px dashed ${rgba(theme.colors.muted, 0.5)};
      border-radius: 10px;
      color: var(--muted);
      font-size: 15px;
    }
    .side-image {
      position: absolute;
      left: 821px;
      top: var(--body-top, 169px);
      width: 394px;
      height: calc(625px - var(--body-top, 169px));
    }
    .side-image img { border-radius: 4px; }
    .side-image::before {
      content: "";
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 4px;
      background: ${rgba(theme.colors.accent, 0.85)};
      z-index: 2;
    }
    .side-caption { margin-top: 7px; font-size: 12px; font-style: italic; color: var(--muted); text-align: right; }
    .watermark {
      position: absolute;
      right: -120px;
      top: -330px;
      width: 620px;
      height: 620px;
      border-radius: 50%;
      border: 1px solid ${rgba(theme.colors.accent, 0.16)};
      background: ${rgba(theme.colors.accent, 0.025)};
    }
    .slide-footer { position: absolute; left: ${M}px; right: ${M}px; bottom: 23px; }
    .footer-line { height: 1px; background: ${rgba(theme.colors.muted, 0.24)}; margin-bottom: 8px; }
    .footer-title { font-size: 9px; font-weight: 700; letter-spacing: 1.4px; color: var(--muted); }
    .footer-page { position: absolute; right: 0; top: 9px; font-size: 9px; font-weight: 700; color: var(--muted); }
    .cover-art { position: absolute; inset: 0; }
    .cover-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .cover-art::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgb(var(--page-rgb)) 0 56%, ${rgba(theme.colors.page, 0.56)} 56% 100%),
        ${rgba(theme.colors.page, 0.34)};
    }
    .cover-shade {
      position: absolute;
      top: 0; bottom: 0; left: 56%;
      width: 3px;
      background: ${rgba(theme.colors.accent, 0.7)};
    }
    .cover-copy {
      position: absolute;
      left: ${M}px;
      top: 74px;
      bottom: 49px;
      width: 600px;
      display: flex;
      flex-direction: column;
    }
    .cover-eyebrow { font-size: 13px; font-weight: 700; letter-spacing: 2.5px; color: var(--accent); }
    .cover-title {
      margin: 35px 0 0;
      font-family: var(--display);
      font-weight: 700;
      line-height: 0.98;
      letter-spacing: -1.2px;
      color: var(--ink);
    }
    .cover-sub {
      margin: 74px 0 0;
      max-width: 565px;
      font-size: 27px;
      line-height: 1.5;
      color: var(--muted);
    }
    .cover-chip {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      width: fit-content;
      margin-top: 62px;
      padding: 12px 22px;
      border-radius: 12px;
      border: 1px solid ${rgba(theme.colors.accent, 0.8)};
      background: ${rgba(theme.colors.accent, 0.13)};
      color: var(--ink);
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 1.1px;
    }
    .cover-meta {
      margin-top: auto;
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 1.5px;
      color: var(--muted);
    }
    .cover-index { position: absolute; right: ${M}px; top: 75px; font-size: 13px; font-weight: 700; color: var(--muted); }
    .cover .caption { position: absolute; right: ${M}px; bottom: 27px; max-width: 420px; }
    .cover-page { display: none; }
    .closing-art::after {
      background:
        linear-gradient(90deg, rgb(var(--page-rgb)) 0 63%, ${rgba(theme.colors.page, 0.48)} 63% 100%),
        ${rgba(theme.colors.page, 0.4)};
    }
    .closing-shade { left: 63%; }
    .closing-copy { position: absolute; left: ${M}px; top: 79px; width: 820px; }
    .closing-title {
      margin: 34px 0 0;
      font-family: var(--display);
      font-size: 54px;
      font-weight: 700;
      line-height: 1.04;
      letter-spacing: -1px;
      color: var(--ink);
    }
    .closing-quote { margin: 50px 0 0; width: 720px; font-size: 32px; }
    .closing-chip { margin-top: 56px; font-size: 16px; }
    .closing-body { margin: 20px 0 0; width: 720px; font-size: 20px; line-height: 1.55; color: var(--muted); }
    .closing .caption { position: absolute; right: ${M}px; bottom: 49px; max-width: 420px; }
    .cover-orbs, .closing-orbs { position: absolute; inset: 0; }
    .cover-orbs div {
      position: absolute;
      border-radius: 50%;
      border: 1px solid ${rgba(theme.colors.accent, 0.45)};
      background: ${rgba(theme.colors.accent, 0.06)};
    }
    .cover-orbs div:nth-child(1) { width: 394px; height: 394px; right: 40px; top: 34px; }
    .cover-orbs div:nth-child(2) { width: 240px; height: 240px; right: 187px; top: 326px; background: ${rgba(theme.colors.ink, 0.03)}; }
    .cover-orbs div:nth-child(3) { width: 269px; height: 269px; right: 254px; top: 120px; transform: rotate(18deg); border-radius: 28px; background: ${rgba(theme.colors.surface, 0.7)}; }
    .closing-orbs div:nth-child(1) { width: 442px; height: 442px; right: 65px; top: 115px; }
    .closing-orbs div:nth-child(2) { width: 211px; height: 211px; right: 200px; top: 288px; background: ${rgba(theme.colors.surface, 0.7)}; }
  `;
}

/**
 * Render the whole deck as designed presentation pages. `document` format is
 * intentionally not offered here; flowing A4 text still goes through
 * `renderPrintHtml`, while this function is the visual `presentation` export.
 */
function pageHtml(
  deck: SlideDeck,
  card: SlideInput,
  images: ImageMap,
  index: number,
  total: number,
): string {
  if (index === 0) return coverHtml(deck, card, images, index, total);
  if (index === total - 1 && total > 1) {
    return closingHtml(deck, card, images, index, total);
  }
  return contentHtml(deck, card, images, index, total);
}

/**
 * One standalone 1280x720 HTML document per slide.
 *
 * The print renderer emits every page into a single document for Chromium's
 * paginator. HTML-to-PPTX converters (PPTAgent's `html2pptx`) instead take one
 * file per slide and derive the canvas from `body`'s box — so the body is
 * pinned to exactly W×H here, and each document carries a single `.slide-page`.
 */
export async function renderDesignedSlidesHtml(
  deck: SlideDeck,
  cards: SlideInput[],
  opts: DesignedPrintOptions = {},
): Promise<string[]> {
  const images = opts.resolveImage
    ? await resolveBlockImages(cards, opts.resolveImage)
    : new Map<string, string | null>();
  const total = cards.length;

  return cards.map((card, index) => {
    const page = pageHtml(deck, card, images, index, total);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(deck.title)} — ${index + 1}</title>
<style>${baseCss(deck.theme)}
html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
</style>
</head>
<body>${page}</body>
</html>`;
  });
}

export async function renderDesignedPrintHtml(
  deck: SlideDeck,
  cards: SlideInput[],
  opts: DesignedPrintOptions = {},
): Promise<string> {
  const images = opts.resolveImage
    ? await resolveBlockImages(cards, opts.resolveImage)
    : new Map<string, string | null>();
  const total = cards.length;

  const pages = cards.map((card, index) => pageHtml(deck, card, images, index, total));

  if (pages.length === 0) {
    pages.push(`<section class="slide-page content" style="--body-top:167px">${headerHtml(
      deck,
      { id: "empty", title: deck.title, blocks: [] },
      0,
      1,
      "font-size:40px",
    )}</section>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(deck.title)}</title>
<style>${baseCss(deck.theme)}</style>
</head>
<body>${pages.join("")}</body>
</html>`;
}
