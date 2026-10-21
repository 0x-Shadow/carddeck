/**
 * Editorial layout library — eleven compositions, built from the same tokens.
 *
 * Every function returns a full 1920x1080 slide as an HTML string. The
 * renderer screenshots each one at 2x, so these are the actual slides.
 *
 * Rules the layouts enforce:
 *  - text never shares a column with a photo (split layouts use a text column)
 *  - full-bleed text sits on a scrim, never directly on a busy photo
 *  - one idea per slide: a title of 2-3 short lines plus at most 4 supports
 */

import { T, chrome, foot, kick, titleLines, bodyStack, statBlock, esc, inline } from "./theme.mjs";

const toneText = (tone) => (tone === "bone" ? "rgba(11,13,16,.66)" : "rgba(242,238,228,.66)");
const toneRule = (tone) => (tone === "bone" ? "rgba(11,13,16,.16)" : "rgba(242,238,228,.16)");
const toneMuted = (tone) => (tone === "bone" ? "rgba(11,13,16,.42)" : "rgba(242,238,228,.45)");

/** 01 — full-bleed cover. Heavy display type, photo behind a left scrim. */
export function cover(s, ctx) {
  return `<div class="slide ink">
    <img class="photo" src="${ctx.img(s.image)}" style="inset:0;width:1920px;height:1080px;object-position:${s.pos ?? "50% 40%"}">
    <div class="scrim-l"></div><div class="scrim-b"></div><div class="grain"></div>
    ${chrome(ctx.n, ctx.total, T.bone)}
    <div style="position:absolute;left:88px;bottom:${s.bottom ?? 196}px;width:${s.width ?? 1240}px;z-index:4">
      ${kick(s.kicker, "rgba(242,238,228,.8)")}
      <h1 class="h1" style="font-size:${s.size ?? 158}px;margin-top:34px">${titleLines(s.title, { tone: "ink" })}</h1>
      ${s.lede ? `<p class="body" style="margin-top:40px;width:${s.ledeWidth ?? 790}px;font-size:28px;color:rgba(242,238,228,.72)">${esc(s.lede)}</p>` : ""}
    </div>
    ${foot(ctx, s.foot, T.bone)}
  </div>`;
}

/** 02 — photo panel + text column. The workhorse for benefit slides. */
export function split(s, ctx) {
  const tone = s.tone ?? "bone";
  const side = s.side ?? "right";
  const photoW = s.imgW ?? 740;
  const gap = s.gap ?? 100;
  const textX = s.textX ?? (side === "right" ? 88 : photoW + gap);
  const textW = s.textW ?? (side === "right" ? 1920 - photoW - gap - 88 : 1832 - textX);
  const photoStyle =
    side === "right"
      ? `right:0;top:0;width:${photoW}px;height:1080px`
      : `left:0;top:0;width:${photoW}px;height:1080px`;
  const barX = side === "right" ? 1920 - photoW - 7 : photoW;

  const rows = (s.rows ?? [])
    .map(
      (r, i) => `<div style="border-top:1px solid ${toneRule(tone)};padding:20px 0 18px">
        <div style="display:flex;gap:20px;align-items:baseline">
          <span class="mono acc" style="font-size:14px;letter-spacing:.14em">0${i + 1}</span>
          <div>
            <div style="font-size:${s.rowSize ?? 26}px;font-weight:700;letter-spacing:-.015em">${esc(r.t)}</div>
            ${r.s ? `<div style="font-size:19px;color:${toneMuted(tone)};margin-top:6px">${esc(r.s)}</div>` : ""}
          </div>
        </div>
      </div>`,
    )
    .join("");

  const pairs = (s.pairs ?? [])
    .map(
      (p, i) => `<div style="display:flex;gap:18px;align-items:baseline;${i ? "margin-top:26px" : ""}">
        <span class="mono ${p.accent ? "acc" : ""}" style="font-size:13px;letter-spacing:.16em;width:106px;flex:0 0 auto;color:${p.accent ? T.accent : toneMuted(tone)}">${esc(p.label)}</span>
        <div style="font-size:23px;line-height:1.4;color:${p.dim ? toneMuted(tone) : tone === "bone" ? "rgba(11,13,16,.88)" : "rgba(242,238,228,.88)"};${p.strike ? "text-decoration:line-through;text-decoration-color:rgba(255,74,28,.6)" : ""}">${esc(p.text)}</div>
      </div>`,
    )
    .join("");

  return `<div class="slide ${tone}">
    <img class="photo" src="${ctx.img(s.image)}" style="${photoStyle};object-position:${s.pos ?? "50% 40%"}">
    <div style="position:absolute;left:${barX}px;top:0;width:7px;height:1080px;background:${T.accent}"></div>
    <div class="grain" style="opacity:.045"></div>
    ${chrome(ctx.n, ctx.total, tone === "bone" ? T.ink : T.bone)}
    <div style="position:absolute;left:${textX}px;top:${s.top ?? 186}px;width:${textW}px">
      ${kick(s.kicker, tone === "bone" ? T.ink : T.bone)}
      <h2 class="h2" style="font-size:${s.size ?? 92}px;margin-top:28px">${titleLines(s.title, { tone, mutedColor: s.mutedColor })}</h2>
      ${s.body ? `<div style="margin-top:${s.bodyTop ?? 34}px">${bodyStack(s.body, { tone, width: s.bodyWidth ?? textW, size: s.bodySize ?? 26, gap: 20 })}</div>` : ""}
      ${rows ? `<div style="margin-top:${s.rowsTop ?? 46}px">${rows}</div>` : ""}
      ${pairs ? `<div style="margin-top:${s.pairsTop ?? 52}px">${pairs}</div>` : ""}
      ${s.quote ? `<div class="hair" style="margin:${s.quoteTop ?? 44}px 0 30px;width:${textW}px"></div>
        <p class="serif" style="font-size:${s.quoteSize ?? 34}px;line-height:1.35;color:${tone === "bone" ? "rgba(11,13,16,.88)" : "rgba(242,238,228,.92)"}">${esc(s.quote)}</p>` : ""}
      ${statBlock(s.stat, { tone, size: s.statSize ?? 150, labelSize: s.statLabelSize ?? 19, mt: s.statTop ?? 44 })}
    </div>
    ${foot(ctx, s.foot, tone === "bone" ? T.ink : T.bone, { x: textX, w: textW })}
  </div>`;
}

