import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import type { Collections, AccountDoc } from "./db.js";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export class AuthError extends Error {}

export async function register(cols: Collections, username: string, password: string): Promise<void> {
  if (!USERNAME_RE.test(username)) throw new AuthError("username must be 3-16 chars: letters, digits, underscore");
  if (password.length < 6 || password.length > 128) throw new AuthError("password must be 6-128 chars");
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await cols.accounts.insertOne({ username, passwordHash, roles: ["player"], createdAt: new Date() });
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && (e as { code?: number }).code === 11000) {
      throw new AuthError("username already taken");
    }
    throw e;
  }
}

export async function login(
  cols: Collections,
  username: string,
  password: string
): Promise<{ token: string; account: AccountDoc }> {
  const account = await cols.accounts.findOne({ username });
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
    throw new AuthError("invalid username or password");
  }
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  await cols.sessions.insertOne({
    token,
    accountId: account._id!,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });
  return { token, account };
}

/** Resolve a Bearer token to its account, or null. */
export async function authenticate(cols: Collections, token: string | null): Promise<AccountDoc | null> {
  if (!token) return null;
  const session = await cols.sessions.findOne({ token, expiresAt: { $gt: new Date() } });
  if (!session) return null;
  return cols.accounts.findOne({ _id: new ObjectId(session.accountId) });
}
