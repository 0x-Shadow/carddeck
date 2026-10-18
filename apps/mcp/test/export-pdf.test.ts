import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { makeTestDb, setTestDb, type DB } from "../../web/lib/db";
import { createServer } from "../src/tools";

/**
 * PDF export needs headless Chromium. When it is missing (a fresh machine, a
 * stripped container) the tool must say exactly what to do — the same
 * actionable hint the web route gives — instead of leaking a raw module or
 * launch error.
 *
 * The `playwright` mock factory throws, which makes `await import("playwright")`
 * itself reject: exactly the shape of "package not installed at all", the case
 * the import-inside-try fix exists for. Nothing here needs a real browser.
 */
vi.mock("playwright", () => {
  throw new Error("Cannot find package 'playwright'");
});

interface Envelope {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function connect(): Promise<Client> {
  const server = await createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; body: Envelope }> {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text: string }[];
  return { isError: res.isError === true, body: JSON.parse(content[0].text) as Envelope };
}

describe("export_deck pdf without Chromium", () => {
  let db: DB;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "carddeck-mcp-pdf-"));
    process.env.DATA_DIR = dataDir;
    db = makeTestDb();
    setTestDb(db);
  });

  afterEach(() => {
    setTestDb(null);
    delete process.env.DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("explains how to install the browser instead of failing raw", async () => {
    const client = await connect();
    const created = await call(client, "create_deck_from_cards", {
      title: "Broken PDF",
      cards: [{ title: "One", content: ["hello"] }],
    });
    const deckId = created.body.deckId as string;

    const out = await call(client, "export_deck", { deckId, format: "pdf" });
    expect(out.isError).toBe(true);
    expect(out.body.ok).toBe(false);
    const error = String(out.body.error);
    expect(error).toContain("PDF export unavailable");
    expect(error).toContain("npx playwright install chromium");
  });
});
