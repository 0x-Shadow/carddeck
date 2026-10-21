# The Editorial deck system

A design system for decks that look designed instead of generated. It exists
because the default pipeline — a PPTX library laying out titles and bullets on a
slide — produces documents: 32pt titles, 14pt body, one photo box, a coloured
band. At 13.33 × 7.5 inches, 14pt is a footnote. That is the "simple text with
some colour at the back" failure mode.

The fix is to stop letting the PPTX library design. Compose each slide at
1920 × 1080 in HTML, render it in Chromium at 2×, and place the result as a
full-bleed image. The PPTX keeps real slides, speaker notes, and perfect
fidelity; the source of truth becomes the deck spec, not the PowerPoint text
boxes.

> Trade-off, stated up front: the slides are images, so text is not editable in
> PowerPoint. You edit the spec and re-render. For a deck that has to look
> excellent, that is the right trade. For a document people must edit inline,
> use Carddeck's block exporter instead.

---

## 1. The one rule

**One slide = one idea.** A headline of 2–3 lines, 8–14 words total, at 86–158px.
At most four short supports. If it needs a paragraph, it is two slides — or it
belongs in the speaker notes (which travel in the PPTX).

Every other rule below serves this one.

## 2. Tokens

| Token | Value | Use |
| --- | --- | --- |
| `ink` | `#0B0D10` | dark pages, text on bone |
| `bone` | `#F2EEE4` | light pages, text on ink |
| `accent` | `#FF4A1C` | kickers, numbers, rules, one headline line |
| body on ink | `rgba(242,238,228,.66)` | paragraphs |
| muted on ink | `rgba(242,238,228,.45)` | second headline line |
| body on bone | `rgba(11,13,16,.66)` | paragraphs |
| hairline | `currentColor` at 15–16% | rules |

Three colours. No gradients as decoration, no drop shadows, no icon sets, no
fourth accent "for variety". The accent earns its force by being rare: one line
of a headline, the numbers, the kicker square, the 7px photo edge.

### Type

| Role | Face | Size / treatment |
| --- | --- | --- |
| Cover title | Segoe UI Black (900) | 158px, tracking −.045em, leading .88 |
| Section title | Segoe UI Black (900) | 86–100px, tracking −.035em, leading .94 |
| Body | Segoe UI 400 | 26–28px, leading 1.55, measure ≤ 900px |
| Kicker | Segoe UI 700 | 15px, uppercase, tracking .26em, orange square |
| Index / labels | Consolas | 12.5–15px, tracking .16–.24em |
| Pull quote | Georgia italic | 34–86px |
| Footer | Segoe UI 600 | 12.5px, uppercase, tracking .2em, 42% opacity |

Fonts: Segoe UI ships on Windows; the kit falls back to Inter / Helvetica Neue.
If Segoe UI Black is missing, the display weight collapses — install it or pick
another heavy grotesk **before** designing.

## 3. Grid

- Canvas 1920 × 1080. Margins 88px left/right. Footer baseline 52px from the
  bottom; index at 54px from the top. Content lives between 88 and 1832.
- Text column: 832–1008px wide. Never run body text under a photo.
- Photo panel (split layouts): 740–900px wide, full height, flush to one edge,
  with a **7px orange rule** on its inner edge.
- Full-bleed bands: 380–440px tall across the top, with the same 7px rule below.
- Footer rule: 1px at 16% opacity, labels under it.

## 4. The eleven layouts

Each is a function in `apps/mcp/design/editorial/layouts.mjs`.

| Layout | Use it for | Signature |
| --- | --- | --- |
| `cover` | open with a claim | full-bleed photo, left scrim, 3-line 158px title, lede |
| `split` | benefits, comparisons | photo panel one side, text column the other; optional rows, pairs, quote, stat |
| `statement` | definitions | three numbered columns + one italic serif closing line |
| `band` | "access / scale" arguments | top photo band, title left, lede right, 2×2 items |
| `fullBleedList` | risks, constraints | dimmed photo, 4 numbered rows on a near-solid band |
| `steps` | process | four 126px light numerals, rule + step labels, closing line |
| `cards` | prompts, examples | 2×2 monospace cards on ink, orange labels |
| `manifesto` | principles | 154px statement, 3 rules, rotated sticker |
| `rows` | skills, traits | four big words with hairlines and one-line definitions |
| `quote` | emotional beat | full-bleed portrait, 86px Georgia italic, orange quote mark |
| `close` | the ask | full-bleed photo, 146px CTA, one serif kicker line |

Every layout is 1920 × 1080 and self-contained. Compose, don't restyle.

### Sketches

