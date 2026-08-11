import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parseDateOnly } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireOwnStudentId, requireRole } from '../middleware/auth.js';

export const mealsRouter = Router();

mealsRouter.use(requireAuth);

const mealTypeSchema = z.enum(['LUNCH', 'DINNER']);

const studentSelect = {
  id: true,
  seatNo: true,
  name: true,
  gender: true,
} as const;

/* ---------- 월별 신청·결제 ---------- */

mealsRouter.get('/orders', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const query = z
    .object({
      year: z.coerce.number().int(),
      month: z.coerce.number().int().min(1).max(12),
      mealType: mealTypeSchema.optional(),
      status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'EXEMPT']).optional(),
    })
    .parse(req.query);

  const orders = await prisma.mealOrder.findMany({
    where: {
      year: query.year,
      month: query.month,
      mealType: query.mealType,
      status: query.status,
    },
    include: { student: { select: studentSelect } },
    orderBy: [{ mealType: 'asc' }, { student: { seatNo: 'asc' } }],
  });

  const summary = orders.reduce(
    (acc, order) => {
      acc.totalCount += order.chargeCount;
      acc.totalAmount += order.amount;
      if (order.status !== 'PAID' && order.status !== 'EXEMPT') {
        acc.unpaidCount += 1;
        acc.unpaidAmount += order.amount;
      }
      return acc;
    },
    { totalCount: 0, totalAmount: 0, unpaidCount: 0, unpaidAmount: 0 },
  );

  res.json({ summary, items: orders });
});

const DEFAULT_UNIT_PRICE = 7_500;

const orderSchema = z.object({
  studentId: z.number().int(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  mealType: mealTypeSchema,
  orderedCount: z.number().int().min(0),
  carriedOver: z.number().int().min(0).default(0),
  unitPrice: z.number().int().positive().default(DEFAULT_UNIT_PRICE),
  method: z.string().optional(),
  memo: z.string().optional(),
});

/** 신청 등록. 결제할 개수 = 신청 - 이월(선결제)분. */
mealsRouter.post('/orders', requireRole('ADMIN'), async (req, res) => {
  const body = orderSchema.parse(req.body);

  if (body.carriedOver > body.orderedCount) {
    throw new HttpError(400, '이월 개수가 신청 개수보다 많을 수 없습니다.');
  }

  const chargeCount = body.orderedCount - body.carriedOver;
  const data = {
    ...body,
    chargeCount,
    amount: chargeCount * body.unitPrice,
  };

  const order = await prisma.mealOrder.upsert({
    where: {
      studentId_year_month_mealType: {
        studentId: body.studentId,
        year: body.year,
        month: body.month,
        mealType: body.mealType,
      },
    },
    create: data,
    update: data,
    include: { student: { select: studentSelect } },
  });

  res.status(201).json(order);
});

mealsRouter.patch('/orders/:id', requireRole('ADMIN'), async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const body = z
    .object({
      status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'EXEMPT']).optional(),
      method: z.string().nullish(),
      orderedCount: z.number().int().min(0).optional(),
      carriedOver: z.number().int().min(0).optional(),
      unitPrice: z.number().int().positive().optional(),
      memo: z.string().nullish(),
    })
    .parse(req.body);

  const order = await prisma.mealOrder.findUnique({ where: { id } });
  if (!order) {
    throw new HttpError(404, '급식 신청 내역을 찾을 수 없습니다.');
  }

  const orderedCount = body.orderedCount ?? order.orderedCount;
  const carriedOver = body.carriedOver ?? order.carriedOver;
  if (carriedOver > orderedCount) {
    throw new HttpError(400, '이월 개수가 신청 개수보다 많을 수 없습니다.');
  }

  const unitPrice = body.unitPrice ?? order.unitPrice;
  const chargeCount = orderedCount - carriedOver;
  const status = body.status ?? order.status;

  const updated = await prisma.mealOrder.update({
    where: { id },
    data: {
      orderedCount,
      carriedOver,
      unitPrice,
      chargeCount,
      amount: chargeCount * unitPrice,
      status,
      method: body.method === undefined ? undefined : body.method,
      memo: body.memo === undefined ? undefined : body.memo,
      paidAt: status === 'PAID' ? (order.paidAt ?? new Date()) : null,
    },
    include: { student: { select: studentSelect } },
  });

  res.json(updated);
});

