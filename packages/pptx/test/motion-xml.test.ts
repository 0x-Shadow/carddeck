// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { transitionXml, timingXml, shapeIdsInSlideXml } from "../src/motion-xml";
import type { EntranceKind } from "@carddeck/core";

const PMLNS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

// The injected fragments inherit these declarations from the slide root when
// written into the file; tests re-declare them so the parser can resolve the
// `p:`/`a:` prefixes on the bare fragment.
const parse = (fragment: string) => {
  const xml = fragment.replace(/^<p:(transition|timing)/, `<p:$1 ${PMLNS}`);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  return doc;
};

/**
 * Query a parsed PML fragment by local name.
 *
 * jsdom's XML documents match selectors on the literal qualified name, so a
 * bare `cTn` matches nothing while `p:cTn` matches everything. Scoping to the
 * element itself keeps these assertions about shape, not about how the
 * namespace prefix happens to be spelled.
 */
function els(root: Document | Element, local: string): Element[] {
  return Array.from(root.getElementsByTagName(`p:${local}`));
}

function el(root: Document | Element, local: string): Element | undefined {
  return els(root, local)[0];
}

const builds: Array<{ effect: EntranceKind; delayMs: number }> = [
  { effect: "fade", delayMs: 0 },
  { effect: "wipeUp", delayMs: 200 },
  { effect: "flyLeft", delayMs: 500 },
  { effect: "zoom", delayMs: 800 },
];

describe("transitionXml", () => {
  it("emits well-formed XML for every transition kind", () => {
    for (const kind of ["fade", "push", "wipe", "cover", "split"] as const) {
      const doc = parse(transitionXml(kind));
      expect(doc.querySelector("parsererror")).toBeNull();
      expect(doc.documentElement.localName).toBe("transition");
    }
  });

  it("advances on click, not on a timer", () => {
    const doc = parse(transitionXml("fade"));
    expect(doc.documentElement.getAttribute("advClick")).toBe("1");
  });
});

describe("shapeIdsInSlideXml", () => {
  it("collects text-shape ids in order and skips group, picture and table shapes", () => {
    const xml =
      `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/></p:nvGrpSpPr>` +
      `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture"/></p:nvPicPr></p:pic>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/></p:nvSpPr></p:sp>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Body"/></p:nvSpPr></p:sp>` +
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Table"/>` +
      `</p:nvGraphicFramePr></p:graphicFrame>` +
      `</p:spTree>`;
    // Only the two text shapes: a build must never target the picture (id 2)
    // or the table (id 5).
    expect(shapeIdsInSlideXml(xml)).toEqual([3, 4]);
  });
});

describe("timingXml", () => {
  it("emits well-formed XML", () => {
    const doc = parse(timingXml(builds, [2, 3, 4, 5]));
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.localName).toBe("timing");
  });

  it("starts on one click effect and staggers the rest withEffect", () => {
    const doc = parse(timingXml(builds, [2, 3, 4, 5]));
    // The entrance nodes are the cTn elements carrying presetClass="entr".
    const entr = els(doc, "cTn").filter((n) => n.getAttribute("presetClass") === "entr");
    expect(entr).toHaveLength(4);
    expect(entr[0].getAttribute("nodeType")).toBe("clickEffect");
    expect(entr.slice(1).map((n) => n.getAttribute("nodeType"))).toEqual([
      "withEffect",
      "withEffect",
      "withEffect",
    ]);
    // Each staggered entrance starts after its plan delay (build 0 is the click).
    expect(
      entr
        .slice(1)
        .map((n) => el(n, "stCondLst") && el(el(n, "stCondLst")!, "cond")?.getAttribute("delay")),
    ).toEqual(["200", "500", "800"]);
  });

  it("targets exactly the shape ids it was handed", () => {
    const doc = parse(timingXml(builds, [2, 3]));
    const targets = new Set(els(doc, "spTgt").map((n) => n.getAttribute("spid")));
    expect(targets).toEqual(new Set(["2", "3"]));
  });

  it("clamps builds to the shapes that exist on the slide", () => {
    const doc = parse(timingXml(builds, [2])); // 4 builds, 1 shape
    const entr = els(doc, "cTn").filter((n) => n.getAttribute("presetClass") === "entr");
    expect(entr).toHaveLength(1);
  });

  it("maps every entrance kind to its PowerPoint behavior", () => {
    const doc = parse(timingXml(builds, [2, 3, 4, 5]));
    const entr = els(doc, "cTn").filter((n) => n.getAttribute("presetClass") === "entr");
    // fade + wipeUp ride animEffect filters…
    expect(el(entr[0], "animEffect")?.getAttribute("filter")).toBe("fade");
    expect(el(entr[1], "animEffect")?.getAttribute("filter")).toBe("wipe(down)");
    // …fly animates ppt_x, zoom animates scale.
    expect(el(el(entr[2], "anim")!, "attrName")?.textContent).toBe("ppt_x");
    expect(el(entr[3], "animScale")).toBeTruthy();
    // Every entrance sets visibility so nothing shows before its effect.
    for (const node of entr) {
      expect(el(el(node, "set")!, "attrName")?.textContent).toBe("style.visibility");
    }
  });

  it("assigns cTn ids unique across the skeleton and the shapes", () => {
    const doc = parse(timingXml(builds, [2, 3, 4, 5]));
    const ids = els(doc, "cTn").map((n) => n.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists every animated shape in bldLst", () => {
    const doc = parse(timingXml(builds, [2, 3]));
    const spids = new Set(els(doc, "bldP").map((n) => n.getAttribute("spid")));
    expect(spids).toEqual(new Set(["2", "3"]));
  });

  it("returns empty when the slide has no shapes to animate", () => {
    expect(timingXml(builds, [])).toBe("");
  });
});
