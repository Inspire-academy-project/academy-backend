import type { NextFunction, Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { HttpError } from '../lib/http-error.js';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ message: '존재하지 않는 API 경로입니다.' });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ message: '입력값이 올바르지 않습니다.', detail: z.treeifyError(err) });
    return;
  }

  console.error(err);
  res.status(500).json({ message: '서버 오류가 발생했습니다.' });
}