/** 03 — typographic statement with three supporting columns. */
export function statement(s, ctx) {
  const tone = s.tone ?? "ink";
  return `<div class="slide ${tone}">
    <div class="grain" style="opacity:.035"></div>
    ${chrome(ctx.n, ctx.total, tone === "bone" ? T.ink : T.bone)}
    <div style="position:absolute;left:88px;top:170px;width:1200px">
      ${kick(s.kicker, tone === "bone" ? T.ink : T.bone)}
      <h2 class="h2" style="font-size:${s.size ?? 92}px;margin-top:30px">${titleLines(s.title, { tone, mutedColor: s.mutedColor })}</h2>
    </div>
    <div style="position:absolute;left:88px;top:556px;width:1744px;display:flex;gap:62px">
      ${(s.columns ?? [])
        .map(
          (c) => `<div style="width:540px">
            <div style="display:flex;align-items:center;gap:14px">
              <span class="mono acc" style="font-size:15px;letter-spacing:.18em">${esc(c.n)}</span>
              <div class="hair" style="flex:1"></div>
            </div>
            <div style="font-size:35px;font-weight:800;letter-spacing:-.02em;margin-top:20px">${esc(c.label)}</div>
            <p style="font-size:23px;line-height:1.55;margin-top:16px;color:${toneText(tone)}">${esc(c.text)}</p>
          </div>`,
        )
        .join("")}
    </div>
    ${s.close ? `<div style="position:absolute;left:88px;top:872px;width:1744px">
      <div class="hair"></div>
      <p class="serif" style="font-size:38px;margin-top:30px;color:${tone === "bone" ? "rgba(11,13,16,.9)" : "rgba(242,238,228,.9)"}">${esc(s.close)}</p>
    </div>` : ""}
    ${foot(ctx, s.foot, tone === "bone" ? T.ink : T.bone)}
  </div>`;
}

