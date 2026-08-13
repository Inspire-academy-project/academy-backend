import 'dotenv/config';
import { z } from 'zod';

/**
 * 배포 환경에서는 변수를 만들어 두고 값을 비워두는 일이 흔하다.
 * 빈 문자열은 "설정하지 않음"으로 보고 기본값이 적용되게 한다.
 * 이렇게 하지 않으면 PORT가 0(무작위 포트)이 되는 식으로 조용히 잘못 뜬다.
 */
const blankAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema);

const schema = z.object({
  DATABASE_URL: blankAsUndefined(z.string().min(1, 'DATABASE_URL이 비어 있습니다.')),
  JWT_SECRET: blankAsUndefined(
    z.string().min(16, 'JWT_SECRET은 16자 이상이어야 합니다. 배포용은 새로 생성하세요.'),
  ),
  PORT: blankAsUndefined(z.coerce.number().int().positive().default(4000)),
  CORS_ORIGIN: blankAsUndefined(z.string().min(1).default('http://localhost:3000')),
  UPLOAD_DIR: blankAsUndefined(z.string().min(1).default('./uploads')),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('환경변수 설정이 잘못되었습니다. .env 또는 배포 환경의 Variables를 확인하세요.');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
