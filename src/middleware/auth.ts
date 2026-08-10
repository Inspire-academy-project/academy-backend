import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import type { Role } from '../generated/prisma/client.js';

export type AuthUser = {
  id: number;
  email: string;
  role: Role;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new HttpError(401, '로그인이 필요합니다.'));
    return;
  }

  try {
    const payload = jwt.verify(header.slice('Bearer '.length), env.JWT_SECRET) as AuthUser;
    req.user = { id: payload.id, email: payload.email, role: payload.role };
    next();
  } catch {
    next(new HttpError(401, '토큰이 만료되었거나 유효하지 않습니다.'));
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new HttpError(403, '접근 권한이 없습니다.'));
      return;
    }
    next();
  };
}

export async function requireOwnStudentId(req: Request): Promise<number> {
  const student = await prisma.student.findUnique({
    where: { userId: req.user!.id },
    select: { id: true },
  });
  if (!student) {
    throw new HttpError(404, '학생 정보가 등록되어 있지 않습니다.');
  }
  return student.id;
}