/** 04 — photo band across the top, content below. Magazine opener. */
export function band(s, ctx) {
  const tone = s.tone ?? "bone";
  const bandH = s.bandH ?? 420;
  return `<div class="slide ${tone}">
    <img class="photo" src="${ctx.img(s.image)}" style="left:0;top:0;width:1920px;height:${bandH}px;object-position:${s.pos ?? "50% 38%"}">
    <div style="position:absolute;left:0;top:${bandH}px;width:1920px;height:7px;background:${T.accent}"></div>
    <div class="grain" style="opacity:.04"></div>
    ${chrome(ctx.n, ctx.total, tone === "bone" ? T.ink : T.bone)}
    <div style="position:absolute;left:88px;top:${bandH + 68}px;width:1744px">
      ${kick(s.kicker, tone === "bone" ? T.ink : T.bone)}
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:22px">
        <h2 class="h2" style="font-size:${s.size ?? 86}px">${titleLines(s.title, { tone, mutedColor: s.mutedColor })}</h2>
        ${s.lede ? `<p class="body" style="width:${s.ledeWidth ?? 600}px;font-size:22px;color:${toneText(tone)};padding-bottom:8px">${esc(s.lede)}</p>` : ""}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0 64px;margin-top:${s.itemsTop ?? 34}px">
        ${(s.items ?? [])
          .map(
            (it) => `<div style="width:840px;border-top:1px solid ${toneRule(tone)};padding:16px 0">
              <div style="font-size:25px;font-weight:700;letter-spacing:-.01em">${esc(it.t)}</div>
              <div style="font-size:19px;color:${toneMuted(tone)};margin-top:5px">${esc(it.s)}</div>
            </div>`,
          )
          .join("")}
      </div>
    </div>
    ${foot(ctx, s.foot, tone === "bone" ? T.ink : T.bone)}
  </div>`;
}

/** 05 — dimmed photo + numbered risk table. The honest slide. */
export function fullBleedList(s, ctx) {
  return `<div class="slide ink">
    <img class="photo" src="${ctx.img(s.image)}" style="inset:0;width:1920px;height:1080px;object-position:${s.pos ?? "50% 50%"};filter:brightness(.58) saturate(.6) contrast(1.05)">
    <div style="position:absolute;inset:0;background:rgba(11,13,16,.5)"></div>
    <div style="position:absolute;left:0;top:${s.bandTop ?? 410}px;width:1920px;height:${1080 - (s.bandTop ?? 410)}px;background:linear-gradient(180deg,rgba(11,13,16,0) 0%,rgba(11,13,16,.9) 14%,rgba(11,13,16,.95) 100%)"></div>
    <div class="grain"></div>
    ${chrome(ctx.n, ctx.total, T.bone)}
    <div style="position:absolute;left:88px;top:170px;width:1500px">
      ${kick(s.kicker, T.bone)}
      <h2 class="h2" style="font-size:${s.size ?? 90}px;margin-top:26px">${titleLines(s.title, { tone: "ink" })}</h2>
    </div>
    <div style="position:absolute;left:88px;top:${s.listTop ?? 520}px;width:1744px">
      ${(s.items ?? [])
        .map(
          (r, i) => `<div style="border-top:1px solid rgba(242,238,228,.18);padding:20px 0 18px;display:flex;gap:26px;align-items:baseline">
            <span class="mono acc" style="font-size:15px;letter-spacing:.12em;width:42px;flex:0 0 auto">0${i + 1}</span>
            <div style="width:${s.itemTitleW ?? 330}px;flex:0 0 auto;font-size:24px;font-weight:800;letter-spacing:-.01em">${esc(r.t)}</div>
            <div style="font-size:20px;line-height:1.5;color:rgba(242,238,228,.7)">${esc(r.s)}</div>
          </div>`,
        )
        .join("")}
    </div>
    ${s.close ? `<p class="serif" style="position:absolute;left:88px;top:${s.closeTop ?? 858}px;width:1450px;font-size:31px;line-height:1.3;color:rgba(242,238,228,.62)">${esc(s.close)}</p>` : ""}
    ${foot(ctx, s.foot, T.bone)}
  </div>`;
}

/** 06 — four oversized numbered steps. The method slide. */
export function steps(s, ctx) {
  const tone = s.tone ?? "bone";
  return `<div class="slide ${tone}">
    <div class="grain" style="opacity:.035"></div>
    ${chrome(ctx.n, ctx.total, tone === "bone" ? T.ink : T.bone)}
    <div style="position:absolute;left:88px;top:${s.top ?? 164}px;width:1200px">
      ${kick(s.kicker, tone === "bone" ? T.ink : T.bone)}
      <h2 class="h2" style="font-size:${s.size ?? 96}px;margin-top:28px">${titleLines(s.title, { tone, mutedColor: s.mutedColor })}</h2>
    </div>
    <div style="position:absolute;left:88px;top:${s.stepsTop ?? 456}px;width:1744px;display:flex;justify-content:space-between">
      ${(s.items ?? [])
        .map(
          (it, i) => `<div style="width:407px">
            <div style="display:flex;align-items:center;gap:16px">
              <span class="mono" style="font-size:12.5px;letter-spacing:.2em;color:${toneMuted(tone)}">STEP 0${i + 1}</span>
              <div style="flex:1;height:1px;background:${toneRule(tone)}"></div>
            </div>
            <div style="font-size:126px;font-weight:300;letter-spacing:-.055em;line-height:1;color:${T.accent};margin-top:16px">0${i + 1}</div>
            <div style="font-size:34px;font-weight:800;letter-spacing:-.025em;margin-top:8px;line-height:1.1">${esc(it.t)}</div>
            <p style="font-size:20px;line-height:1.55;color:${toneText(tone)};margin-top:12px">${esc(it.s)}</p>
          </div>`,
        )
        .join("")}
    </div>
    ${s.close ? `<div style="position:absolute;left:88px;top:${s.closeTop ?? 846}px;width:1744px">
      <div class="hair"></div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:26px">
        <p class="serif" style="font-size:34px;color:${tone === "bone" ? "rgba(11,13,16,.86)" : "rgba(242,238,228,.86)"}">${esc(s.close)}</p>
        ${s.aside ? `<span class="mono" style="font-size:13px;letter-spacing:.16em;color:${toneMuted(tone)}">${esc(s.aside)}</span>` : ""}
      </div>
    </div>` : ""}
    ${foot(ctx, s.foot, tone === "bone" ? T.ink : T.bone)}
  </div>`;
}

