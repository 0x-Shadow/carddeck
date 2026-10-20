# PPTAgent engine (HTML → PPTX)

Carddeck ships **two independent PowerPoint renderers**. Both read the same
deck model and theme; they differ in how a slide becomes OOXML.

| | Native (default) | PPTAgent |
| --- | --- | --- |
| Module | `packages/pptx/src/design-pptx.ts` | `packages/pptx/src/pptagent.ts` |
| How | PptxGenJS composition written per block | Designed 1280×720 HTML → computed DOM → positioned shapes |
| Charts | **Editable native charts** (`c:chart`) with data | Rasterized SVG images |
| Motion | Real entrance animations + transitions | None (a static deck) |
| Fidelity | Explicit: every composition is coded twice (HTML + PPTX) | 1:1 with the PDF design system by construction |
| Best for | Data decks, animated keynotes | Design-heavy decks, pixel-faithful HTML layouts, PDF parity |

The HTML engine exists because the PDF renderer already describes each slide
precisely in HTML/CSS. PPTAgent's converter reads the browser's *computed*
layout and emits editable PowerPoint objects from it, so gradients, layered
cards, pills, table-like grids, and typography match the browser without
re-implementing every composition in PptxGenJS.

## Try it

In the app: **Export → PowerPoint · HTML engine (.pptx)**.

Over HTTP:

```bash
curl -OJ 'http://localhost:3000/api/deck/<id>/export/pptx?engine=pptagent'
```

The response carries `x-carddeck-engine: pptagent` and a
`content-disposition` filename suffixed with `(PPTAgent)`, so it never
overwrites the native export.

Over MCP:

```jsonc
{
  "tool": "export_deck",
  "arguments": { "deckId": "<id>", "format": "pptx", "engine": "pptagent" }
}
```

`create_gamma_deck` accepts the same choice as `exportEngine`. The envelope
returns `engine: "pptagent"`.

## Programmatic use

```ts
import {
  buildPptagentPptxBuffer,
  isPptagentAvailable,
} from "@carddeck/pptx";

if (!isPptagentAvailable()) {
  // converter or node deps missing → fall back to buildDesignedPptxBuffer
}

const buffer = await buildPptagentPptxBuffer(
  { id, title, theme, cards },
  cards,
  {
    resolveImage,                 // same resolver the native/PDF paths use
    onWarning: (msg) => console.warn(msg),
  },
);
```

Pipeline:

1. `renderDesignedSlidesHtml(deck, cards, { resolveImage })` emits **one
   standalone HTML document per card**, body pinned to 1280×720.
2. The vendored converter (`vendor/pptagent/html2pptx/html2pptx_cli.cjs`)
   launches Chromium, reads computed geometry, and writes a 16:9 `.pptx`.
3. Strict validation runs first. If a slide is rejected, the adapter retries
   with `--soft`, forwards the warnings, and still returns a deck rather than
   failing the export. Set `allowSoft: false` to make validation fatal.

`isPptagentAvailable()` checks the vendored converter plus `playwright`,
`pptxgenjs`, `fast-glob`, and `minimist`. If it returns false the MCP tool
reports a clear error and the HTTP route answers `503`; the native engine is
unaffected.

## Requirements

- Node ≥ 22 (already required by the repo).
- Chromium for Playwright: `npx playwright install chromium` (the same browser
  PDF export uses).
- No Python, no `OPENAI_API_KEY`, and no network access at export time.

## Limits

- **Charts rasterize.** Inline SVG is rendered to PNG because PowerPoint has no
  inline-SVG shape model. If charts must stay editable, use the native engine.
- **No motion.** Animations are a native-engine feature; the HTML engine emits
  a static deck.
- **Font substitution.** The converter records the fonts Chromium actually
  used. The vendored copy now preserves the browser environment so metric-
  compatible Linux substitutes resolve, and maps Gelasio → Georgia and
  Carlito → Calibri in the PPTX. Decks therefore carry the design font names
  into PowerPoint. Fonts missing on the viewing machine still substitute just
  as they would in any PowerPoint file; the native engine keeps the theme's
  font names directly.
- **Validation.** Every text node must sit inside `<p>`, `<h1>`–`<h6>`, `<ul>`,
  or `<ol>`. The designed HTML renderer follows this contract; if you add a new
  label, wrap it in an inline `<span>` inside its container.

## Attribution

Vendored from [PPTAgent](https://github.com/icip-cas/PPTAgent) (`pptagent`
1.1.37), MIT © 2025 ICIP-CAS. See
[`packages/pptx/vendor/pptagent/README.md`](../packages/pptx/vendor/pptagent/README.md)
for provenance and the list of local fixes.
