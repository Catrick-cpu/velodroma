import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUser { id: string; username: string; }
export interface AuthedRequest extends Request { user?: AuthUser; }

const SECRET = process.env.JWT_SECRET || 'velodroma-dev-secret-change-me';

export function signToken(user: AuthUser): string {
  return jwt.sign(user, SECRET, { expiresIn: '30d' });
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, SECRET) as AuthUser;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
}

export function authOptional(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try { req.user = jwt.verify(header.slice(7), SECRET) as AuthUser; } catch {}
  }
  next();
}
