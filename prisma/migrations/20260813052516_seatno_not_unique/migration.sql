-- DropIndex
DROP INDEX "Student_seatNo_key";

-- CreateIndex
CREATE INDEX "Student_seatNo_idx" ON "Student"("seatNo");
