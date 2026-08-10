import { Router } from 'express';
import { z } from 'zod';
import { parseDateOnly } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireOwnStudentId, requireRole } from '../middleware/auth.js';

export const attendanceRouter = Router();

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
      className: true,
      user: { select: { name: true } },
      attendances: { where: { date }, take: 1 },
    },
    orderBy: [{ className: 'asc' }, { id: 'asc' }],
  });

  res.json(
    students.map((student) => ({
      studentId: student.id,
      name: student.user.name,
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

attendanceRouter.post('/', requireRole('ADMIN', 'TEACHER'), async (req, res) => {
  const body = markSchema.parse(req.body);
  const date = parseDateOnly(body.date, 'date');
  const checkInAt = body.status === 'PRESENT' || body.status === 'LATE' ? new Date() : null;

  const row = await prisma.attendance.upsert({
    where: { studentId_date: { studentId: body.studentId, date } },
    create: { studentId: body.studentId, date, status: body.status, note: body.note, checkInAt },
    update: { status: body.status, note: body.note, checkInAt },
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
  const checkInAt = new Date();

  const rows = await prisma.$transaction(
    body.records.map((record) =>
      prisma.attendance.upsert({
        where: { studentId_date: { studentId: record.studentId, date } },
        create: {
          studentId: record.studentId,
          date,
          status: record.status,
          checkInAt: record.status === 'ABSENT' || record.status === 'EXCUSED' ? null : checkInAt,
        },
        update: {
          status: record.status,
          checkInAt: record.status === 'ABSENT' || record.status === 'EXCUSED' ? null : checkInAt,
        },
      }),
    ),
  );

  res.status(201).json({ count: rows.length });
});
