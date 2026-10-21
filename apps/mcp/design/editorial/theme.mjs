/**
 * Editorial design tokens for the "Editorial" deck system.
 *
 * The look is deliberately narrow: three colours, two typefaces, one accent,
 * fixed margins. Everything else is composition. Keep it that way — the system
 * reads as designed because it is consistent, not because it is decorated.
 */

export const T = {
  ink: "#0B0D10",
  bone: "#F2EEE4",
  accent: "#FF4A1C",
};

export const PAGE_W = 1920;
export const PAGE_H = 1080;
export const MARGIN = 88;

export const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${PAGE_W}px;height:${PAGE_H}px;overflow:hidden;background:${T.ink}}
body{font-family:"Segoe UI","Inter","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.slide{position:relative;width:${PAGE_W}px;height:${PAGE_H}px;overflow:hidden}
.ink{background:${T.ink};color:${T.bone}}
.bone{background:${T.bone};color:${T.ink}}
.photo{position:absolute;object-fit:cover;filter:contrast(1.05) saturate(.93) brightness(.97)}
.grain{position:absolute;inset:0;pointer-events:none;opacity:.07;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size:240px 240px}
.scrim-l{position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,13,16,.98) 0%,rgba(11,13,16,.92) 26%,rgba(11,13,16,.52) 54%,rgba(11,13,16,0) 80%)}
.scrim-r{position:absolute;inset:0;background:linear-gradient(270deg,rgba(11,13,16,.97) 0%,rgba(11,13,16,.85) 34%,rgba(11,13,16,.2) 68%,rgba(11,13,16,0) 88%)}
.scrim-b{position:absolute;inset:0;background:linear-gradient(0deg,rgba(11,13,16,.96) 0%,rgba(11,13,16,.45) 34%,rgba(11,13,16,0) 64%)}
.top{position:absolute;left:88px;right:88px;top:54px;display:flex;align-items:center;justify-content:space-between;z-index:6}
.idx{font-size:14px;letter-spacing:.24em;font-weight:600;opacity:.5}
.bot{position:absolute;bottom:52px;z-index:6}
.rule{height:1px;background:currentColor;opacity:.16;margin-bottom:16px}
.botrow{display:flex;justify-content:space-between;font-size:12.5px;letter-spacing:.2em;text-transform:uppercase;font-weight:600;opacity:.42}
.h1{font-weight:900;letter-spacing:-.045em;line-height:.88}
.h2{font-weight:900;letter-spacing:-.035em;line-height:.94}
.body{font-size:27px;line-height:1.55}
.mono{font-family:Consolas,"SFMono-Regular",Menlo,monospace}
.serif{font-family:Georgia,"Times New Roman",serif;font-style:italic}
.acc{color:${T.accent}}
.kick{display:flex;align-items:center;gap:16px;font-size:15px;font-weight:700;letter-spacing:.26em;text-transform:uppercase}
.sq{width:11px;height:11px;background:${T.accent};display:block;flex:0 0 auto}
.hair{height:1px;background:currentColor;opacity:.15}
`;

/** Escape text for HTML. */
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Top-right slide index. */
export const chrome = (n, total, color = T.ink) =>
  `<div class="top" style="color:${color}"><span></span><span class="idx">${String(n).padStart(2, "0")} — ${total}</span></div>`;

/**
 * Bottom rule + deck label. `custom` may override either side.
 * Use x/w for split slides so the footer stays inside the text column.
 */
export const foot = (ctx, custom = {}, color = T.ink, geom = {}) => {
  const left = custom.left ?? ctx.footer.left;
  const right = custom.right ?? ctx.footer.right;
  return `<div class="bot" style="left:${geom.x ?? MARGIN}px;width:${geom.w ?? PAGE_W - MARGIN * 2}px;color:${color}">
    <div class="rule"></div>
    <div class="botrow"><span>${esc(left)}</span><span>${esc(right)}</span></div>
  </div>`;
};

/** Kicker: orange square + tracked caps. */
export const kick = (t, color = T.ink) =>
  `<div class="kick" style="color:${color}"><span class="sq"></span>${esc(t)}</div>`;

/** Title lines: [{ t, muted?, accent? }]. */
export const titleLines = (lines, opts = {}) => {
  const tone = opts.tone ?? "bone";
  const muted = opts.mutedColor ?? (tone === "bone" ? "rgba(11,13,16,.4)" : "rgba(242,238,228,.45)");
  return lines
    .map((l) => {
      const color = l.accent ? T.accent : l.muted ? muted : "inherit";
      return `<span style="display:block;color:${color}">${esc(l.t)}</span>`;
    })
    .join("");
};

/** Paragraph stack with a fixed measure. */
export const bodyStack = (paras = [], opts = {}) => {
  if (!paras.length) return "";
  const tone = opts.tone ?? "bone";
  const color = opts.color ?? (tone === "bone" ? "rgba(11,13,16,.66)" : "rgba(242,238,228,.66)");
  return paras
    .map(
      (p, i) =>
        `<p class="body" style="margin-top:${i === 0 ? 0 : opts.gap ?? 22}px;width:${opts.width ?? 840}px;font-size:${opts.size ?? 27}px;color:${color}">${esc(p)}</p>`,
    )
    .join("");
};

/** Big stat: value + two-line label. */
export const statBlock = (stat, opts = {}) => {
  if (!stat) return "";
  const tone = opts.tone ?? "bone";
  return `<div style="display:flex;align-items:flex-end;gap:26px;margin-top:${opts.mt ?? 44}px">
    <div class="h1 acc" style="font-size:${opts.size ?? 150}px;line-height:.8">${esc(stat.value)}</div>
    <div style="font-size:${opts.labelSize ?? 19}px;line-height:1.4;color:${tone === "bone" ? "rgba(11,13,16,.55)" : "rgba(242,238,228,.55)"};padding-bottom:10px">${stat.label}</div>
  </div>`;
};
