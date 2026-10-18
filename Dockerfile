# Carddeck — self-hosted image: Next.js web + generation worker in one process
# tree, Chromium included so PDF export works out of the box.
#
#   docker compose up -d --build      (recommended; see docker-compose.yml)
#   docker build -t carddeck . && docker run -p 3000:3000 \
#     -e SESSION_SECRET="$(openssl rand -hex 32)" -v carddeck-data:/data carddeck
#
# Data (SQLite DB, uploaded images, exports) lives in DATA_DIR=/data — always
# mount a volume there.

# syntax=docker/dockerfile:1

# ── deps: install exactly what the lockfile says ────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# `npm ci` needs every workspace manifest present before it resolves the tree.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/ai/package.json packages/ai/
COPY packages/pptx/package.json packages/pptx/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/mcp/package.json apps/mcp/
COPY e2e/package.json e2e/
RUN npm ci

# ── build: Next.js production build (worker/mcp run from source via tsx) ────
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

# ── runtime: non-root, Playwright-ready, single data dir ────────────────────
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /app ./
# Chromium + its system libraries for PDF export. Browser binaries are shared
# by every user in the image, so the non-root process can still launch them.
RUN npx playwright install --with-deps chromium && chmod -R 755 /ms-playwright
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
# turbo runs the web server and the worker together (see turbo.json "start").
CMD ["npm", "run", "start"]
