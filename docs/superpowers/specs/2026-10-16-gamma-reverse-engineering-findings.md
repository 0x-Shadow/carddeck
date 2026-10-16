# Gamma.app — Reverse-Engineering Findings

Target: https://gamma.app/ (marketing + app shell) and a public shared deck
(`gamma.app/docs/Introducing-the-Gamma-Customer-Advisory-Board-u3sq95ne8livoyf`).

Evidence gathered 2026-10-16 via REA passive CDP observation of a real Chromium
session (Cloudflare passed with a headed browser), plus `analyze_web_bundle`
static analysis of the loaded JavaScript, plus Gamma's public developer docs.

---

## 1. Product model (what Gamma IS)

Gamma is an **AI design partner** that turns a prompt / pasted text / imported
file into three output formats:

- **Presentation** (the flagship) — a deck of "cards"
- **Document** / **Webpage** — a vertical scroll of cards
- **Social** — social posts / banners / stories

The atomic unit is the **card** (Gamma's word for a slide). A *gamma* (a "file")
contains an ordered list of *pages*, each page owning a canvas of cards.

### Creation flow (observed + documented)
1. **Start**: choose a creation mode — `Generate` (prompt), `Paste` (existing
   text), or `Import` (PPTX / DOCX / URL). New users land in a dashboard and
   click "Create New AI".
2. **Generate an outline** from the prompt, then edit the outline (rename,
   merge, delete cards) and pick a theme.
3. **Generate** the cards. The API documents this as an async job.
4. **Refine**: edit text, swap images, add/remove cards, ask the AI chat to
   rewrite a card or regenerate an image, tweak the theme.
5. **Ship**: Present (full-screen), Share (link / invite collaborators / access
   request), Export (PDF, PowerPoint, PNGs), or Embed on a site.

### Public API contract (developers.gamma.app)
- `POST /v1.0/generations` — create from `inputText` (or `pages`).
  Params: `textMode` (`generate`|`preserve`), `format`
  (`presentation`|`document`|`webpage`), `numCards`, `themeId`, `exportAs`,
  `additionalInstructions`, `imageOptions`, `textOptions`, `cardOptions`,
  `sharingOptions`, `folderIds`, `cardSplit`.
- `POST /v1.0/generations/from-template` — remix an existing gamma.
- `GET /v1.0/generations/{generationId}` — **poll** until `status` is
  `completed` or `failed`; response carries `gammaId`, `gammaUrl`,
  `exportUrl`, and `credits.{deducted,remaining}`.
- **Credits** pricing: cards cost 1–3 credits each; AI images 2–125 credits
  depending on model tier.

---

## 2. Client architecture (observed from the bundle)

| Layer | Technology | Evidence |
|---|---|---|
| Framework | **Next.js** (App Router + Turbopack), SSG/ISR | `/_next/static/immutable/chunks/*`, `__BUILD_MANIFEST`, `__SSG_MANIFEST`, `TURBOPACK` |
| UI kit | **Chakra UI** | `body.chakra-ui-light`, `chakra-button` classes |
| State / data | **Apollo GraphQL** client | `window.apollo`, `__GRAPHY_SDK__` |
| Realtime collab | **Yjs** CRDT over **engine.io** (WebSocket) | `window.__ $YJS$ __`, `/engine.io` route |
| Editor | Custom **ProseMirror-style** block editor | `react-renderer node-card`, `node-image block block-image`, `nodeViewContent`, `block-card first-block last-block` |
| Observability | Sentry, Intercom | `__SENTRY__`, `__intercomAssignLocation` |
| i18n | React Intl | `__REACT_INTL_CONTEXT__` |

### The card editor DOM (reader/editor share the renderer)
```
div.react-renderer.node-card.block.block-card.first-block.last-block
└─ div.card-wrapper.card-expanded      [data-card-id][data-card-scroll-element]
   └─ div.card-body                    [data-card-body][data-selection-ring][data-testid]
      ├─ div.card-body-background
      └─ div.card-layout               ← layout grid
         └─ div.card-content.is-dark   [data-node-view-content]
            └─ div.react-renderer.node-cardLayoutItem [data-layout-item-id]
               └─ div.react-renderer.node-image.block.block-image
```
Between cards sit `div.card-divider` controls with an **insert-card** button and
an **insert-ai-card** button — i.e. cards are added inline between any two cards.

**Key insight:** content is a **tree of typed blocks** (`card`, `image`,
`cardLayoutItem`, …) rendered by React "renderers", each card being a layout
grid that can contain nested layout items. The same block tree powers the
editor and the published reader.

### GraphQL surface (operation names lifted from the bundle)
Generation: `GenerateDoc`, `GeneratePage`, `GenerateDocFromImport`,
`GenerateDocFromRemix`, `GetDocGeneration(s)`, `CreateDocGeneration`,
`GenerationStatus`.
Cards/canvas: `GetDocCanvasCards`, `GetDocBrief`.
Media/AI: `GenerateImageCard`, `GenerateAnimation`, `GenerateIllustration`,
`GenerateInfographic`, `BeautifyCard`, `GenerationStatus`.
Theme: `GetThemes`, `GetTheme`, `CreateTheme`, `UpdateTheme`,
`UpdateFileTheme`, `GetFileThemeData`, `RestoreThemeFromSnapshot`.
File/page: `CreateFile`, `GetFile(s)`, `GetPage`, `ReorderPages`,
`UpdateFileTitle`, `DuplicateFile`, `SubscribeToFile/Page`.
Publish/share: `PublishDoc`, `GetPublishedPageWithSnapshot`, `SetFilePassword`,
`AddFileCollaborators`, `ModifyFilePermissions`.
Workspace: `GetWorkspace(Members)`, `GetFolder`, `FavoriteFile`, credits ops.

There is a **separate AI/media GraphQL host** gated behind feature flags:
`aiApiHostEnabled{Media,ImportPpt,BuddyChat,Design,ImageEdit,ImageGenerate}Graphql`.

### Frontend routes (marketing shell)
`/`, `/pricing`, `/signin`, `/signup`, `/templates`, `/inspiration`, `/explore`,
`/prompts`, `/products/{presentations,websites,documents,social-media,api,graphics}`,
`solutions/{consultants,marketing,sales,educators}`, `/about`, `/accessibility`,
`/integrations`, `/legal/*`, `/embed`, `/user`.
Sub-apps on subdomains: `help.`, `community.`, `developers.`, `brand.`,
`trust.`, `careers.`, `ideas.`, `lab.`, `team.`.

---

## 3. Reader / theme presentation (observed on a real deck)

- The public reader is a **vertical scroll of full-width cards** on a colored
  page background; each card is a rounded, shadowed panel.
- A slim **top bar**: deck title on the left, `Sign in to request access` +
  a `▶ Present` split-button + author avatar on the right.
- **Themes** are strong: a theme sets page background color, card surface,
  a display font + body font, text color, and accent color (e.g. navy card on
  a cornflower page, Poppins-ish display, light-blue headings).
- Cards are a mix of: hero/cover (image + overlaid title), rich-text body,
  block-quote (accent left border), section-divider card (contrasting surface
  with a big centered heading), and two-up profile/image+text layouts.

---

## 4. What this means for a clone

Gamma is a **vertical, card-based document editor with an AI generation
pipeline and a themeable block renderer**, not a horizontal slide tool. The
clone must get four things right:

1. **The card model** — an ordered list of cards; each card is a layout of
   typed blocks. Cards can be inserted between any two cards.
2. **The two-stage AI flow** — prompt → *editable outline* → *generated cards*
   (async, streamed/polled), with a follow-up chat to revise.
3. **The theme system** — a theme = fonts + colors + card styling, swappable
   live across the whole document.
4. **The reader** — vertical scroll, Present mode, Share/Export, matching the
   generated look.

See `2026-10-16-gamma-clone-design.md` for the build design.
