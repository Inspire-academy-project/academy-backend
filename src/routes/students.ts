import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const studentsRouter = Router();

studentsRouter.use(requireAuth, requireRole('ADMIN', 'TEACHER'));

studentsRouter.get('/', async (req, res) => {
  const query = z
    .object({
      className: z.string().optional(),
      active: z.enum(['true', 'false']).optional(),
      q: z.string().optional(),
    })
    .parse(req.query);

  const students = await prisma.student.findMany({
    where: {
      className: query.className,
      active: query.active ? query.active === 'true' : undefined,
      user: query.q ? { name: { contains: query.q, mode: 'insensitive' } } : undefined,
    },
    select: {
      id: true,
      className: true,
      parentPhone: true,
      active: true,
      enrolledAt: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
    orderBy: [{ className: 'asc' }, { id: 'asc' }],
  });

  res.json(students);
});

studentsRouter.get('/:id', async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);

  const student = await prisma.student.findUnique({
    where: { id },
    select: {
      id: true,
      className: true,
      parentPhone: true,
      active: true,
      enrolledAt: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
      payments: { orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 12 },
      attendances: { orderBy: { date: 'desc' }, take: 30 },
    },
  });
  if (!student) {
    throw new HttpError(404, '학생을 찾을 수 없습니다.');
  }

  res.json(student);
});

const createSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().min(1),
  phone: z.string().optional(),
  className: z.string().optional(),
  parentPhone: z.string().optional(),
});

studentsRouter.post('/', async (req, res) => {
  const body = createSchema.parse(req.body);

  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) {
    throw new HttpError(409, '이미 가입된 이메일입니다.');
  }

  const student = await prisma.student.create({
    data: {
      className: body.className,
      parentPhone: body.parentPhone,
      user: {
        create: {
          email: body.email,
          password: await bcrypt.hash(body.password, 10),
          name: body.name,
          phone: body.phone,
          role: 'STUDENT',
        },
      },
    },
    select: {
      id: true,
      className: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  res.status(201).json(student);
});

const updateSchema = z.object({
  className: z.string().nullish(),
  parentPhone: z.string().nullish(),
  active: z.boolean().optional(),
});

studentsRouter.patch('/:id', async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const body = updateSchema.parse(req.body);

  const student = await prisma.student.update({
    where: { id },
    data: body,
    select: { id: true, className: true, parentPhone: true, active: true },
  });

  res.json(student);
});
