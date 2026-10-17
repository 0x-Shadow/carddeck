import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword, verifyAgainstDummy, createSessionToken, SESSION_COOKIE } from "@/lib/auth";

/** POST /api/auth/login { email, password } -> 200 { user } + session cookie */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    password?: string;
  } | null;

  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;
  if (!email || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const db = getDb();
  const user = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, email) });
  // Unknown emails still burn one argon2 verification (verifyAgainstDummy) so
  // response timing can't be used to enumerate registered addresses.
  if (!user) {
    // Unknown emails still burn one argon2 verification (verifyAgainstDummy)
    // so response timing can't be used to enumerate registered addresses.
    await verifyAgainstDummy(password);
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const token = createSessionToken(user.id);
  const res = NextResponse.json(
    { user: { id: user.id, email: user.email, name: user.name } },
    { status: 200 },
  );
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
