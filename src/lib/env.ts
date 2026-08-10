import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  UPLOAD_DIR: z.string().default('./uploads'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('환경변수 설정이 잘못되었습니다. .env 파일을 확인하세요.');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
