# PPTAgent HTML → PPTX converter (vendored)

This directory contains the HTML-to-PPTX converter from
[**PPTAgent**](https://github.com/icip-cas/PPTAgent) (ICIP-CAS), the research
project behind the EMNLP 2025 paper *PPTAgent: Generating and Evaluating
Presentations via Editing-based Approaches*.

- **Upstream:** `pptagent==1.1.37` (PyPI wheel), files
  `deeppresenter/html2pptx/html2pptx.js` and `html2pptx_cli.js`.
- **License:** MIT, © 2025 ICIP-CAS. The upstream license is included as
  [`LICENSE`](./LICENSE).
- **Lineage:** upstream credits Anthropic's HTML-to-PPTX skill as the starting
  point; PPTAgent extended it with positioned shapes, tables, lists, images,
  gradients, pseudo-elements, and validation.

Carddeck uses the converter as a second PowerPoint engine. The native
PptxGenJS renderer (`src/design-pptx.ts`) keeps charts editable and injects
motion; this converter renders the same 1280×720 designed HTML slides that
produce the PDF, then emits positioned, editable PowerPoint objects.

## Why vendored, not installed

The published `pptagent` Python wheel declares a large runtime (gradio, pandas,
opencv, fastapi, fastmcp, …) because it also ships the research agent, web UI,
and MCP server. The converter itself is a standalone Node program whose only
dependencies are `playwright`, `pptxgenjs`, `fast-glob`, and `minimist` — all of
which Carddeck already has or declares. Vendoring the two files keeps the
container small and the export path deterministic.

## Local changes

The upstream files are CommonJS; this package is ESM, so both were renamed
`.js` → `.cjs` and the CLI's internal `require("./html2pptx")` was pointed at
`./html2pptx.cjs`. Five upstream bugs were fixed:

1. **SVG detection** — `el.tagName === 'SVG'` never matches: SVG elements
   report lower-case `svg`. Inline charts were skipped (only their `<text>`
   nodes leaked into the slide). Now `el.tagName.toLowerCase() === 'svg'`.
2. **SVG class names** — `el.className.includes(...)` throws on SVG elements,
   whose `className` is an `SVGAnimatedString`. All class checks now stringify
   safely.
3. **Circle radius** — `border-radius: 50%` mapped to a fixed 1 inch, which
   turns circles into rounded rectangles. It now maps to half the shorter side,
   producing true circles and stadiums.
4. **Font resolution environment** — the converter launched Chromium with only
   `TMPDIR`, dropping `HOME` and the user fontconfig. Metric-compatible
   substitutes such as Gelasio and Carlito were invisible, so every run was
   measured and named `DejaVu Sans`. The launch now merges `process.env`.
5. **Portable font names** — Chromium records the Linux substitute it measured
   (Gelasio, Carlito). The converter now maps those to the design families
   (Georgia, Calibri) in the PPTX, so PowerPoint on macOS/Windows opens the deck
   with the intended fonts and matching metrics.

Run the integration test in `packages/pptx/test/pptagent.test.ts` after
changing anything here; it asserts the output contains native `<a:t>` runs and
no rasterized media.

## Updating

```bash
python3 -m pip download --no-deps pptagent==1.1.38 -d /tmp/pptagent
unzip -o /tmp/pptagent/pptagent-*.whl -d /tmp/pptagent/pkg
cp /tmp/pptagent/pkg/deeppresenter/html2pptx/html2pptx{,_cli}.js \
  packages/pptx/vendor/pptagent/html2pptx/
```

Rename both to `.cjs`, point the CLI at `./html2pptx.cjs`, and re-apply the
three fixes above. Then update the version recorded here.
