import { createHash, timingSafeEqual } from 'node:crypto';
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

/**
 * 길이가 달라도 비교 시간이 같도록 해시로 맞춰 놓고 비교한다.
 * 값을 한 글자씩 바꿔 가며 응답 시간을 재는 방식으로 알아내지 못하게 하기 위함이다.
 */
function matchesSecret(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * 출결 패드는 로그인을 할 수 없으므로 기기에 심어 둔 토큰으로 확인한다.
 * 주소를 알아내도 토큰이 없으면 출결을 찍을 수 없다.
 */
export function requireKioskDevice(req: Request, _res: Response, next: NextFunction): void {
  if (!env.KIOSK_TOKEN) {
    next(new HttpError(503, '키오스크가 설정되지 않았습니다. 관리자에게 문의하세요.'));
    return;
  }

  const provided = req.header('X-Kiosk-Token');
  if (!provided || !matchesSecret(provided, env.KIOSK_TOKEN)) {
    next(new HttpError(401, '등록되지 않은 기기입니다.'));
    return;
  }

  next();
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
