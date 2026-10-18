import { randomUUID } from "node:crypto";
import { getDb } from "../../web/lib/db";
import * as t from "../../web/drizzle/schema";
import { hashPassword } from "../../web/lib/auth";

export const DEFAULT_AGENT_EMAIL = "mcp@carddeck.local";

/** The agent account email, overridable via `CARDDECK_MCP_USER`. */
export function agentEmail(env: Record<string, string | undefined> = process.env): string {
  return env.CARDDECK_MCP_USER?.trim() || DEFAULT_AGENT_EMAIL;
}

/**
 * Ensure the MCP agent's user row exists and return its id. Idempotent.
 *
 * The MCP server is a local, trusted process (as trusted as the worker), but
 * decks still need an owner. The agent account exists to own those decks; its
 * password is random and unreachable — nothing logs into it. Provisioned at
 * server boot, with a lazy re-check per call so a wiped database heals on the
 * next tool use.
 */
export async function ensureAgentUser(
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const email = agentEmail(env);
  const db = getDb();
  const existing = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, email),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const [row] = await db
    .insert(t.user)
    .values({
      email,
      name: "Deck Agent",
      passwordHash: await hashPassword(randomUUID()),
    })
    .onConflictDoNothing()
    .returning({ id: t.user.id });
  if (row) return row.id;

  // Lost an insert race (two servers booted together): the row is there now.
  const raced = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.email, email),
    columns: { id: true },
  });
  if (!raced) throw new Error(`could not provision agent user ${email}`);
  return raced.id;
}
