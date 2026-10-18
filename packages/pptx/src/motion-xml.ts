/**
 * OOXML animation injection.
 *
 * PowerPoint stores motion in two parts of a slide's XML:
 *
 * - `<p:transition>` — the between-slide transition (fade / push / wipe …);
 * - `<p:timing>` — the per-shape entrance animations, as a `mainSeq` tree of
 *   `cTn` nodes with a visibility `set` + an `animEffect`/`anim`/`animScale`
 *   behavior per shape.
 *
 * `PptxGenJS` has no animation API, so a deck's motion plan is applied as a
 * post-build step over the zipped file. That keeps the whole path
 * deterministic and testable: the serializers below emit strings (unit-tested
 * against a real DOM parser), and `injectMotion` writes them into the slide
 * parts.
 *
 * Every entrance sets `style.visibility` to `visible` before its behavior,
 * because PowerPoint hides an animated shape until its effect runs — omitting
 * the `set` leaves shapes blank until the effect fires.
 */
import type { EntranceKind, MotionPlan, SlideMotion, TransitionKind } from "@carddeck/core";
import type JSZip from "jszip";

/** `<p:transition>` for one slide. */
export function transitionXml(kind: TransitionKind): string {
  const inner = (() => {
    switch (kind) {
      case "push":
        return '<p:push dir="u"/>';
      case "wipe":
        return '<p:wipe dir="d"/>';
      case "cover":
        return '<p:cover dir="d"/>';
      case "split":
        return '<p:split orient="horz" dir="out"/>';
      case "fade":
      default:
        return "<p:fade/>";
    }
  })();
  return `<p:transition spd="med" advClick="1">${inner}</p:transition>`;
}

/** PowerPoint `presetID` per entrance kind (the effect-pane registry id). */
const PRESET_ID: Record<EntranceKind, number> = {
  fade: 10,
  wipeUp: 22,
  flyLeft: 2,
  zoom: 23,
};

/**
 * The behavior nodes for one entrance.
 *
 * `fade` and `wipeUp` are `animEffect` filters; `flyLeft` animates `ppt_x`
 * from off-column to its place; `zoom` fades while scaling up.
 */
function effectXml(effect: EntranceKind, shapeId: number, nextId: () => number): string {
  const target = `<p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl>`;
  const set =
    `<p:set><p:cBhvr>` +
    `<p:cTn id="${nextId()}" dur="1" fill="hold">` +
    `<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>` +
    target +
    `<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>` +
    `</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`;

  switch (effect) {
    case "fade":
      return (
        set +
        `<p:animEffect transition="in" filter="fade"><p:cBhvr>` +
        `<p:cTn id="${nextId()}" dur="500"/>` +
        target +
        `</p:cBhvr></p:animEffect>`
      );
    case "wipeUp":
      return (
        set +
        `<p:animEffect transition="in" filter="wipe(down)"><p:cBhvr>` +
        `<p:cTn id="${nextId()}" dur="600"/>` +
        target +
        `</p:cBhvr></p:animEffect>`
      );
    case "zoom":
      return (
        set +
        `<p:animEffect transition="in" filter="fade"><p:cBhvr>` +
        `<p:cTn id="${nextId()}" dur="500"/>` +
        target +
        `</p:cBhvr></p:animEffect>` +
        `<p:animScale><p:cBhvr><p:cTn id="${nextId()}" dur="500" fill="hold"/>` +
        target +
        `</p:cBhvr><p:from x="62500" y="62500"/><p:to x="100000" y="100000"/></p:animScale>`
      );
    case "flyLeft":
    default:
      return (
        set +
        `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base">` +
        `<p:cTn id="${nextId()}" dur="600" fill="hold"/>` +
        target +
        `<p:attrNameLst><p:attrName>ppt_x</p:attrName></p:attrNameLst></p:cBhvr>` +
        `<p:tavLst><p:tav tm="0"><p:val><p:strVal val="#ppt_x-0.4"/></p:val></p:tav>` +
        `<p:tav tm="100000"><p:val><p:strVal val="#ppt_x"/></p:val></p:tav></p:tavLst></p:anim>`
      );
  }
}

