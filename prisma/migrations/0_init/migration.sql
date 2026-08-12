-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('TUITION', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'EXEMPT');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('LUNCH', 'DINNER');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('RESERVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" SERIAL NOT NULL,
    "seatNo" TEXT,
    "name" TEXT NOT NULL,
    "gender" "Gender",
    "course" TEXT,
    "className" TEXT,
    "phone" TEXT,
    "parentPhone" TEXT,
    "attendanceCode" TEXT,
    "enrolledAt" DATE NOT NULL,
    "leftAt" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "checkInAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPeriod" (
    "id" SERIAL NOT NULL,
    "feeType" "FeeType" NOT NULL DEFAULT 'TUITION',
    "label" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "baseAmount" INTEGER,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "proratedDays" INTEGER,
    "paidAt" TIMESTAMP(3),
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealReservation" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "mealType" "MealType" NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealSettlement" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "mealType" "MealType" NOT NULL,
    "servedCount" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paidAt" TIMESTAMP(3),
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealRecord" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "mealType" "MealType" NOT NULL,
    "received" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealServiceDay" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "mealType" "MealType" NOT NULL,
    "operating" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,

    CONSTRAINT "MealServiceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "subject" TEXT,
    "problemDate" DATE,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploaderId" INTEGER NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Student_seatNo_key" ON "Student"("seatNo");

-- CreateIndex
CREATE UNIQUE INDEX "Student_attendanceCode_key" ON "Student"("attendanceCode");

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- CreateIndex
CREATE INDEX "Student_active_gender_idx" ON "Student"("active", "gender");

-- CreateIndex
CREATE INDEX "Student_className_idx" ON "Student"("className");

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_studentId_date_key" ON "Attendance"("studentId", "date");

-- CreateIndex
CREATE INDEX "BillingPeriod_startDate_idx" ON "BillingPeriod"("startDate");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPeriod_feeType_label_key" ON "BillingPeriod"("feeType", "label");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_studentId_periodId_key" ON "Payment"("studentId", "periodId");

-- CreateIndex
CREATE INDEX "MealReservation_date_mealType_status_idx" ON "MealReservation"("date", "mealType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MealReservation_studentId_date_mealType_key" ON "MealReservation"("studentId", "date", "mealType");

-- CreateIndex
CREATE INDEX "MealSettlement_year_month_mealType_idx" ON "MealSettlement"("year", "month", "mealType");

-- CreateIndex
CREATE INDEX "MealSettlement_status_idx" ON "MealSettlement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MealSettlement_studentId_year_month_mealType_key" ON "MealSettlement"("studentId", "year", "month", "mealType");

-- CreateIndex
CREATE INDEX "MealRecord_date_mealType_idx" ON "MealRecord"("date", "mealType");

-- CreateIndex
CREATE UNIQUE INDEX "MealRecord_studentId_date_mealType_key" ON "MealRecord"("studentId", "date", "mealType");

-- CreateIndex
CREATE INDEX "MealServiceDay_date_idx" ON "MealServiceDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MealServiceDay_date_mealType_key" ON "MealServiceDay"("date", "mealType");

-- CreateIndex
CREATE INDEX "Video_problemDate_idx" ON "Video"("problemDate");

-- CreateIndex
CREATE INDEX "Video_createdAt_idx" ON "Video"("createdAt");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "BillingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealReservation" ADD CONSTRAINT "MealReservation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealSettlement" ADD CONSTRAINT "MealSettlement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealRecord" ADD CONSTRAINT "MealRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

