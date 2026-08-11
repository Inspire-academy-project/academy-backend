import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parseDateOnly } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const studentsRouter = Router();

studentsRouter.use(requireAuth, requireRole('ADMIN', 'TEACHER'));

const listSelect = {
  id: true,
  studentNo: true,
  name: true,
  gender: true,
  course: true,
  className: true,
  phone: true,
  parentPhone: true,
  attendanceCode: true,
  enrolledAt: true,
  active: true,
} as const;

studentsRouter.get('/', async (req, res) => {
  const query = z
    .object({
      gender: z.enum(['MALE', 'FEMALE']).optional(),
      course: z.string().optional(),
      className: z.string().optional(),
      active: z.enum(['true', 'false']).optional(),
      q: z.string().optional(),
    })
    .parse(req.query);

  const students = await prisma.student.findMany({
    where: {
      gender: query.gender,
      course: query.course,
      className: query.className,
      active: query.active ? query.active === 'true' : undefined,
      OR: query.q
        ? [
            { name: { contains: query.q, mode: 'insensitive' } },
            { studentNo: { contains: query.q, mode: 'insensitive' } },
          ]
        : undefined,
    },
    select: listSelect,
    orderBy: [{ gender: 'asc' }, { studentNo: 'asc' }, { id: 'asc' }],
  });

  res.json(students);
});

studentsRouter.get('/:id', async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);

  const student = await prisma.student.findUnique({
    where: { id },
    select: {
      ...listSelect,
      memo: true,
      leftAt: true,
      user: { select: { id: true, email: true } },
      payments: {
        include: { period: true },
        orderBy: { period: { startDate: 'desc' } },
        take: 24,
      },
      attendances: { orderBy: { date: 'desc' }, take: 30 },
    },
  });
  if (!student) {
    throw new HttpError(404, '학생을 찾을 수 없습니다.');
  }

  res.json(student);
});

const upsertSchema = z.object({
  studentNo: z.string().min(1).optional(),
  name: z.string().min(1),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  course: z.string().optional(),
  className: z.string().optional(),
  phone: z.string().optional(),
  parentPhone: z.string().optional(),
  attendanceCode: z.string().min(2).optional(),
  enrolledAt: z.string(),
  memo: z.string().optional(),
});

studentsRouter.post('/', async (req, res) => {
  const body = upsertSchema.parse(req.body);

  if (body.studentNo) {
    const dup = await prisma.student.findUnique({ where: { studentNo: body.studentNo } });
    if (dup) {
      throw new HttpError(409, `이미 사용 중인 학생번호입니다: ${body.studentNo}`);
    }
  }

  const student = await prisma.student.create({
    data: { ...body, enrolledAt: parseDateOnly(body.enrolledAt, 'enrolledAt') },
    select: listSelect,
  });

  res.status(201).json(student);
});

const patchSchema = upsertSchema.partial().extend({
  active: z.boolean().optional(),
  leftAt: z.string().nullish(),
});

studentsRouter.patch('/:id', async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const body = patchSchema.parse(req.body);

  const student = await prisma.student.update({
    where: { id },
    data: {
      ...body,
      enrolledAt: body.enrolledAt ? parseDateOnly(body.enrolledAt, 'enrolledAt') : undefined,
      leftAt: body.leftAt ? parseDateOnly(body.leftAt, 'leftAt') : body.leftAt,
    },
    select: listSelect,
  });

  res.json(student);
});
