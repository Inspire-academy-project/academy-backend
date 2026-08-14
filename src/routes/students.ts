import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parseDateOnly } from '../lib/http-error.js';
import { generateInviteCode, hashInviteCode, inviteExpiry } from '../lib/invite-code.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const studentsRouter = Router();

studentsRouter.use(requireAuth, requireRole('ADMIN', 'TEACHER'));

const listSelect = {
  id: true,
  seatNo: true,
  name: true,
  gender: true,
  course: true,
  className: true,
  phone: true,
  parentPhone: true,
  attendanceCode: true,
  tuitionTier: true,
  monthlyFee: true,
  enrolledAt: true,
  active: true,
} as const;

/**
 * 좌석번호는 퇴원하면 다른 학생이 넘겨받으므로 DB 유니크로 막을 수 없다.
 * 재원생끼리만 겹치지 않으면 되므로 여기서 검사한다.
 */
async function assertSeatAvailable(seatNo: string | null | undefined, excludeId?: number) {
  if (!seatNo) return;

  const taken = await prisma.student.findFirst({
    where: { seatNo, active: true, id: excludeId ? { not: excludeId } : undefined },
    select: { name: true },
  });
  if (taken) {
    throw new HttpError(409, `${taken.name} 학생이 쓰고 있는 좌석번호입니다: ${seatNo}`);
  }
}

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
            { seatNo: { contains: query.q, mode: 'insensitive' } },
          ]
        : undefined,
    },
    select: listSelect,
    orderBy: [{ gender: 'asc' }, { seatNo: 'asc' }, { id: 'asc' }],
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
      invites: {
        where: { usedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { expiresAt: true, createdAt: true },
      },
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

  const pending = student.invites[0];
  const { invites: _invites, ...rest } = student;

  res.json({
    ...rest,
    // 아직 안 쓴 코드가 있는지만 알려준다. 코드 자체는 발급할 때 한 번만 보인다.
    pendingInvite:
      pending && pending.expiresAt > new Date()
        ? { expiresAt: pending.expiresAt, createdAt: pending.createdAt }
        : null,
  });
});

/**
 * 원생을 로그인 계정과 잇기 위한 1회용 가입 코드를 만든다.
 * 원장이 학생에게 전달하면 학생이 그 코드로 가입한다.
 *
 * 출결번호로 잇지 않는 이유: 출결번호는 패드에서 공개적으로 눌리는 값이라
 * 학생끼리 서로 안다. 그걸로 가입시키면 남의 계정을 만들 수 있다.
 */
studentsRouter.post('/:id/invite', async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);

  const student = await prisma.student.findUnique({
    where: { id },
    select: { id: true, name: true, active: true, userId: true },
  });
  if (!student) {
    throw new HttpError(404, '학생을 찾을 수 없습니다.');
  }
  if (student.userId) {
    throw new HttpError(409, `${student.name} 학생은 이미 계정이 연결되어 있습니다.`);
  }
  if (!student.active) {
    throw new HttpError(409, '퇴원 처리된 원생에게는 가입 코드를 발급할 수 없습니다.');
  }

  const code = generateInviteCode();
  const expiresAt = inviteExpiry();

  // 다시 발급하면 이전 코드는 무효가 된다. 코드가 여러 개 살아 있으면
  // 어느 것을 전달했는지 알 수 없어 회수할 방법이 없어진다.
  await prisma.$transaction([
    prisma.studentInvite.deleteMany({ where: { studentId: id, usedAt: null } }),
    prisma.studentInvite.create({
      data: { studentId: id, codeHash: hashInviteCode(code), expiresAt },
    }),
  ]);

  // 원문은 이 응답에만 실린다. 저장은 해시로 하므로 다시 꺼내볼 수 없다.
  res.status(201).json({ studentId: id, name: student.name, code, expiresAt });
});

const upsertSchema = z.object({
  seatNo: z.string().min(1).optional(),
  name: z.string().min(1),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  course: z.string().optional(),
  className: z.string().optional(),
  phone: z.string().optional(),
  parentPhone: z.string().optional(),
  attendanceCode: z.string().min(2).optional(),
  tuitionTier: z.enum(['STANDARD', 'EARLY', 'RETURNING', 'REENROLLED']).optional(),
  monthlyFee: z.number().int().positive().optional(),
  enrolledAt: z.string(),
  memo: z.string().optional(),
});

studentsRouter.post('/', async (req, res) => {
  const body = upsertSchema.parse(req.body);

  await assertSeatAvailable(body.seatNo);

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

  // 좌석번호를 바꾸거나 퇴원생을 다시 재원 처리할 때 남의 자리와 겹칠 수 있다.
  if (body.seatNo !== undefined || body.active === true) {
    const current = await prisma.student.findUnique({
      where: { id },
      select: { seatNo: true },
    });
    if (!current) {
      throw new HttpError(404, '학생을 찾을 수 없습니다.');
    }
    await assertSeatAvailable(body.seatNo ?? current.seatNo, id);
  }

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
