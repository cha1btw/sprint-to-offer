// Login without passwords: the bot sends a one-time link, the link becomes a
// signed session cookie. Only one person can ever log in: the owner, because
// only the owner's Telegram id can ask the bot for a link.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { Db } from "./db/index.ts";
import { loginTokens } from "./db/schema.ts";

export const SESSION_COOKIE = "sprint_session";
export const SESSION_DAYS = 30;
const LINK_MINUTES = 10;

const b64url = (buf: Buffer) => buf.toString("base64url");
const hmac = (secret: string, data: string) => b64url(createHmac("sha256", secret).update(data).digest());
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// "<expiry ms>.<signature>": nothing secret inside, the signature makes it unforgeable.
export function signSession(secret: string, now: Date = new Date()): string {
  const exp = String(now.getTime() + SESSION_DAYS * 86_400_000);
  return `${exp}.${hmac(secret, exp)}`;
}

export function verifySession(value: string | undefined, secret: string | undefined, now: Date = new Date()): boolean {
  if (!value || !secret || secret.length < 32) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  const expected = Buffer.from(hmac(secret, exp));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return Number(exp) > now.getTime();
}

export async function createLoginToken(db: Db, now: Date = new Date()): Promise<string> {
  const token = b64url(randomBytes(32));
  // Housekeeping: drop links that are used or expired.
  await db.delete(loginTokens).where(or(lt(loginTokens.expiresAt, now), isNotNull(loginTokens.usedAt)));
  await db.insert(loginTokens).values({
    tokenHash: sha256(token),
    expiresAt: new Date(now.getTime() + LINK_MINUTES * 60_000),
  });
  return token;
}

// Marks the link as used. Returns true only once, and only before it expires.
export async function consumeLoginToken(db: Db, token: string, now: Date = new Date()): Promise<boolean> {
  if (!token || token.length > 100) return false;
  const rows = await db
    .update(loginTokens)
    .set({ usedAt: now })
    .where(and(eq(loginTokens.tokenHash, sha256(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now)))
    .returning({ hash: loginTokens.tokenHash });
  return rows.length === 1;
}

export function ownerTelegramId(): number | null {
  const raw = process.env.OWNER_TELEGRAM_ID?.trim();
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
}
