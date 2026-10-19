import type { Metadata } from "next";
import "./globals.css";

/*
 * Self-hosted webfonts. The theme layer names Inter and Space Grotesk by
 * family, but naming a font does not load it — without these imports the
 * browser had no file to use and silently fell back to Times New Roman on
 * every surface. Bundling via @fontsource (rather than a runtime CDN fetch)
 * keeps the "offline, keyless" promise: the woff2 files ship inside the build.
 */
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";

export const metadata: Metadata = {
  title: "Carddeck",
  description: "Turn a prompt into an editable, exportable deck — with real .pptx export.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
