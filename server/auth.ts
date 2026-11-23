import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, and, gt, lt } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { users, sessions, apiKeys } from '../src/db/schema.ts';

export const SESSION_COOKIE_NAME = 'boardsight_session';

const EPHEMERAL_AUTH_SECRET = crypto.randomBytes(32).toString('hex');

function getAuthSecret(): string {
  if (!process.env.AUTH_SECRET) {
    return EPHEMERAL_AUTH_SECRET;
  }
  return process.env.AUTH_SECRET;
}

const loginFailureWindow = new Map<string, { count: number; resetAt: number }>();

export function isLoginRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = loginFailureWindow.get(key);
  if (!entry) return false;
  if (now > entry.resetAt) {
    loginFailureWindow.delete(key);
    return false;
  }
  return entry.count >= 12;
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const entry = loginFailureWindow.get(key);
  if (!entry || now > entry.resetAt) {
    loginFailureWindow.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(key: string): void {
  loginFailureWindow.delete(key);
}

export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  sessionId?: string;
  apiKeyName?: string;
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function generateRawApiKey(): { rawKey: string; prefix: string; hash: string } {
  const raw = `bs_aoi_${crypto.randomBytes(24).toString('hex')}`;
  return {
    rawKey: raw,
    prefix: raw.slice(0, 14),
    hash: hashApiKey(raw),
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: number): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  const token = jwt.sign({ sid: sessionId, uid: userId }, getAuthSecret(), {
    expiresIn: '7d',
  });

  return { token, sessionId, expiresAt };
}

function isHttpsRequest(req?: Request): boolean {
  if (!req) return Boolean(process.env.APP_URL?.startsWith('https://'));
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') {
    return true;
  }
  return req.secure;
}

export function setSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
  req?: Request
): void {
  const https = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: https ? 'none' : 'lax',
    secure: https,
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res: Response, req?: Request): void {
  const https = isHttpsRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: https ? 'none' : 'lax',
    secure: https,
    path: '/',
  });
}

export async function resolveUserFromRequest(req: AuthenticatedRequest): Promise<AuthUser | null> {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const token = cookieToken || bearerToken;

  if (!token) return null;

  try {
    const payload = jwt.verify(token, getAuthSecret()) as { sid: string; uid: number };
    const [sessionRow] = await db
      .select({
        sessionId: sessions.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        avatarUrl: users.avatarUrl,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.id, payload.sid), gt(sessions.expiresAt, new Date())))
      .limit(1);

    if (!sessionRow) return null;

    req.sessionId = sessionRow.sessionId;
    return {
      id: sessionRow.userId,
      name: sessionRow.name,
      email: sessionRow.email,
      role: sessionRow.role,
      avatarUrl: sessionRow.avatarUrl,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = await resolveUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  req.user = user;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: `Requires ${roles.join(' or ')} authorization (current role: ${req.user.role}).`,
      });
      return;
    }
    next();
  };
}

export async function requireAuthOrApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawApiKey = req.headers['x-api-key'] as string | undefined;

  if (rawApiKey) {
    const keyHash = hashApiKey(rawApiKey.trim());
    const [keyRecord] = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        userRole: users.role,
        avatarUrl: users.avatarUrl,
      })
      .from(apiKeys)
      .innerJoin(users, eq(apiKeys.userId, users.id))
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (keyRecord) {
      await db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, keyRecord.id));

      req.user = {
        id: keyRecord.userId,
        name: keyRecord.userName,
        email: keyRecord.userEmail,
        role: keyRecord.userRole,
        avatarUrl: keyRecord.avatarUrl,
      };
      req.apiKeyName = keyRecord.name;
      next();
      return;
    }

    res.status(401).json({ error: 'Invalid AOI X-API-Key credential.' });
    return;
  }

  return requireAuth(req, res, next);
}
