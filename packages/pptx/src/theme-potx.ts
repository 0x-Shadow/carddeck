/**
 * Build a PowerPoint *template* (.potx) carrying a deck's theme.
 *
 * PptxGenJS's `theme` prop only carries fonts; the color scheme has to be
 * injected into `ppt/theme/theme1.xml` ourselves. We generate a presentation
 * with the theme fonts, open its zip, replace the `<a:clrScheme>` color slots
 * with the theme's colors, and flip the main content type from
 * `presentationml.presentation` to `presentationml.template` so PowerPoint
 * opens it as a template ( masters + theme ) rather than a plain deck.
 *
 * Fonts map to `latin`/`ea` typefaces in the scheme; colors map to the OOXML
 * slots: dk1 (text) → ink, lt1 (background) → page, accent1 → accent.
 */
import PptxGenJS from "pptxgenjs";
import type { Theme } from "@carddeck/core";
import JSZip from "jszip";

function hex6(color: string): string {
  return color.replace("#", "").toUpperCase().slice(0, 6);
}

/** Build the OOXML color scheme element from a theme. */
function colorSchemeXml(theme: Theme): string {
  const { ink, page, surface, accent } = theme.colors;
  return [
    `<a:clrScheme name="${theme.name}">`,
    `<a:dk1><a:srgbClr val="${hex6(ink)}"/></a:dk1>`,
    `<a:lt1><a:srgbClr val="${hex6(page)}"/></a:lt1>`,
    `<a:dk2><a:srgbClr val="${hex6(surface)}"/></a:dk2>`,
    `<a:lt2><a:srgbClr val="${hex6(page)}"/></a:lt2>`,
    `<a:accent1><a:srgbClr val="${hex6(accent)}"/></a:accent1>`,
    `<a:accent2><a:srgbClr val="${hex6(surface)}"/></a:accent2>`,
    `<a:accent3><a:srgbClr val="${hex6(ink)}"/></a:accent3>`,
    `<a:accent4><a:srgbClr val="${hex6(accent)}"/></a:accent4>`,
    `<a:accent5><a:srgbClr val="${hex6(surface)}"/></a:accent5>`,
    `<a:accent6><a:srgbClr val="${hex6(ink)}"/></a:accent6>`,
    `<a:hlink><a:srgbClr val="${hex6(accent)}"/></a:hlink>`,
    `<a:folHlink><a:srgbClr val="${hex6(accent)}"/></a:folHlink>`,
    `</a:clrScheme>`,
  ].join("");
}

/** Inject theme fonts into the major/minor latin typefaces. */
function applyFonts(themeXml: string, theme: Theme): string {
  const font = (face: string) =>
    `<a:latin typeface="${face}"/><a:ea typeface="${face}"/><a:cs typeface="${face}"/>`;
  // Append theme typefaces to the major (heading) and minor (body) font defs.
  return themeXml
    .replace(
      /<a:majorFont>([\s\S]*?)<\/a:majorFont>/,
      (_m, inner) => `<a:majorFont>${inner}${font(theme.fonts.display)}</a:majorFont>`,
    )
    .replace(
      /<a:minorFont>([\s\S]*?)<\/a:minorFont>/,
      (_m, inner) => `<a:minorFont>${inner}${font(theme.fonts.body)}</a:minorFont>`,
    );
}

/** Replace the existing clrScheme block with the theme's. */
function applyColorScheme(themeXml: string, theme: Theme): string {
  const scheme = colorSchemeXml(theme);
  if (/<a:clrScheme[\s\S]*?<\/a:clrScheme>/.test(themeXml)) {
    return themeXml.replace(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/, scheme);
  }
  // Insert before </a:theme> if no scheme present.
  return themeXml.replace(/<\/a:theme>/, `${scheme}</a:theme>`);
}

/**
 * Produce a .potx Buffer for `theme`: a template whose master/theme carry the
 * theme's fonts and colors, so a deck reopens with the right skin.
 */
export async function buildThemePotxBuffer(theme: Theme): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.theme = { headFontFace: theme.fonts.display, bodyFontFace: theme.fonts.body };
  pres.title = `${theme.name} template`;
  pres.addSlide();

  const buf = Buffer.from((await pres.write({ outputType: "nodebuffer" })) as ArrayBuffer);

  const zip = await JSZip.loadAsync(buf);

  // theme1.xml: colors + fonts.
  const themeEntry = zip.file("ppt/theme/theme1.xml");
  if (!themeEntry) throw new Error("generated pptx has no ppt/theme/theme1.xml");
  let themeXml = await themeEntry.async("string");
  themeXml = applyColorScheme(themeXml, theme);
  themeXml = applyFonts(themeXml, theme);
  zip.file("ppt/theme/theme1.xml", themeXml);

  // [Content_Types].xml: presentation → template main part.
  const ctEntry = zip.file("[Content_Types].xml");
  if (ctEntry) {
    const ct = (await ctEntry.async("string")).replace(
      "presentationml.presentation.main+xml",
      "presentationml.template.main+xml",
    );
    zip.file("[Content_Types].xml", ct);
  }

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
