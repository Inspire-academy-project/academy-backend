# academy-backend

재수 학원 관리 웹 서비스의 API 서버. 출결 관리 · 일일4제 영상 · 학원비 납부 관리.

Express 5 + Prisma 7 + PostgreSQL + JWT

> 프론트엔드는 별도 저장소: [academy-frontend](https://github.com/Inspire-academy-project/academy-frontend)

## 1. 준비물

- Node.js 20 이상
- pnpm — 없으면 `npm install -g pnpm`
- PostgreSQL — 로컬 설치 대신 [Supabase](https://supabase.com) 또는 [Neon](https://neon.tech) 무료 플랜 추천

## 2. 실행

```bash
pnpm install
cp .env.example .env
```

`.env`에서 `DATABASE_URL`을 실제 DB 주소로, `JWT_SECRET`을 임의의 긴 문자열로 바꾼다.

```bash
pnpm db:push    # 스키마를 DB에 반영 (첫 실행)
pnpm db:seed    # 테스트 계정/데이터 생성
pnpm dev        # http://localhost:4000
```

시드 계정 — 비밀번호는 모두 `academy1234`

| 이메일                | 역할          |
| --------------------- | ------------- |
| admin@academy.kr      | 원장(ADMIN)   |
| teacher@academy.kr    | 강사(TEACHER) |
| student1~3@academy.kr | 학생(STUDENT) |

## 3. API 목록

`/health`를 제외한 모든 경로는 `Authorization: Bearer <token>` 헤더가 필요하다.

### 인증 `/api/auth`

| 메서드 | 경로        | 권한   | 설명                                     |
| ------ | ----------- | ------ | ---------------------------------------- |
| POST   | `/register` | 공개   | 학생 회원가입 (User + Student 동시 생성) |
| POST   | `/login`    | 공개   | 로그인, JWT 발급 (7일 유효)              |
| GET    | `/me`       | 로그인 | 내 정보 조회                             |

### 학생 `/api/students`

| 메서드 | 경로   | 권한           | 설명                                              |
| ------ | ------ | -------------- | ------------------------------------------------- |
| GET    | `/`    | ADMIN, TEACHER | 목록 (`?className=`, `?active=`, `?q=` 이름 검색) |
| GET    | `/:id` | ADMIN, TEACHER | 상세 + 최근 출결 30건/납부 12건                   |
| POST   | `/`    | ADMIN, TEACHER | 학생 등록                                         |
| PATCH  | `/:id` | ADMIN, TEACHER | 반·연락처·재원 여부 수정                          |

### 출결 `/api/attendance`

| 메서드 | 경로                  | 권한           | 설명                               |
| ------ | --------------------- | -------------- | ---------------------------------- |
| GET    | `/me`                 | 학생           | 내 출결 (`?from=&to=`)             |
| GET    | `/?date=YYYY-MM-DD`   | ADMIN, TEACHER | 그날 전체 명단 + 출결 상태         |
| GET    | `/student/:studentId` | ADMIN, TEACHER | 특정 학생 출결                     |
| POST   | `/`                   | ADMIN, TEACHER | 1명 출결 입력 (같은 날짜면 덮어씀) |
| POST   | `/bulk`               | ADMIN, TEACHER | 여러 명 한 번에 입력               |

상태값: `PRESENT`(출석) `LATE`(지각) `ABSENT`(결석) `EXCUSED`(인정결석)

### 납부 `/api/payments`

| 메서드 | 경로      | 권한  | 설명                                       |
| ------ | --------- | ----- | ------------------------------------------ |
| GET    | `/me`     | 학생  | 내 납부 내역                               |
| GET    | `/`       | ADMIN | 전체 (`?status=&year=&month=&className=`)  |
| GET    | `/unpaid` | ADMIN | **미납 목록 + 미납 총액** (엑셀 대체 핵심) |
| POST   | `/`       | ADMIN | 청구 생성 (학생·연·월당 1건)               |
| PATCH  | `/:id`    | ADMIN | 입금액 기록 → 상태 자동 계산               |

상태값: `UNPAID`(미납) `PARTIAL`(부분납) `PAID`(완납) — `paidAmount`에 따라 서버가 자동 판정

### 영상 `/api/videos`

| 메서드 | 경로          | 권한           | 설명                                                          |
| ------ | ------------- | -------------- | ------------------------------------------------------------- |
| GET    | `/`           | 로그인         | 목록 (`?date=&subject=`). 학생은 공개된 것만                  |
| POST   | `/`           | ADMIN, TEACHER | 업로드 (`multipart/form-data`, 파일 필드명 `video`, 최대 1GB) |
| GET    | `/:id/stream` | 로그인         | 스트리밍 (Range 지원 → 브라우저에서 구간 이동 가능)           |
| PATCH  | `/:id`        | ADMIN, TEACHER | 제목·공개 여부 수정                                           |

## 4. 데이터 모델

```
User ──1:1── Student ──1:N── Attendance   (studentId + date 유니크)
 │                     └──1:N── Payment    (studentId + year + month 유니크)
 └──1:N── Video
```

- **User** 는 로그인 계정. `role` 로 원장/강사/학생 구분
- **Student** 는 학생에게만 붙는 학원 정보(반, 학부모 연락처, 재원 여부)
- **유니크 제약** 덕분에 같은 날 출결 중복 입력, 같은 달 학원비 중복 청구가 DB 차원에서 막힌다

## 5. 폴더 구조

```
src/
├── index.ts           서버 진입점, 라우터 등록
├── lib/
│   ├── env.ts         환경변수 검증 (잘못되면 부팅 시 즉시 종료)
│   ├── prisma.ts      Prisma 클라이언트 (pg 어댑터)
│   └── http-error.ts  에러 클래스, 날짜 파싱
├── middleware/
│   ├── auth.ts        JWT 검증, 역할별 권한 가드
│   └── error.ts       전역 에러 핸들러
└── routes/            auth · students · attendance · payments · videos
```

## 6. 자주 쓰는 명령어

| 명령어            | 설명                                       |
| ----------------- | ------------------------------------------ |
| `pnpm dev`        | 개발 서버 (파일 변경 시 자동 재시작)       |
| `pnpm db:push`    | 스키마 변경을 DB에 즉시 반영 (개발 초기용) |
| `pnpm db:migrate` | 마이그레이션 파일로 관리 (실제 운영용)     |
| `pnpm db:studio`  | 브라우저에서 DB 데이터 확인/편집           |
| `pnpm typecheck`  | 타입 검사                                  |

## 7. 알아둘 점

- **Prisma 7부터** DB 주소가 `schema.prisma`가 아니라 `prisma.config.ts`에 있다. 인터넷 자료 대부분은 6버전 기준이라 `url = env("DATABASE_URL")`을 스키마에 쓰라고 하는데, 7에서는 에러가 난다.
- 영상은 현재 서버 로컬 `uploads/` 폴더에 저장된다. 실제 배포 시에는 AWS S3 같은 외부 스토리지로 옮겨야 한다.
- 비밀번호는 bcrypt 해시로만 저장되며 평문은 어디에도 남지 않는다.
- `src/generated/`는 Prisma가 자동 생성하는 코드라 커밋하지 않는다. `pnpm install` 후 `pnpm db:generate`로 다시 만든다.
