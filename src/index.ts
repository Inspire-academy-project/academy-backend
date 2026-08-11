import cors from 'cors';
import express from 'express';
import { env } from './lib/env.js';
import { errorHandler, notFound } from './middleware/error.js';
import { attendanceRouter } from './routes/attendance.js';
import { authRouter } from './routes/auth.js';
import { mealsRouter } from './routes/meals.js';
import { paymentsRouter } from './routes/payments.js';
import { studentsRouter } from './routes/students.js';
import { videosRouter } from './routes/videos.js';

const app = express();

app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/students', studentsRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/meals', mealsRouter);
app.use('/api/videos', videosRouter);

app.use(notFound);
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`API 서버 실행 중 → http://localhost:${env.PORT}`);
});