/** 07 — 2x2 prompt cards. Monospace copy makes it feel like a tool. */
export function cards(s, ctx) {
  const tone = s.tone ?? "ink";
  return `<div class="slide ${tone}">
    <div class="grain" style="opacity:.035"></div>
    ${chrome(ctx.n, ctx.total, tone === "bone" ? T.ink : T.bone)}
    <div style="position:absolute;left:88px;top:${s.top ?? 160}px">
      ${kick(s.kicker, tone === "bone" ? T.ink : T.bone)}
      <h2 class="h2" style="font-size:${s.size ?? 92}px;margin-top:26px">${titleLines(s.title, { tone, mutedColor: s.mutedColor })}</h2>
    </div>
    <div style="position:absolute;left:88px;top:${s.cardsTop ?? 462}px;display:flex;flex-wrap:wrap;gap:26px;width:1744px">
      ${(s.items ?? [])
        .map(
          (c) => `<div style="width:859px;height:196px;background:${tone === "bone" ? "#E9E4D8" : "#12151A"};border:1px solid ${toneRule(tone)};padding:26px 32px;display:flex;flex-direction:column;justify-content:space-between">
            <div class="mono acc" style="font-size:13px;letter-spacing:.2em">${esc(c.label)}</div>
            <div class="mono" style="font-size:23px;line-height:1.45;color:${tone === "bone" ? "rgba(11,13,16,.9)" : "rgba(242,238,228,.9)"}">“${esc(c.prompt)}”</div>
          </div>`,
        )
        .join("")}
    </div>
    ${foot(ctx, s.foot, tone === "bone" ? T.ink : T.bone)}
  </div>`;
}

/** 08 — manifesto. Big statement, three rules, a rotated sticker. */
export function manifesto(s, ctx) {
  const tone = s.tone ?? "bone";
  return `<div class="slide ${tone}">
    <div class="grain" style="opacity:.035"></div>
    ${chrome(ctx.n, ctx.total, tone === "bone" ? T.ink : T.bone)}
    <div style="position:absolute;left:88px;top:${s.top ?? 150}px;width:1120px">
      ${kick(s.kicker, tone === "bone" ? T.ink : T.bone)}
      <h1 class="h1" style="font-size:${s.size ?? 154}px;margin-top:30px">${titleLines(s.title, { tone, mutedColor: s.mutedColor })}</h1>
      ${s.lede ? `<p class="body" style="margin-top:40px;width:980px;font-size:24px;color:${toneText(tone)}">${esc(s.lede)}</p>` : ""}
      <div style="margin-top:${s.rulesTop ?? 44}px;width:1040px">
        ${(s.rules ?? [])
          .map(
            (r, i) => `<div style="border-top:1px solid ${toneRule(tone)};padding:18px 0;display:flex;gap:22px;align-items:baseline">
              <span class="mono acc" style="font-size:14px;letter-spacing:.14em;width:36px">0${i + 1}</span>
              <div style="font-size:23px;line-height:1.45;color:${tone === "bone" ? "rgba(11,13,16,.82)" : "rgba(242,238,228,.82)"}">${inline(r)}</div>
            </div>`,
          )
          .join("")}
      </div>
    </div>
    ${s.sticker ? `<div style="position:absolute;right:96px;top:${s.stickerTop ?? 470}px;transform:rotate(-8deg)">
      <div style="border:3px solid ${T.accent};color:${T.accent};padding:26px 34px;font-size:27px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;line-height:1.25;white-space:pre-line">${esc(s.sticker)}</div>
    </div>` : ""}
    ${foot(ctx, s.foot, tone === "bone" ? T.ink : T.bone)}
  </div>`;
}

