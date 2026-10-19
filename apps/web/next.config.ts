import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright locates its browser binaries on the filesystem at runtime via
  // dynamic requires; keep it out of the server bundle so `next build`/`start`
  // resolve it through node_modules instead.
  serverExternalPackages: ["playwright"],

  // `next dev` and `next build` share `.next` by default, so a production
  // build silently overwrites the directory a running dev server is reading —
  // the dev server then dies with MODULE_NOT_FOUND on its own chunks. QA and
  // CI can point at their own directory (`NEXT_DIST_DIR=.next-qa next build`)
  // to build for export testing without touching a live dev build.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
