import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parseDateOnly } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { chargeForPeriod, hasFixedDailyRate, refundStatus } from '../lib/tuition.js';
import { requireAuth, requireOwnStudentId, requireRole } from '../middleware/auth.js';

export const paymentsRouter = Router();

paymentsRouter.use(requireAuth);

const studentSelect = {
  id: true,
  seatNo: true,
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
  const query = z.object({ feeType: z.enum(['TUITION', 'OTHER']).optional() }).parse(req.query);

  const periods = await prisma.billingPeriod.findMany({
    where: { feeType: query.feeType },
    orderBy: [{ startDate: 'desc' }],
    include: { _count: { select: { payments: true } } },
  });

  res.json(periods);
});

const periodSchema = z.object({
  feeType: z.enum(['TUITION', 'OTHER']).default('TUITION'),
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

/**
 * 재원생 전체에게 이 주기의 청구서를 한 번에 생성한다.
 *
 * 금액은 학생마다 다르다. 얼리·작년등록생은 65만원, 그 외는 68만원이고
 * 일할 단가도 각각 22,000원·23,000원으로 매뉴얼에 고정돼 있다.
 * 일할계산은 등원일이 이 주기 안에 있는 학생(=첫 달)에게만 적용된다.
 */
paymentsRouter.post('/periods/:id/generate', requireRole('ADMIN'), async (req, res) => {
  const periodId = z.coerce.number().int().parse(req.params.id);

  const period = await prisma.billingPeriod.findUnique({ where: { id: periodId } });
  if (!period) {
    throw new HttpError(404, '청구 주기를 찾을 수 없습니다.');
  }

  const students = await prisma.student.findMany({
    where: { active: true, enrolledAt: { lte: period.endDate } },
    select: { id: true, name: true, seatNo: true, enrolledAt: true, monthlyFee: true },
  });

  const rows = [];
  const prorated = [];
  const unknownRate = [];

  for (const student of students) {
    const charge = chargeForPeriod(
      student.enrolledAt,
      period.startDate,
      period.endDate,
      student.monthlyFee,
    );
    if (!charge) continue;

    rows.push({
      studentId: student.id,
      periodId,
      amount: charge.amount,
      proratedDays: charge.proratedDays,
    });

    if (charge.proratedDays !== null) {
      prorated.push({
        seatNo: student.seatNo,
        name: student.name,
        days: charge.proratedDays,
        dailyRate: charge.dailyRate,
        amount: charge.amount,
      });
    }
    if (!hasFixedDailyRate(student.monthlyFee) && charge.proratedDays !== null) {
      unknownRate.push({ seatNo: student.seatNo, monthlyFee: student.monthlyFee });
    }
  }

  const created = await prisma.payment.createMany({ data: rows, skipDuplicates: true });

  res.status(201).json({
    periodLabel: period.label,
    targetStudents: rows.length,
    created: created.count,
    skipped: rows.length - created.count,
    proratedStudents: prorated,
    // 매뉴얼에 없는 월 원비라 일할 단가를 30일로 나눠 추정한 건들
    unknownDailyRate: unknownRate,
  });
});

/**
 * 환불 가능 시점 조회. 금액은 계산하지 않는다 —
 * 실제 환불 여부와 금액은 감염병 사유 등 사람의 판단이 들어가므로 원장이 정한다.
 */
paymentsRouter.get('/refund-status', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const query = z
    .object({
      studentId: z.coerce.number().int(),
      periodId: z.coerce.number().int(),
      noticeDate: z.string().optional(),
    })
    .parse(req.query);

  const [student, period] = await Promise.all([
    prisma.student.findUnique({
      where: { id: query.studentId },
      select: { id: true, seatNo: true, name: true, enrolledAt: true, monthlyFee: true },
    }),
    prisma.billingPeriod.findUnique({ where: { id: query.periodId } }),
  ]);

  if (!student) throw new HttpError(404, '학생을 찾을 수 없습니다.');
  if (!period) throw new HttpError(404, '청구 주기를 찾을 수 없습니다.');

  const status = refundStatus(
    student.enrolledAt,
    period.startDate,
    period.endDate,
    query.noticeDate ? parseDateOnly(query.noticeDate, 'noticeDate') : null,
  );

  const asDate = (d: Date) => d.toISOString().slice(0, 10);

  res.json({
    student: { id: student.id, seatNo: student.seatNo, name: student.name },
    period: { id: period.id, label: period.label },
    tier: status.tier,
    label: status.label,
    elapsedDays: status.elapsedDays,
    totalDays: status.totalDays,
    effectiveStart: asDate(status.effectiveStart),
    twoThirdsUntil: asDate(status.twoThirdsUntil),
    halfUntil: asDate(status.halfUntil),
    note: '금액은 계산하지 않습니다. 환불 여부와 금액은 원장이 판단합니다.',
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
      feeType: z.enum(['TUITION', 'OTHER']).optional(),
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
    orderBy: [{ period: { startDate: 'desc' } }, { student: { seatNo: 'asc' } }],
  });

  res.json(rows);
});

/** 미납 현황 — 납부 기한이 지난 건만 집계한다. */
paymentsRouter.get('/unpaid', requireRole('ADMIN'), async (req, res) => {
  const query = z
    .object({
      feeType: z.enum(['TUITION', 'OTHER']).optional(),
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
    orderBy: [{ period: { dueDate: 'asc' } }, { student: { seatNo: 'asc' } }],
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
