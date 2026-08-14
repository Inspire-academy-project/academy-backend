import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/http-error.js';
import { hashInviteCode } from '../lib/invite-code.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, signToken } from '../middleware/auth.js';

export const authRouter = Router();

/**
 * 가입 코드를 확인해 어느 원생에게 연결된 것인지 돌려준다.
 * 코드를 아는 사람만 볼 수 있고, 학생이 남의 코드로 가입하는 사고를 막는다.
 * 코드가 URL에 남지 않도록 GET이 아니라 POST로 받는다.
 */
async function findUsableInvite(rawCode: string) {
  const invite = await prisma.studentInvite.findUnique({
    where: { codeHash: hashInviteCode(rawCode) },
    select: {
      id: true,
      expiresAt: true,
      usedAt: true,
      student: { select: { id: true, name: true, active: true, userId: true } },
    },
  });

  if (!invite) {
    throw new HttpError(400, '가입 코드가 올바르지 않습니다.');
  }
  if (invite.usedAt) {
    throw new HttpError(400, '이미 사용된 가입 코드입니다.');
  }
  if (invite.expiresAt <= new Date()) {
    throw new HttpError(400, '기한이 지난 가입 코드입니다. 학원에 다시 요청해 주세요.');
  }
  if (invite.student.userId) {
    throw new HttpError(409, '이미 계정이 연결된 원생입니다.');
  }
  if (!invite.student.active) {
    throw new HttpError(409, '퇴원 처리된 원생입니다.');
  }

  return invite;
}

const codeSchema = z.object({ code: z.string().min(4) });

authRouter.post('/invite/verify', async (req, res) => {
  const { code } = codeSchema.parse(req.body);
  const invite = await findUsableInvite(code);

  res.json({ name: invite.student.name, expiresAt: invite.expiresAt });
});

const registerSchema = codeSchema.extend({
  email: z.email(),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.'),
});

/**
 * 가입은 원장이 발급한 코드로만 된다.
 *
 * 예전에는 Student를 새로 만들었다. 그러면 명부에 있는 홍길동과 가입해서 생긴
 * 홍길동이 서로 다른 사람이 되어, 출결·납부는 앞쪽에 쌓이는데 학생은 뒤쪽으로
 * 로그인하니 자기 기록이 하나도 안 보였다.
 * 이제는 코드가 가리키는 기존 원생에 계정을 잇는다.
 */
authRouter.post('/register', async (req, res) => {
  const body = registerSchema.parse(req.body);
  const invite = await findUsableInvite(body.code);

  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) {
    throw new HttpError(409, '이미 가입된 이메일입니다.');
  }

  const password = await bcrypt.hash(body.password, 10);

  // 계정 생성·연결·코드 소모는 하나로 묶는다. 중간에 끊기면 코드만 쓰이고
  // 계정은 없는 상태가 되어 학생이 다시 가입할 수 없다.
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: body.email,
        password,
        name: invite.student.name,
        role: 'STUDENT',
      },
      select: { id: true, email: true, name: true, role: true },
    });

    await tx.student.update({
      where: { id: invite.student.id },
      data: { userId: created.id },
    });

    await tx.studentInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });

    return created;
  });

  // 토큰에는 신원 확인에 필요한 값만 담는다. 토큰은 브라우저에 그대로 저장되므로
  // 실명을 넣어 둘 이유가 없다. 로그인 쪽과도 형태를 맞춘다.
  const token = signToken({ id: user.id, email: user.email, role: user.role });

  res.status(201).json({ user, token });
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

authRouter.post('/login', async (req, res) => {
  const body = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { email: body.email },
    include: { student: { select: { active: true } } },
  });
  if (!user || !(await bcrypt.compare(body.password, user.password))) {
    throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  // 퇴원하면 로그인을 막는다. 기록은 원장·강사 화면에 그대로 남아 있다.
  if (user.role === 'STUDENT' && user.student && !user.student.active) {
    throw new HttpError(403, '퇴원 처리된 계정입니다. 학원에 문의해 주세요.');
  }

  const payload = { id: user.id, email: user.email, role: user.role };
  res.json({ user: { ...payload, name: user.name }, token: signToken(payload) });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      student: { select: { id: true, seatNo: true, className: true, active: true } },
    },
  });
  if (!user) {
    throw new HttpError(404, '사용자를 찾을 수 없습니다.');
  }
  res.json(user);
});
