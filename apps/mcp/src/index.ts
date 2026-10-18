#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./tools";

/**
 * Carddeck MCP server — stdio entry point.
 *
 * stdout is the protocol wire; the only logs this process may write go to
 * stderr (agents parse stdout as JSON-RPC frames).
 */
async function main(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[carddeck-mcp] ready on stdio (DATA_DIR=%s)", process.env.DATA_DIR ?? "<repo>/data");
}

main().catch((err) => {
  console.error("[carddeck-mcp] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