mealsRouter.get('/orders/me', async (req, res) => {
  const studentId = await requireOwnStudentId(req);

  const orders = await prisma.mealOrder.findMany({
    where: { studentId },
    orderBy: [{ year: 'desc' }, { month: 'desc' }, { mealType: 'asc' }],
  });

  res.json(orders);
});

/* ---------- 일별 수령 (급식수령표) ---------- */

/** 그날의 수령표. 신청한 학생만 나오고, 이미 수령한 건 표시된다. */
mealsRouter.get('/records', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const query = z.object({ date: z.string(), mealType: mealTypeSchema }).parse(req.query);
  const date = parseDateOnly(query.date, 'date');

  const serviceDay = await prisma.mealServiceDay.findUnique({
    where: { date_mealType: { date, mealType: query.mealType } },
  });
  if (serviceDay && !serviceDay.operating) {
    res.json({ operating: false, note: serviceDay.note, items: [] });
    return;
  }

  const orders = await prisma.mealOrder.findMany({
    where: {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      mealType: query.mealType,
      orderedCount: { gt: 0 },
    },
    include: {
      student: {
        select: {
          ...studentSelect,
          mealRecords: { where: { date, mealType: query.mealType }, take: 1 },
        },
      },
    },
    orderBy: { student: { seatNo: 'asc' } },
  });

  res.json({
    operating: true,
    items: orders.map((order) => ({
      studentId: order.studentId,
      seatNo: order.student.seatNo,
      name: order.student.name,
      orderedCount: order.orderedCount,
      received: order.student.mealRecords.length > 0,
    })),
  });
});

const recordSchema = z.object({
  studentId: z.number().int(),
  date: z.string(),
  mealType: mealTypeSchema,
  received: z.boolean().default(true),
});

mealsRouter.post('/records', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const body = recordSchema.parse(req.body);
  const date = parseDateOnly(body.date, 'date');
  const key = {
    studentId_date_mealType: { studentId: body.studentId, date, mealType: body.mealType },
  };

  if (!body.received) {
    await prisma.mealRecord.deleteMany({
      where: { studentId: body.studentId, date, mealType: body.mealType },
    });
    res.json({ studentId: body.studentId, date: body.date, received: false });
    return;
  }

  const record = await prisma.mealRecord.upsert({
    where: key,
    create: { studentId: body.studentId, date, mealType: body.mealType, received: true },
    update: { received: true },
  });

  res.status(201).json(record);
});

/** 월별 실제 수령 횟수 — 신청 개수와 대조해 남은 개수를 본다. */
mealsRouter.get('/usage', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const query = z
    .object({
      year: z.coerce.number().int(),
      month: z.coerce.number().int().min(1).max(12),
      mealType: mealTypeSchema,
    })
    .parse(req.query);

  const from = new Date(Date.UTC(query.year, query.month - 1, 1));
  const to = new Date(Date.UTC(query.year, query.month, 0));

  const [orders, grouped] = await Promise.all([
    prisma.mealOrder.findMany({
      where: { year: query.year, month: query.month, mealType: query.mealType },
      include: { student: { select: studentSelect } },
      orderBy: { student: { seatNo: 'asc' } },
    }),
    prisma.mealRecord.groupBy({
      by: ['studentId'],
      where: { date: { gte: from, lte: to }, mealType: query.mealType, received: true },
      _count: { _all: true },
    }),
  ]);

  const usedByStudent = new Map(grouped.map((row) => [row.studentId, row._count._all]));

  res.json(
    orders.map((order) => {
      const used = usedByStudent.get(order.studentId) ?? 0;
      return {
        studentId: order.studentId,
        seatNo: order.student.seatNo,
        name: order.student.name,
        orderedCount: order.orderedCount,
        usedCount: used,
        remainingCount: order.orderedCount - used,
        status: order.status,
      };
    }),
  );
});

/* ---------- 급식 미운영일 ---------- */

mealsRouter.post('/service-days', requireRole('ADMIN'), async (req, res) => {
  const body = z
    .object({
      date: z.string(),
      mealType: mealTypeSchema,
      operating: z.boolean().default(false),
      note: z.string().optional(),
    })
    .parse(req.body);

  const date = parseDateOnly(body.date, 'date');
  const data = { date, mealType: body.mealType, operating: body.operating, note: body.note };

  const day = await prisma.mealServiceDay.upsert({
    where: { date_mealType: { date, mealType: body.mealType } },
    create: data,
    update: data,
  });

  res.status(201).json(day);
});
