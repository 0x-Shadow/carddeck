import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { hashPassword, createSessionToken, SESSION_COOKIE } from "@/lib/auth";

/** POST /api/auth/register { email, password, name } -> 201 { user } + session cookie */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    password?: string;
    name?: string;
  } | null;

  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;
  const name = body?.name?.trim();
  if (!email || !password || !name) {
    return NextResponse.json({ error: "email, password, name required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }

  const db = getDb();
  const existing = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, email) });
  if (existing) {
    return NextResponse.json({ error: "email already registered" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(t.user)
    .values({ email, name, passwordHash })
    .returning({ id: t.user.id, email: t.user.email, name: t.user.name });

  const token = createSessionToken(user.id);
  const res = NextResponse.json({ user }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Never send the session cookie over plain HTTP in production.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