/** 09 — four big words with hairlines. "What still belongs to you". */
export function rows(s, ctx) {
  const tone = s.tone ?? "ink";
  return `<div class="slide ${tone}">
    <div class="grain" style="opacity:.035"></div>
    ${chrome(ctx.n, ctx.total, tone === "bone" ? T.ink : T.bone)}
    <div style="position:absolute;left:88px;top:${s.top ?? 164}px">
      ${kick(s.kicker, tone === "bone" ? T.ink : T.bone)}
      <h2 class="h2" style="font-size:${s.size ?? 100}px;margin-top:26px">${titleLines(s.title, { tone, mutedColor: s.mutedColor })}</h2>
    </div>
    <div style="position:absolute;left:88px;top:${s.rowsTop ?? 412}px;width:1744px">
      ${(s.items ?? [])
        .map(
          (r, i) => `<div style="border-top:1px solid ${toneRule(tone)};padding:${s.rowPad ?? 26}px 0;display:flex;gap:30px;align-items:baseline">
            <span class="mono acc" style="font-size:14px;letter-spacing:.14em;width:40px;flex:0 0 auto">0${i + 1}</span>
            <div style="width:${s.wordW ?? 330}px;flex:0 0 auto;font-size:44px;font-weight:900;letter-spacing:-.03em">${esc(r.word)}</div>
            <div style="font-size:23px;line-height:1.5;color:${toneText(tone)}">${esc(r.text)}</div>
          </div>`,
        )
        .join("")}
    </div>
    ${foot(ctx, s.foot, tone === "bone" ? T.ink : T.bone)}
  </div>`;
}

/** 10 — pull quote over a full-bleed portrait. The emotional beat. */
export function quote(s, ctx) {
  return `<div class="slide ink">
    <img class="photo" src="${ctx.img(s.image)}" style="inset:0;width:1920px;height:1080px;object-position:${s.pos ?? "58% 34%"}">
    <div style="position:absolute;inset:0;background:rgba(11,13,16,.5)"></div>
    <div class="scrim-l"></div><div class="scrim-b"></div><div class="grain"></div>
    ${chrome(ctx.n, ctx.total, T.bone)}
    <div style="position:absolute;left:88px;top:${s.top ?? 292}px;width:1400px">
      <p class="serif" style="font-size:${s.size ?? 86}px;line-height:1.14;color:${T.bone}"><span style="color:${T.accent}">“</span>${s.lines.map((l) => esc(l)).join("<br>")}</p>
      ${s.caption ? `<div class="mono" style="font-size:13px;letter-spacing:.24em;margin-top:44px;color:rgba(242,238,228,.55)">${esc(s.caption)}</div>` : ""}
    </div>
    ${foot(ctx, s.foot, T.bone)}
  </div>`;
}

/** 11 — closing call to action over a full-bleed photo. */
export function close(s, ctx) {
  return `<div class="slide ink">
    <img class="photo" src="${ctx.img(s.image)}" style="inset:0;width:1920px;height:1080px;object-position:${s.pos ?? "50% 46%"}">
    <div style="position:absolute;inset:0;background:linear-gradient(0deg,rgba(11,13,16,.97) 0%,rgba(11,13,16,.72) 38%,rgba(11,13,16,.15) 72%,rgba(11,13,16,.35) 100%)"></div>
    <div class="grain"></div>
    ${chrome(ctx.n, ctx.total, T.bone)}
    <div style="position:absolute;left:88px;bottom:${s.bottom ?? 196}px;width:1300px">
      ${kick(s.kicker, "rgba(242,238,228,.8)")}
      <h1 class="h1" style="font-size:${s.size ?? 146}px;margin-top:28px">${titleLines(s.title, { tone: "ink" })}</h1>
      ${s.body ? `<p class="body" style="margin-top:36px;width:940px;font-size:27px;color:rgba(242,238,228,.74)">${esc(s.body)}</p>` : ""}
      ${s.close ? `<p class="serif" style="margin-top:26px;font-size:28px;color:rgba(242,238,228,.9)">${esc(s.close)}</p>` : ""}
    </div>
    ${foot(ctx, s.foot, T.bone)}
  </div>`;
}

export const LAYOUTS = {
  cover,
  split,
  statement,
  band,
  fullBleedList,
  steps,
  cards,
  manifesto,
  rows,
  quote,
  close,
};