/**
 * The text-shape ids on a slide, in document order.
 *
 * Only `<p:sp>` (text shapes) count, never `<p:pic>` (images) or
 * `<p:graphicFrame>` (tables): a motion plan's builds are per content block,
 * and an image block emits a picture shape rather than a text shape. Taking
 * every `cNvPr` would hand the title's build to whatever shape happened to be
 * written first.
 *
 * This matters because pptxgenjs numbers **all** slide objects off one shared
 * counter (`id = index + 2`) in the order they are added, and the exporter
 * adds images before text. A slide with a leading image block therefore
 * writes `pic id=2`, then `sp id=3`, `sp id=4`… — collecting ids blindly
 * would animate the image with the title's build and shift every later effect
 * onto the wrong shape.
 */
export function shapeIdsInSlideXml(xml: string): number[] {
  const ids: number[] = [];
  // Match each <p:sp>…</p:sp> block, then its cNvPr id.
  const shapeRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  for (let m = shapeRe.exec(xml); m; m = shapeRe.exec(xml)) {
    const idMatch = /<p:cNvPr[^>]*\sid="(\d+)"/.exec(m[1]);
    if (idMatch) ids.push(Number(idMatch[1]));
  }
  // ids are assigned in document order, but sorting keeps the build → shape
  // pairing stable if that ever changes.
  return ids.sort((a, b) => a - b);
}

/**
 * `<p:timing>` for one slide: a single click group whose first shape is a
 * `clickEffect` and the rest `withEffect`, each at its plan `delayMs`.
 *
 * Builds beyond the shapes actually on the slide are dropped rather than
 * targeting a missing shape id (which PowerPoint treats as a corrupt file).
 */
export function timingXml(builds: SlideMotion["builds"], shapeIds: number[]): string {
  // 1–4 are taken by the fixed tmRoot/mainSeq/group skeleton below.
  let id = 5;
  const nextId = () => id++;

  const entries = builds
    .slice(0, shapeIds.length)
    .map((build, i) => {
      const shapeId = shapeIds[i];
      const nodeType = i === 0 ? "clickEffect" : "withEffect";
      return (
        `<p:par><p:cTn id="${nextId()}" presetID="${PRESET_ID[build.effect]}" ` +
        `presetClass="entr" fill="hold" grpId="0" nodeType="${nodeType}">` +
        `<p:stCondLst><p:cond delay="${build.delayMs}"/></p:stCondLst>` +
        `<p:childTnLst>${effectXml(build.effect, shapeId, nextId)}</p:childTnLst>` +
        `</p:cTn></p:par>`
      );
    })
    .join("");

  if (!entries) return "";

  const bldLst = shapeIds
    .slice(0, builds.length)
    .map((shapeId) => `<p:bldP spid="${shapeId}" grpId="0"/>`)
    .join("");

  return (
    `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">` +
    `<p:childTnLst><p:seq concurrent="1" nextAc="seek">` +
    `<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>` +
    `<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>` +
    `<p:childTnLst><p:par><p:cTn id="4" fill="hold">` +
    `<p:stCondLst><p:cond delay="0"/></p:stCondLst>` +
    `<p:childTnLst>${entries}</p:childTnLst>` +
    `</p:cTn></p:par></p:childTnLst>` +
    `</p:cTn></p:par>` +
    `</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>` +
    `</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>` +
    (bldLst ? `<p:bldLst>${bldLst}</p:bldLst>` : "") +
    `</p:timing>`
  );
}

/**
 * Write a motion plan into the zipped presentation: `ppt/slides/slideN.xml`
 * gets the plan's transition and timing (1-based, plan order = card order).
 *
 * A plan entry that covers a slide the file does not have is an error rather
 * than a silent skip — a deck whose plan drifted from its slides should not
 * export a half-animated file that looks fine.
 */
export async function injectMotion(zip: JSZip, plan: MotionPlan): Promise<void> {
  for (const [index, slide] of plan.slides.entries()) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    const file = zip.file(path);
    if (!file) {
      throw new Error(`motion plan covers missing slide: ${path}`);
    }
    const xml = await file.async("string");
    const shapeIds = shapeIdsInSlideXml(xml);
    const transition = transitionXml(slide.transition);
    const timing = timingXml(slide.builds, shapeIds);
    // <p:transition> and <p:timing> follow the slide content, before </p:sld>.
    const updated = xml.replace("</p:sld>", `${transition}${timing}</p:sld>`);
    zip.file(path, updated);
  }
}