```
cover                          split (photo right)            steps
┌────────────────────────┐     ┌───────────────┬────────┐     ┌──────────────────────────┐
│ kicker                 │     │ kicker        │        │     │ kicker                   │
│ AI IN SCHOOL           │     │ BIG TITLE     │ photo  │     │ BIG TITLE                │
│ IS ALREADY             │     │ body …        │ 740px  │     │                          │
│ HERE.                  │     │ 01 row        │        │     │ 01     02     03     04   │
│ lede …                 │     │ 02 row        │        │     │ ───    ───    ───    ───  │
│ footer                 │     │ footer        │        │     │ closing line             │
└────────────────────────┘     └───────────────┴────────┘     └──────────────────────────┘
```

## 5. Rhythm

A 14-slide arc that works:

1 cover · 2 the shift · 3 what it is · 4–7 four benefits · 8 the risks ·
9 the method · 10 the playbook · 11 integrity · 12 what stays human ·
13 quote · 14 close.

- Alternate **ink / bone**. Never three light or three dark slides in a row.
- Alternate **photo / type**. Never two full-bleed photos back to back.
- Put the risks immediately after the benefits. Credibility comes from the
  admission, not the promise.
- End on a single. The last slide is one action, not a summary.

## 6. Photography

- Real photographs of real people. No robots, glowing brains, handshakes,
  clip-art, or code-on-a-screen closeups.
- Full-bleed needs ≥ 2200px on the long edge; 1600px is acceptable only under a
  heavy scrim. Split panels need ≥ 1400px.
- Crop with `object-position` so faces sit outside the text column. On a cover,
  push the subject to 60–65% horizontally.
- Grade: `contrast(1.05) saturate(.93) brightness(.97)`.
- Scrims, not boxes: a left gradient for covers (98% → 0 across 80% width), a
  bottom gradient for closes (96% → 0 at 64%), a flat 50% wash + bottom band for
  the risks layout.
- Add grain at 5–7% overlay. It hides upscaling and makes flat areas feel
  printed.
- A 7px orange edge on split panels is the cheapest way to make a photo look
  art-directed.

## 7. Copy

- Concrete nouns and numbers. "Ten attempts before the deadline" beats
  "improved feedback loops".
- Second person. Short sentences. One idea per sentence.
- No "unlock", "leverage", "seamless", "revolutionize", "in today's world".
- No emoji, no exclamation marks, no rhetorical question stacks.
- One italic serif line per deck — the emotional beat. More than one and it
  becomes a tic.
- Kickers are labels, not sentences: "Benefit 02 · Feedback".
- The footer carries the deck name and the year; it is chrome, not content.

## 8. QA gates

1. **Contact sheet.** Render all slides and look at them together at 2 columns.
   Check rhythm, contrast, and where the eye lands. Fix, re-render.
2. **Full-resolution spot check.** Open the cover, one photo slide, one
   typographic slide at 2560px. Look for overflow, orphan words, clipped
   descenders, faces under text.
3. **Contrast.** Second headline lines at ≤ 45% opacity must still read at
   projector brightness. If not, raise to 55–72%.
4. **Package.** Verify slide count, one full-bleed picture per slide, speaker
   notes present, slide size 12192000 × 6858000 EMU.
5. **No text over a busy area.** If a photo's detail sits behind copy, add
   scrim or move the copy — do not bold the text.

## 9. Pipeline contract

- Design at 1920 × 1080; screenshot at `deviceScaleFactor: 1.3333` → 2560 × 1440.
- JPEG q94 for photo slides, PNG for typographic slides (smaller, crisper).
- PPTX: `LAYOUT_WIDE`, one image at `x:0 y:0 w:13.333333 h:7.5`, alt text and
  speaker notes per slide.
- PDF: the same rendered images, one per 13.333 × 7.5in page. Do **not** print
  the live DOM with an SVG grain filter — Chromium rasterises it and a 14-slide
  PDF balloons past 80MB.
- Never let html2pptx or a block exporter re-layout this system. Its fixed type
  scale destroys the hierarchy.

## 10. Anti-patterns

Never ship these:

- 32pt title + 14pt bullets centred on a slide.
- A coloured rectangle behind the title and nothing else.
- One small photo box on every slide, in the same place.
- Four bullets with icons, repeated eleven times.
- Gradients, glows, or shadows used as decoration.
- More than two typefaces.
- Stock handshake / robot / brain imagery.
- A "Thank you" slide.

## 11. Using it from the MCP

```
get_design_system      → this guide + the kit path + the exact run command
scaffold_design_kit    → copy the kit into <repo>/work/designs/<name>
```

Then:

```bash
cd <scaffolded dir>
node render.mjs deck.mjs --out ./out
```

That writes `slide-01…14.png|jpg`, `preview.jpg`, `<title>.pptx` (with notes),
and `<title>.pdf`. Inspect `preview.jpg`, fix, re-render. The kit is the
reference implementation — read `layouts.mjs` before inventing a layout.
