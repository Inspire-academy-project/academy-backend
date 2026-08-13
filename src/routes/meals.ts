import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parseDateOnly } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireOwnStudentId, requireRole } from '../middleware/auth.js';

export const mealsRouter = Router();

mealsRouter.use(requireAuth);

const UNIT_PRICE = 7_500;

const mealTypeSchema = z.enum(['LUNCH', 'DINNER']);

const studentSelect = {
  id: true,
  seatNo: true,
  name: true,
  gender: true,
} as const;

/** 학원은 한국 시간으로 돌아간다. 오늘 날짜를 KST 기준으로 구한다. */
function todayInKst(): Date {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
}

async function assertMealOperating(date: Date, mealType: 'LUNCH' | 'DINNER') {
  const day = await prisma.mealServiceDay.findUnique({
    where: { date_mealType: { date, mealType } },
  });
  if (day && !day.operating) {
    throw new HttpError(400, `그날은 급식을 운영하지 않습니다.${day.note ? ` (${day.note})` : ''}`);
  }
}

/* ---------- 신청 (전날까지 취소 가능) ---------- */

const reserveSchema = z.object({
  studentId: z.number().int().optional(),
  dates: z.array(z.string()).min(1).max(62),
  mealType: mealTypeSchema,
});

/** 여러 날짜를 한 번에 신청한다. 학생은 본인 것만, 관리자는 studentId를 지정할 수 있다. */
mealsRouter.post('/reservations', async (req, res) => {
  const body = reserveSchema.parse(req.body);

  const isStaff = req.user!.role !== 'STUDENT';
  const studentId = isStaff && body.studentId ? body.studentId : await requireOwnStudentId(req);

  const today = todayInKst();
  const rows = [];

  for (const raw of body.dates) {
    const date = parseDateOnly(raw, 'dates');
    if (date < today) {
      throw new HttpError(400, `지난 날짜는 신청할 수 없습니다: ${raw}`);
    }
    await assertMealOperating(date, body.mealType);
    rows.push({ studentId, date, mealType: body.mealType, status: 'RESERVED' as const });
  }

  await prisma.$transaction(
    rows.map((row) =>
      prisma.mealReservation.upsert({
        where: {
          studentId_date_mealType: {
            studentId: row.studentId,
            date: row.date,
            mealType: row.mealType,
          },
        },
        create: row,
        update: { status: 'RESERVED', cancelledAt: null },
      }),
    ),
  );

  res.status(201).json({ studentId, mealType: body.mealType, count: rows.length });
});

const cancelSchema = z.object({
  studentId: z.number().int().optional(),
  date: z.string(),
  mealType: mealTypeSchema,
});

/** 취소는 전날까지만 가능하다. 당일에는 이미 조리가 들어가므로 막는다. */
mealsRouter.post('/reservations/cancel', async (req, res) => {
  const body = cancelSchema.parse(req.body);

  const isStaff = req.user!.role !== 'STUDENT';
  const studentId = isStaff && body.studentId ? body.studentId : await requireOwnStudentId(req);

  const date = parseDateOnly(body.date, 'date');
  const today = todayInKst();

  if (date <= today && !isStaff) {
    throw new HttpError(400, '취소는 전날까지만 가능합니다. 당일 취소는 학원에 문의하세요.');
  }

  const reservation = await prisma.mealReservation.findUnique({
    where: { studentId_date_mealType: { studentId, date, mealType: body.mealType } },
  });
  if (!reservation || reservation.status === 'CANCELLED') {
    throw new HttpError(404, '취소할 신청 내역이 없습니다.');
  }

  const updated = await prisma.mealReservation.update({
    where: { id: reservation.id },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });

  res.json(updated);
});

/** 내 신청 현황 (학생용 달력) */
mealsRouter.get('/reservations/me', async (req, res) => {
  const studentId = await requireOwnStudentId(req);
  const query = z.object({ from: z.string(), to: z.string() }).parse(req.query);

  const rows = await prisma.mealReservation.findMany({
    where: {
      studentId,
      date: { gte: parseDateOnly(query.from, 'from'), lte: parseDateOnly(query.to, 'to') },
    },
    orderBy: [{ date: 'asc' }, { mealType: 'asc' }],
  });

  res.json(rows);
});

/** 그날 준비할 급식 수량 — 주방에 넘길 숫자. */
mealsRouter.get('/reservations', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const query = z.object({ date: z.string(), mealType: mealTypeSchema }).parse(req.query);
  const date = parseDateOnly(query.date, 'date');

  const rows = await prisma.mealReservation.findMany({
    where: { date, mealType: query.mealType, status: 'RESERVED' },
    include: { student: { select: studentSelect } },
    orderBy: { student: { seatNo: 'asc' } },
  });

  res.json({ date: query.date, mealType: query.mealType, count: rows.length, items: rows });
});

/* ---------- 수령 체크 (급식수령표) ---------- */

