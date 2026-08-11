import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parseDateOnly } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireOwnStudentId, requireRole } from '../middleware/auth.js';

export const paymentsRouter = Router();

paymentsRouter.use(requireAuth);

const studentSelect = {
  id: true,
  studentNo: true,
  name: true,
  gender: true,
  course: true,
  parentPhone: true,
} as const;

function resolveStatus(amount: number, paidAmount: number) {
  if (paidAmount <= 0) return 'UNPAID' as const;
  return paidAmount >= amount ? ('PAID' as const) : ('PARTIAL' as const);
}

/* ---------- 청구 주기 (학원비 3월=3/16~4/15, 급식비 등) ---------- */

paymentsRouter.get('/periods', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const query = z.object({ feeType: z.enum(['TUITION', 'MEAL', 'OTHER']).optional() }).parse(req.query);

  const periods = await prisma.billingPeriod.findMany({
    where: { feeType: query.feeType },
    orderBy: [{ startDate: 'desc' }],
    include: { _count: { select: { payments: true } } },
  });

  res.json(periods);
});

const periodSchema = z.object({
  feeType: z.enum(['TUITION', 'MEAL', 'OTHER']).default('TUITION'),
  label: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  dueDate: z.string(),
  baseAmount: z.number().int().positive().optional(),
});

paymentsRouter.post('/periods', requireRole('ADMIN'), async (req, res) => {
  const body = periodSchema.parse(req.body);

  const startDate = parseDateOnly(body.startDate, 'startDate');
  const endDate = parseDateOnly(body.endDate, 'endDate');
  if (endDate <= startDate) {
    throw new HttpError(400, '종료일은 시작일보다 뒤여야 합니다.');
  }

  const period = await prisma.billingPeriod.create({
    data: {
      feeType: body.feeType,
      label: body.label,
      startDate,
      endDate,
      dueDate: parseDateOnly(body.dueDate, 'dueDate'),
      baseAmount: body.baseAmount,
    },
  });

  res.status(201).json(period);
});

/** 재원생 전체에게 이 주기의 청구서를 한 번에 생성. 등원일이 주기 중간이면 일할계산. */
paymentsRouter.post('/periods/:id/generate', requireRole('ADMIN'), async (req, res) => {
  const periodId = z.coerce.number().int().parse(req.params.id);
  const body = z
    .object({
      baseAmount: z.number().int().positive().optional(),
      prorateByEnrollment: z.boolean().default(true),
    })
    .parse(req.body);

  const period = await prisma.billingPeriod.findUnique({ where: { id: periodId } });
  if (!period) {
    throw new HttpError(404, '청구 주기를 찾을 수 없습니다.');
  }

  const baseAmount = body.baseAmount ?? period.baseAmount;
  if (!baseAmount) {
    throw new HttpError(400, '기준 금액이 없습니다. baseAmount를 지정하세요.');
  }

  const students = await prisma.student.findMany({
    where: { active: true, enrolledAt: { lte: period.endDate } },
    select: { id: true, enrolledAt: true },
  });

  const dayMs = 24 * 60 * 60 * 1000;
  const totalDays = Math.round((+period.endDate - +period.startDate) / dayMs) + 1;
  const dailyRate = Math.round(baseAmount / totalDays);

  const rows = students.map((student) => {
    const startsLate = student.enrolledAt > period.startDate;
    const days = startsLate
      ? Math.round((+period.endDate - +student.enrolledAt) / dayMs) + 1
      : totalDays;

    const prorated = body.prorateByEnrollment && startsLate;
    return {
      studentId: student.id,
      periodId,
      amount: prorated ? dailyRate * days : baseAmount,
      proratedDays: prorated ? days : null,
    };
  });

  const created = await prisma.payment.createMany({ data: rows, skipDuplicates: true });

  res.status(201).json({
    periodLabel: period.label,
    totalDays,
    dailyRate,
    targetStudents: rows.length,
    created: created.count,
    skipped: rows.length - created.count,
  });
});

/* ---------- 납부 내역 ---------- */

paymentsRouter.get('/me', async (req, res) => {
  const studentId = await requireOwnStudentId(req);

  const rows = await prisma.payment.findMany({
    where: { studentId },
    include: { period: true },
    orderBy: { period: { startDate: 'desc' } },
  });

  res.json(rows);
});

paymentsRouter.get('/', requireRole('ADMIN'), async (req, res) => {
  const query = z
    .object({
      periodId: z.coerce.number().int().optional(),
      feeType: z.enum(['TUITION', 'MEAL', 'OTHER']).optional(),
      status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'EXEMPT']).optional(),
      gender: z.enum(['MALE', 'FEMALE']).optional(),
    })
    .parse(req.query);

  const rows = await prisma.payment.findMany({
    where: {
      periodId: query.periodId,
      status: query.status,
      period: query.feeType ? { feeType: query.feeType } : undefined,
      student: query.gender ? { gender: query.gender } : undefined,
    },
    include: { student: { select: studentSelect }, period: true },
    orderBy: [{ period: { startDate: 'desc' } }, { student: { studentNo: 'asc' } }],
  });

  res.json(rows);
});

/** 미납 현황 — 납부 기한이 지난 건만 집계한다. */
paymentsRouter.get('/unpaid', requireRole('ADMIN'), async (req, res) => {
  const query = z
    .object({
      feeType: z.enum(['TUITION', 'MEAL', 'OTHER']).optional(),
      includeUpcoming: z.enum(['true', 'false']).default('false'),
    })
    .parse(req.query);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.payment.findMany({
    where: {
      status: { in: ['UNPAID', 'PARTIAL'] },
      period: {
        feeType: query.feeType,
        dueDate: query.includeUpcoming === 'true' ? undefined : { lte: today },
      },
    },
    include: { student: { select: studentSelect }, period: true },
    orderBy: [{ period: { dueDate: 'asc' } }, { student: { studentNo: 'asc' } }],
  });

  const outstandingTotal = rows.reduce((sum, row) => sum + (row.amount - row.paidAmount), 0);

  res.json({ count: rows.length, outstandingTotal, items: rows });
});

const createSchema = z.object({
  studentId: z.number().int(),
  periodId: z.number().int(),
  amount: z.number().int().positive(),
  proratedDays: z.number().int().positive().optional(),
  memo: z.string().optional(),
});

paymentsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const body = createSchema.parse(req.body);

  const row = await prisma.payment.create({ data: body });
  res.status(201).json(row);
});

const updateSchema = z.object({
  paidAmount: z.number().int().min(0).optional(),
  amount: z.number().int().positive().optional(),
  status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'EXEMPT']).optional(),
  memo: z.string().nullish(),
});

paymentsRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const body = updateSchema.parse(req.body);

  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) {
    throw new HttpError(404, '납부 내역을 찾을 수 없습니다.');
  }

  const amount = body.amount ?? payment.amount;
  const paidAmount = body.paidAmount ?? payment.paidAmount;
  const status = body.status ?? resolveStatus(amount, paidAmount);

  const row = await prisma.payment.update({
    where: { id },
    data: {
      amount,
      paidAmount,
      status,
      paidAt: status === 'PAID' ? (payment.paidAt ?? new Date()) : null,
      memo: body.memo === undefined ? undefined : body.memo,
    },
    include: { student: { select: studentSelect }, period: true },
  });

  res.json(row);
});
