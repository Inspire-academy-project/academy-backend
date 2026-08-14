import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parseDateOnly } from '../lib/http-error.js';
import { formatKstTime, kstToday } from '../lib/kst.js';
import { prisma } from '../lib/prisma.js';
import {
  requireAuth,
  requireKioskDevice,
  requireOwnStudentId,
  requireRole,
} from '../middleware/auth.js';

export const attendanceRouter = Router();

const kioskSchema = z.object({ code: z.string().trim().min(2).max(20) });

/**
 * 패드에 토큰을 등록할 때 값이 맞는지 확인하는 용도.
 * 학생이 번호를 누르고 나서야 틀린 걸 알게 되면 곤란하다.
 */
attendanceRouter.get('/kiosk', requireKioskDevice, (_req, res) => {
  res.json({ ok: true });
});

/**
 * 출결 패드 전용. 학생이 번호를 누르면 시각만 남기고 지각·결석 판정은 하지 않는다.
 * 로그인이 아니라 기기 토큰으로 확인하므로 requireAuth 앞에 둔다.
 */
attendanceRouter.post('/kiosk', requireKioskDevice, async (req, res) => {
  const { code } = kioskSchema.parse(req.body);

  const student = await prisma.student.findFirst({
    where: { attendanceCode: code, active: true },
    select: { id: true, name: true },
  });
  if (!student) {
    throw new HttpError(404, '등록되지 않은 번호입니다. 다시 확인해 주세요.');
  }

  const date = kstToday();
  const now = new Date();
  const key = { studentId_date: { studentId: student.id, date } };

  const existing = await prisma.attendance.findUnique({
    where: key,
    select: { checkInAt: true },
  });

  // 그날 첫 입력이면 등원, 그 뒤로는 하원 시각만 갱신한다.
  // 실수로 여러 번 눌러도 등원 시각은 그대로 남는다.
  const action = existing?.checkInAt ? 'OUT' : 'IN';

  await prisma.attendance.upsert({
    where: key,
    create: { studentId: student.id, date, checkInAt: now },
    update: action === 'IN' ? { checkInAt: now } : { checkOutAt: now },
  });

  res.json({ name: student.name, action, at: formatKstTime(now) });
});

attendanceRouter.use(requireAuth);

const statusSchema = z.enum(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED']);

const rangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

function rangeFilter(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    gte: from ? parseDateOnly(from, 'from') : undefined,
    lte: to ? parseDateOnly(to, 'to') : undefined,
  };
}

attendanceRouter.get('/me', async (req, res) => {
  const studentId = await requireOwnStudentId(req);
  const { from, to } = rangeSchema.parse(req.query);

  const rows = await prisma.attendance.findMany({
    where: { studentId, date: rangeFilter(from, to) },
    orderBy: { date: 'desc' },
  });

  res.json(rows);
});

attendanceRouter.get('/', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const query = z.object({ date: z.string(), className: z.string().optional() }).parse(req.query);
  const date = parseDateOnly(query.date, 'date');

  const students = await prisma.student.findMany({
    where: { active: true, className: query.className },
    select: {
      id: true,
      seatNo: true,
      name: true,
      gender: true,
      className: true,
      attendances: { where: { date }, take: 1 },
    },
    orderBy: [{ gender: 'asc' }, { seatNo: 'asc' }, { id: 'asc' }],
  });

  res.json(
    students.map((student) => ({
      studentId: student.id,
      seatNo: student.seatNo,
      name: student.name,
      gender: student.gender,
      className: student.className,
      attendance: student.attendances[0] ?? null,
    })),
  );
});

attendanceRouter.get('/student/:studentId', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const studentId = z.coerce.number().int().parse(req.params.studentId);
  const { from, to } = rangeSchema.parse(req.query);

  const rows = await prisma.attendance.findMany({
    where: { studentId, date: rangeFilter(from, to) },
    orderBy: { date: 'desc' },
  });

  res.json(rows);
});

const markSchema = z.object({
  studentId: z.number().int(),
  date: z.string(),
  status: statusSchema,
  note: z.string().optional(),
});

/**
 * 시각은 키오스크가 남기고 여기서는 판정만 바꾼다.
 * 버튼을 누른 시각을 등원 시각으로 적으면 학생이 실제로 찍은 기록이 지워진다.
 */
attendanceRouter.post('/', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const body = markSchema.parse(req.body);
  const date = parseDateOnly(body.date, 'date');

  const row = await prisma.attendance.upsert({
    where: { studentId_date: { studentId: body.studentId, date } },
    create: { studentId: body.studentId, date, status: body.status, note: body.note },
    update: { status: body.status, note: body.note },
  });

  res.status(201).json(row);
});

const bulkSchema = z.object({
  date: z.string(),
  records: z.array(z.object({ studentId: z.number().int(), status: statusSchema })).min(1),
});

attendanceRouter.post('/bulk', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const body = bulkSchema.parse(req.body);
  const date = parseDateOnly(body.date, 'date');

  const rows = await prisma.$transaction(
    body.records.map((record) =>
      prisma.attendance.upsert({
        where: { studentId_date: { studentId: record.studentId, date } },
        create: { studentId: record.studentId, date, status: record.status },
        update: { status: record.status },
      }),
    ),
  );

  res.status(201).json({ count: rows.length });
});
