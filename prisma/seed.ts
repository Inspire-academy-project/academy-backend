import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';

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
    { email: 'student1@academy.kr', name: '이하늘', className: '재수 A반' },
    { email: 'student2@academy.kr', name: '박서준', className: '재수 A반' },
    { email: 'student3@academy.kr', name: '최민지', className: '재수 B반' },
  ];

  for (const sample of samples) {
    const user = await prisma.user.upsert({
      where: { email: sample.email },
      update: {},
      create: {
        email: sample.email,
        password,
        name: sample.name,
        role: 'STUDENT',
        student: { create: { className: sample.className } },
      },
      include: { student: true },
    });

    if (!user.student) continue;

    await prisma.payment.upsert({
      where: { studentId_year_month: { studentId: user.student.id, year: 2026, month: 8 } },
      update: {},
      create: {
        studentId: user.student.id,
        year: 2026,
        month: 8,
        amount: 850_000,
        dueDate: new Date('2026-08-05T00:00:00.000Z'),
      },
    });

    await prisma.attendance.upsert({
      where: {
        studentId_date: {
          studentId: user.student.id,
          date: new Date('2026-08-10T00:00:00.000Z'),
        },
      },
      update: {},
      create: {
        studentId: user.student.id,
        date: new Date('2026-08-10T00:00:00.000Z'),
        status: 'PRESENT',
        checkInAt: new Date('2026-08-10T08:50:00.000Z'),
      },
    });
  }

  console.log(`시드 완료 (관리자: ${admin.email} / 비밀번호: academy1234)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
