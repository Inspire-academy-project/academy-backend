import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parseDateOnly } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireOwnStudentId, requireRole } from '../middleware/auth.js';

export const paymentsRouter = Router();

paymentsRouter.use(requireAuth);

const studentSelect = {
  id: true,
  className: true,
  user: { select: { name: true, phone: true } },
} as const;

paymentsRouter.get('/me', async (req, res) => {
  const studentId = await requireOwnStudentId(req);

  const rows = await prisma.payment.findMany({
    where: { studentId },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  res.json(rows);
});

paymentsRouter.get('/', requireRole('ADMIN'), async (req, res) => {
  const query = z
    .object({
      status: z.enum(['UNPAID', 'PARTIAL', 'PAID']).optional(),
      year: z.coerce.number().int().optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
      className: z.string().optional(),
    })
    .parse(req.query);

  const rows = await prisma.payment.findMany({
    where: {
      status: query.status,
      year: query.year,
      month: query.month,
      student: query.className ? { className: query.className } : undefined,
    },
    include: { student: { select: studentSelect } },
    orderBy: [{ year: 'desc' }, { month: 'desc' }, { studentId: 'asc' }],
  });

  res.json(rows);
});

paymentsRouter.get('/unpaid', requireRole('ADMIN'), async (_req, res) => {
  const rows = await prisma.payment.findMany({
    where: { status: { in: ['UNPAID', 'PARTIAL'] } },
    include: { student: { select: studentSelect } },
    orderBy: [{ dueDate: 'asc' }],
  });

  const total = rows.reduce((sum, row) => sum + (row.amount - row.paidAmount), 0);
  res.json({ count: rows.length, outstandingTotal: total, items: rows });
});

const createSchema = z.object({
  studentId: z.number().int(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  amount: z.number().int().positive(),
  dueDate: z.string(),
  memo: z.string().optional(),
});

paymentsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const body = createSchema.parse(req.body);

  const row = await prisma.payment.create({
    data: {
      studentId: body.studentId,
      year: body.year,
      month: body.month,
      amount: body.amount,
      dueDate: parseDateOnly(body.dueDate, 'dueDate'),
      memo: body.memo,
    },
  });

  res.status(201).json(row);
});

const paySchema = z.object({
  paidAmount: z.number().int().min(0),
  memo: z.string().optional(),
});

paymentsRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const body = paySchema.parse(req.body);

  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) {
    throw new HttpError(404, '납부 내역을 찾을 수 없습니다.');
  }

  const status =
    body.paidAmount >= payment.amount ? 'PAID' : body.paidAmount > 0 ? 'PARTIAL' : 'UNPAID';

  const row = await prisma.payment.update({
    where: { id },
    data: {
      paidAmount: body.paidAmount,
      status,
      paidAt: status === 'PAID' ? new Date() : null,
      memo: body.memo ?? payment.memo,
    },
  });

  res.json(row);
});