/** 신청한 학생만 나오는 수령표. 종이로 O 표시하던 것을 대체한다. */
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

  const [reservations, records] = await Promise.all([
    prisma.mealReservation.findMany({
      where: { date, mealType: query.mealType, status: 'RESERVED' },
      include: { student: { select: studentSelect } },
      orderBy: { student: { seatNo: 'asc' } },
    }),
    prisma.mealRecord.findMany({
      where: { date, mealType: query.mealType, received: true },
      select: { studentId: true },
    }),
  ]);

  const receivedIds = new Set(records.map((row) => row.studentId));

  res.json({
    operating: true,
    reservedCount: reservations.length,
    receivedCount: receivedIds.size,
    items: reservations.map((row) => ({
      studentId: row.studentId,
      seatNo: row.student.seatNo,
      name: row.student.name,
      received: receivedIds.has(row.studentId),
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

  if (!body.received) {
    await prisma.mealRecord.deleteMany({
      where: { studentId: body.studentId, date, mealType: body.mealType },
    });
    res.json({ studentId: body.studentId, date: body.date, received: false });
    return;
  }

  const record = await prisma.mealRecord.upsert({
    where: {
      studentId_date_mealType: { studentId: body.studentId, date, mealType: body.mealType },
    },
    create: { studentId: body.studentId, date, mealType: body.mealType, received: true },
    update: { received: true },
  });

  res.status(201).json(record);
});

/* ---------- 월별 후불 정산 ---------- */

/** 실제 수령 횟수를 집계해 청구액을 만든다. 이미 결제된 건은 건드리지 않는다. */
mealsRouter.post('/settlements/generate', requireRole('ADMIN'), async (req, res) => {
  const body = z
    .object({
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      mealType: mealTypeSchema,
      unitPrice: z.number().int().positive().default(UNIT_PRICE),
    })
    .parse(req.body);

  const from = new Date(Date.UTC(body.year, body.month - 1, 1));
  const to = new Date(Date.UTC(body.year, body.month, 0));

  const grouped = await prisma.mealRecord.groupBy({
    by: ['studentId'],
    where: { date: { gte: from, lte: to }, mealType: body.mealType, received: true },
    _count: { _all: true },
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of grouped) {
    const servedCount = row._count._all;
    const key = {
      studentId_year_month_mealType: {
        studentId: row.studentId,
        year: body.year,
        month: body.month,
        mealType: body.mealType,
      },
    };

    const existing = await prisma.mealSettlement.findUnique({ where: key });
    if (existing && (existing.status === 'PAID' || existing.status === 'EXEMPT')) {
      skipped += 1;
      continue;
    }

    const data = {
      studentId: row.studentId,
      year: body.year,
      month: body.month,
      mealType: body.mealType,
      servedCount,
      unitPrice: body.unitPrice,
      amount: servedCount * body.unitPrice,
    };

    await prisma.mealSettlement.upsert({ where: key, create: data, update: data });
    existing ? (updated += 1) : (created += 1);
  }

  res.status(201).json({
    year: body.year,
    month: body.month,
    mealType: body.mealType,
    unitPrice: body.unitPrice,
    created,
    updated,
    skippedPaid: skipped,
  });
});

mealsRouter.get('/settlements', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const query = z
    .object({
      year: z.coerce.number().int(),
      month: z.coerce.number().int().min(1).max(12),
      mealType: mealTypeSchema.optional(),
      status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'EXEMPT']).optional(),
    })
    .parse(req.query);

  const rows = await prisma.mealSettlement.findMany({
    where: {
      year: query.year,
      month: query.month,
      mealType: query.mealType,
      status: query.status,
    },
    include: { student: { select: studentSelect } },
    orderBy: [{ mealType: 'asc' }, { student: { seatNo: 'asc' } }],
  });

  const summary = rows.reduce(
    (acc, row) => {
      acc.totalServed += row.servedCount;
      acc.totalAmount += row.amount;
      if (row.status === 'UNPAID' || row.status === 'PARTIAL') {
        acc.unpaidCount += 1;
        acc.unpaidAmount += row.amount;
      }
      return acc;
    },
    { totalServed: 0, totalAmount: 0, unpaidCount: 0, unpaidAmount: 0 },
  );

  res.json({ summary, items: rows });
});

mealsRouter.get('/settlements/me', async (req, res) => {
  const studentId = await requireOwnStudentId(req);

  const rows = await prisma.mealSettlement.findMany({
    where: { studentId },
    orderBy: [{ year: 'desc' }, { month: 'desc' }, { mealType: 'asc' }],
  });

  res.json(rows);
});

mealsRouter.patch('/settlements/:id', requireRole('ADMIN'), async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const body = z
    .object({
      status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'EXEMPT']).optional(),
      method: z.string().nullish(),
      amount: z.number().int().min(0).optional(),
      memo: z.string().nullish(),
    })
    .parse(req.body);

  const settlement = await prisma.mealSettlement.findUnique({ where: { id } });
  if (!settlement) {
    throw new HttpError(404, '급식 정산 내역을 찾을 수 없습니다.');
  }

  const status = body.status ?? settlement.status;

  const updated = await prisma.mealSettlement.update({
    where: { id },
    data: {
      status,
      amount: body.amount ?? settlement.amount,
      method: body.method === undefined ? undefined : body.method,
      memo: body.memo === undefined ? undefined : body.memo,
      paidAt: status === 'PAID' ? (settlement.paidAt ?? new Date()) : null,
    },
    include: { student: { select: studentSelect } },
  });

  res.json(updated);
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
