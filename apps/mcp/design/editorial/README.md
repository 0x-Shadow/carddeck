# Editorial starter kit

A runnable reference implementation of the Editorial deck system. It renders a
deck spec into full-slide images and packages them as a PPTX (with speaker
notes) plus a PDF.

Read [`docs/DESIGN.md`](../../../../docs/DESIGN.md) first — it explains the rules
this kit enforces.

## Quickstart

```bash
# from the carddeck repo root
node apps/mcp/design/editorial/render.mjs \
     apps/mcp/design/editorial/deck.mjs \
     --out ./work/my-deck
```

Outputs in `--out`:

```
slide-01.jpg … slide-14.jpg   2560 × 1440 renders (actual slides)
preview.jpg                    2-column contact sheet — review this
<deck-title>.pptx             full-bleed slides + speaker notes
<deck-title>.pdf              same pages, 13.333 × 7.5in
manifest.json                 paths, layouts, notes
```

Requires `playwright` + Chromium and `pptxgenjs`. Both resolve from the carddeck
repo; run the kit from inside the repo, or install them next to `render.mjs`.

## Writing a deck

`deck.mjs` default-exports:

```js
export default {
  title: "…",                     // also the PPTX/PDF filename
  author: "…",
  footer: { left: "…", right: "…" },   // printed on every slide
  images: { name: "https://… | ./photos/x.jpg" },
  slides: [ { layout: "cover", … , notes: "…" } ],
};
```

Remote images are downloaded once into `.image-cache/` (git-ignored). Local
paths are resolved relative to the deck file.

### Common fields

| Field | Meaning |
| --- | --- |
| `layout` | one of the eleven layouts below |
| `tone` | `"ink"` (dark) or `"bone"` (light) on layouts that support both |
| `kicker` | small uppercase label with the orange square |
| `title` | array of `{ t, muted?, accent? }` — one line each |
| `body` | array of paragraphs (escaped) |
| `notes` | speaker notes, stored in the PPTX |
| `foot` | `{ left, right }` override for this slide |

### Layouts

| Layout | Extra props |
| --- | --- |
| `cover` | `image`, `pos`, `lede`, `size`, `bottom` |
| `split` | `image`, `side` (`right`/`left`), `imgW`, `gap`, `pos`, `body`, `rows`, `pairs`, `quote`, `stat`, `size`, `top` |
| `statement` | `columns` `[{n,label,text}]`, `close`, `size` |
| `band` | `image`, `pos`, `bandH`, `lede`, `items` `[{t,s}]` |
| `fullBleedList` | `image`, `pos`, `items` `[{t,s}]`, `close`, `mutedColor` |
| `steps` | `items` `[{t,s}]`, `close`, `aside` |
| `cards` | `items` `[{label,prompt}]` |
| `manifesto` | `lede`, `rules` (strings; only `<i>/<b>/<em>/<strong>/<br>` survive), `sticker` |
| `rows` | `items` `[{word,text}]`, `rowPad`, `wordW` |
| `quote` | `image`, `pos`, `lines` (strings), `caption` |
| `close` | `image`, `pos`, `body`, `close`, `size` |

`stat` is `{ value, label }`; `label` may contain `<br>` and `<b>`.

## Rules of thumb

- 12–16 slides. One idea per slide.
- Alternate ink/bone and photo/type. Never two full-bleed photos in a row.
- Headline 2–3 lines, 8–14 words. Four supports maximum.
- Real photography only; ≥2200px for full-bleed. Keep faces out of the text
  column with `pos`.
- Put the risks right after the benefits.
- End on one action, not a summary.

## If the type looks wrong

The display face is Segoe UI Black (Windows). The renderer warns when it is
missing. Install Segoe UI, or change the font stack in `theme.mjs` to a heavy
grotesk that exists on the machine **before** you compose — the whole hierarchy
depends on that 900 weight.

## Remote images and trust

Remote images are fetched with a 25 MB cap, and only from public `http(s)`
hosts: loopback, RFC1918, link-local, mDNS and `.internal` names are refused,
including across redirects. That keeps a model-written deck spec from turning a
photo URL into a port scan of the machine or the LAN. If your photos live on a
local server, pass `--allow-local-hosts`.

The renderer writes only inside `--out` and `.image-cache/`. It never executes
deck content: every interpolated string is escaped, and the two fields that
allow emphasis (`manifesto.rules`, `stat.label`) accept only `<i>`, `<b>`,
`<em>`, `<strong>` and `<br>` — no attributes, no scripts.

