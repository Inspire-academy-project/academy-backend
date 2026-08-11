import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function main() {
  const password = await bcrypt.hash('academy1234', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@academy.kr' },
    update: {},
    create: { email: 'admin@academy.kr', password, name: '원장', role: 'ADMIN' },
  });

  await prisma.user.upsert({
    where: { email: 'teacher@academy.kr' },
    update: {},
    create: { email: 'teacher@academy.kr', password, name: '김강사', role: 'TEACHER' },
  });

  const samples = [
    { seatNo: 'M01', name: '이하늘', gender: 'MALE', course: '재수', enrolledAt: '2026-03-16' },
    { seatNo: 'M02', name: '박서준', gender: 'MALE', course: '재수', enrolledAt: '2026-06-18' },
    { seatNo: 'F01', name: '최민지', gender: 'FEMALE', course: '재수', enrolledAt: '2026-03-16' },
    { seatNo: 'F02', name: '권윤지', gender: 'FEMALE', course: '고3', enrolledAt: '2026-07-02' },
  ] as const;

  for (const [index, sample] of samples.entries()) {
    await prisma.student.upsert({
      where: { seatNo: sample.seatNo },
      update: {},
      create: {
        seatNo: sample.seatNo,
        name: sample.name,
        gender: sample.gender,
        course: sample.course,
        enrolledAt: d(sample.enrolledAt),
        attendanceCode: String(1001 + index),
        parentPhone: '010-0000-0000',
      },
    });
  }

  // 학원비는 달력 월이 아니라 16일~다음달 15일 주기로 청구한다.
  const tuition = await prisma.billingPeriod.upsert({
    where: { feeType_label: { feeType: 'TUITION', label: '2026년 10월' } },
    update: {},
    create: {
      feeType: 'TUITION',
      label: '2026년 10월',
      startDate: d('2026-10-16'),
      endDate: d('2026-11-15'),
      dueDate: d('2026-10-16'),
      baseAmount: 680_000,
    },
  });

  const meal = await prisma.billingPeriod.upsert({
    where: { feeType_label: { feeType: 'MEAL', label: '2026년 10월' } },
    update: {},
    create: {
      feeType: 'MEAL',
      label: '2026년 10월',
      startDate: d('2026-10-01'),
      endDate: d('2026-10-31'),
      dueDate: d('2026-10-05'),
      baseAmount: 180_000,
    },
  });

  const students = await prisma.student.findMany({ select: { id: true } });

  for (const period of [tuition, meal]) {
    await prisma.payment.createMany({
      data: students.map((student) => ({
        studentId: student.id,
        periodId: period.id,
        amount: period.baseAmount ?? 0,
      })),
      skipDuplicates: true,
    });
  }

  // 한 명은 완납 처리해 두어 미납 집계가 눈에 보이게 한다.
  const first = await prisma.payment.findFirst({ where: { periodId: tuition.id } });
  if (first) {
    await prisma.payment.update({
      where: { id: first.id },
      data: { paidAmount: first.amount, status: 'PAID', paidAt: new Date() },
    });
  }

  await prisma.attendance.createMany({
    data: students.map((student) => ({
      studentId: student.id,
      date: d('2026-08-10'),
      status: 'PRESENT' as const,
      checkInAt: new Date('2026-08-10T08:50:00.000Z'),
    })),
    skipDuplicates: true,
  });

  console.log(`시드 완료 (관리자: ${admin.email} / 비밀번호: academy1234)`);
  console.log(`학생 ${students.length}명, 청구 주기 2개(학원비·급식비) 생성`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
