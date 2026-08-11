import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, signToken } from '../middleware/auth.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.'),
  name: z.string().min(1),
  phone: z.string().optional(),
  className: z.string().optional(),
  parentPhone: z.string().optional(),
});

authRouter.post('/register', async (req, res) => {
  const body = registerSchema.parse(req.body);

  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) {
    throw new HttpError(409, '이미 가입된 이메일입니다.');
  }

  const user = await prisma.user.create({
    data: {
      email: body.email,
      password: await bcrypt.hash(body.password, 10),
      name: body.name,
      phone: body.phone,
      role: 'STUDENT',
      student: {
        create: {
          name: body.name,
          className: body.className,
          parentPhone: body.parentPhone,
          enrolledAt: new Date(),
        },
      },
    },
    select: { id: true, email: true, name: true, role: true },
  });

  res.status(201).json({ user, token: signToken(user) });
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

authRouter.post('/login', async (req, res) => {
  const body = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || !(await bcrypt.compare(body.password, user.password))) {
    throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  const payload = { id: user.id, email: user.email, role: user.role };
  res.json({ user: { ...payload, name: user.name }, token: signToken(payload) });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      student: { select: { id: true, seatNo: true, className: true, active: true } },
    },
  });
  if (!user) {
    throw new HttpError(404, '사용자를 찾을 수 없습니다.');
  }
  res.json(user);
});
