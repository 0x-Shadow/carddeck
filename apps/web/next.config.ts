import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright locates its browser binaries on the filesystem at runtime via
  // dynamic requires; keep it out of the server bundle so `next build`/`start`
  // resolve it through node_modules instead.
  serverExternalPackages: ["playwright"],
};

export default nextConfig;
