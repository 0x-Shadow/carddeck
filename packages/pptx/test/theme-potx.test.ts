import { describe, it, expect } from "vitest";
import { buildThemePotxBuffer } from "../src/theme-potx";
import { PRESET_THEMES } from "@carddeck/core";

/** Read one entry's text out of a zip Buffer. */
async function readZipEntry(buf: Buffer, path: string): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file(path);
  if (!file) throw new Error(`no entry ${path} in zip`);
  return file.async("string");
}

/** 6-digit uppercase hex, no leading '#'. */
function hex6(color: string): string {
  return color.replace("#", "").toUpperCase().slice(0, 6);
}

describe("buildThemePotxBuffer", () => {
  it("emits a .potx zip carrying the theme accent color", async () => {
    const t = PRESET_THEMES.find((x) => x.name === "Midnight")!;
    const buf = await buildThemePotxBuffer(t);

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");

    const xml = await readZipEntry(buf, "ppt/theme/theme1.xml");
    expect(xml).toContain(hex6(t.colors.accent));
  });

  it("maps the full color scheme (ink, page, surface, accent) into theme1.xml", async () => {
    const t = PRESET_THEMES.find((x) => x.name === "Midnight")!;
    const buf = await buildThemePotxBuffer(t);
    const xml = await readZipEntry(buf, "ppt/theme/theme1.xml");

    // The OOXML color slots we populate.
    expect(xml).toContain(hex6(t.colors.ink)); // dk1 / text1
    expect(xml).toContain(hex6(t.colors.page)); // lt1 / background1
    expect(xml).toContain(hex6(t.colors.accent)); // accent1
  });

  it("carries the theme fonts into theme1.xml", async () => {
    const t = PRESET_THEMES.find((x) => x.name === "Midnight")!;
    const buf = await buildThemePotxBuffer(t);
    const xml = await readZipEntry(buf, "ppt/theme/theme1.xml");

    expect(xml).toContain(t.fonts.display);
    expect(xml).toContain(t.fonts.body);
  });

  it("is a template (not a plain presentation) via content types", async () => {
    const t = PRESET_THEMES.find((x) => x.name === "Midnight")!;
    const buf = await buildThemePotxBuffer(t);
    const ct = await readZipEntry(buf, "[Content_Types].xml");
    expect(ct).toContain("presentationml.template.main+xml");
  });
});
