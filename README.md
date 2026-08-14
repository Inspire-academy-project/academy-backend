# academy-backend

재수 학원 관리 웹 서비스의 API 서버. 출결 관리 · 일일4제 영상 · 학원비/급식비 관리.

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
pnpm db:migrate # 마이그레이션 적용 (첫 실행)
pnpm db:seed    # 테스트 계정/데이터 생성
pnpm dev        # http://localhost:4000
```

Supabase를 쓴다면 **Session pooler** 주소(5432 포트)를 넣는다.
Transaction pooler(6543)는 마이그레이션이 동작하지 않는다.

시드 계정 — 비밀번호는 모두 `academy1234`

| 이메일             | 역할          |
| ------------------ | ------------- |
| admin@academy.kr   | 원장(ADMIN)   |
| teacher@academy.kr | 강사(TEACHER) |

원생은 로그인 계정 없이 등록된다. 학생용 화면(P2)을 붙일 때 계정을 연결한다.

## 3. API 목록

`/health`와 출결 키오스크를 제외한 모든 경로는 `Authorization: Bearer <token>` 헤더가 필요하다.
키오스크는 패드가 로그인을 할 수 없어 기기 토큰을 대신 쓴다(아래 참고).

### 인증 `/api/auth`

| 메서드 | 경로        | 권한   | 설명                        |
| ------ | ----------- | ------ | --------------------------- |
| POST   | `/register` | 공개   | 학생 회원가입               |
| POST   | `/login`    | 공개   | 로그인, JWT 발급 (7일 유효) |
| GET    | `/me`       | 로그인 | 내 정보 조회                |

### 학생 `/api/students`

| 메서드 | 경로   | 권한           | 설명                                           |
| ------ | ------ | -------------- | ---------------------------------------------- |
| GET    | `/`    | ADMIN, TEACHER | 목록 (`?gender=&course=&active=&q=` 이름/번호) |
| GET    | `/:id` | ADMIN, TEACHER | 상세 + 최근 출결 30건/납부 24건                |
| POST   | `/`    | ADMIN, TEACHER | 원생 등록                                      |
| PATCH  | `/:id` | ADMIN, TEACHER | 좌석번호·연락처·재원 여부 수정                 |

### 출결 `/api/attendance`

| 메서드 | 경로                  | 권한           | 설명                               |
| ------ | --------------------- | -------------- | ---------------------------------- |
| GET    | `/me`                 | 학생           | 내 출결 (`?from=&to=`)             |
| GET    | `/?date=YYYY-MM-DD`   | ADMIN, TEACHER | 그날 전체 명단 + 출결 상태         |
| GET    | `/student/:studentId` | ADMIN, TEACHER | 특정 학생 출결                     |
| POST   | `/`                   | ADMIN, TEACHER | 1명 출결 입력 (같은 날짜면 덮어씀) |
| POST   | `/bulk`               | ADMIN, TEACHER | 여러 명 한 번에 입력               |
| GET    | `/kiosk`              | 출결 패드      | 기기 토큰이 맞는지 확인            |
| POST   | `/kiosk`              | 출결 패드      | 번호를 받아 등원·하원 시각 기록    |

상태값: `PRESENT`(출석) `LATE`(지각) `ABSENT`(결석) `EXCUSED`(인정결석)

#### 시각과 판정은 따로 간다

`checkInAt`(등원) · `checkOutAt`(하원)은 **키오스크만** 쓴다.
상태값은 **사람만** 쓴다. 지각 기준이 상황마다 달라 코드로 정하지 않고,
원장·강사가 시각을 보고 판단한다.

그래서 관리자가 출석·지각 버튼을 눌러도 시각은 그대로 남는다.
버튼을 누른 시각을 등원 시각으로 적으면 학생이 실제로 찍은 기록이 지워지기 때문이다.

#### 키오스크 `POST /api/attendance/kiosk`

패드는 로그인을 할 수 없으므로 기기에 심어 둔 토큰으로 확인한다.
서버 환경변수 `KIOSK_TOKEN`과 대조하며, 비워 두면 이 경로 자체가 닫힌다(503).

```
POST /api/attendance/kiosk
X-Kiosk-Token: <KIOSK_TOKEN>
{ "code": "1001" }

→ { "name": "홍길동", "action": "IN", "at": "08:52" }
```

패드에 토큰을 등록할 때는 `GET /api/attendance/kiosk`로 값이 맞는지 먼저 확인한다.
학생이 번호를 누르고 나서야 기기 등록이 잘못된 걸 알게 되면 곤란하다.

그날 첫 입력이면 `IN`, 그 뒤로는 `OUT`으로 하원 시각만 갱신한다.
실수로 여러 번 눌러도 등원 시각은 덮이지 않는다.
이름을 돌려주는 것은 번호를 잘못 눌렀을 때 학생이 바로 알아채게 하기 위함이다.

| 응답  | 뜻                                       |
| ----- | ---------------------------------------- |
| `401` | 토큰이 없거나 다름 — 등록되지 않은 기기  |
| `404` | 없는 번호이거나 퇴원 처리된 원생         |
| `503` | 서버에 `KIOSK_TOKEN`이 설정되지 않음     |

### 학원비 `/api/payments`

학원비는 달력 월이 아니라 **16일~다음달 15일** 주기로 청구한다(예: "3월" = 3/16~4/15).
그래서 연·월이 아니라 시작일·종료일을 가진 `BillingPeriod`로 관리한다.

| 메서드 | 경로                    | 권한           | 설명                                         |
| ------ | ----------------------- | -------------- | -------------------------------------------- |
| GET    | `/periods`              | ADMIN, TEACHER | 청구 주기 목록                               |
| POST   | `/periods`              | ADMIN          | 청구 주기 생성 (시작일·종료일·기준금액)      |
| POST   | `/periods/:id/generate` | ADMIN          | **재원생 전체 청구서 일괄 생성 + 일할계산**  |
| GET    | `/me`                   | 학생           | 내 납부 내역                                 |
| GET    | `/`                     | ADMIN          | 전체 (`?periodId=&feeType=&status=&gender=`) |
| GET    | `/unpaid`               | ADMIN          | **미납 목록 + 미납 총액**                    |
| POST   | `/`                     | ADMIN          | 청구 1건 생성                                |
| PATCH  | `/:id`                  | ADMIN          | 입금액 기록 → 상태 자동 계산                 |

상태값: `UNPAID`(미납) `PARTIAL`(부분납) `PAID`(완납) `EXEMPT`(면제)

`/unpaid`는 **납부기한이 지난 건만** 집계한다. 아직 도래하지 않은 달까지 보려면
`?includeUpcoming=true`를 붙인다.

### 급식 `/api/meals`

급식은 학원비와 결제 방식이 다르다. 전원이 먹지 않고, **후불제**로 운영된다.
날짜별로 신청하고 **전날까지 취소**할 수 있으며, 월말에 실제 수령한 횟수만큼
정산해 청구한다 (한 끼 7,500원). 점심·저녁을 따로 신청한다.

| 메서드 | 경로                    | 권한           | 설명                                                   |
| ------ | ----------------------- | -------------- | ------------------------------------------------------ |
| POST   | `/reservations`         | 로그인         | 신청 (여러 날짜 한 번에). 학생은 본인 것만             |
| POST   | `/reservations/cancel`  | 로그인         | 취소. 학생은 **전날까지만**, 관리자는 당일도 가능      |
| GET    | `/reservations/me`      | 학생           | 내 신청 현황 (`?from=&to=`)                            |
| GET    | `/reservations`         | ADMIN, TEACHER | **그날 준비할 수량** (주방 전달용)                     |
| GET    | `/records`              | ADMIN, TEACHER | **급식수령표** — 신청자 명단 + 수령 여부               |
| POST   | `/records`              | ADMIN, TEACHER | 수령 체크 (`received:false`면 취소)                    |
| POST   | `/settlements/generate` | ADMIN          | **월별 정산 생성** (실제 수령 × 단가). 결제분은 건너뜀 |
| GET    | `/settlements`          | ADMIN, TEACHER | 정산 현황 + 미납 합계 (`?year=&month=`)                |
| GET    | `/settlements/me`       | 학생           | 내 급식비 내역                                         |
| PATCH  | `/settlements/:id`      | ADMIN          | 결제 처리 (카드/계좌)                                  |
| POST   | `/service-days`         | ADMIN          | 급식 미운영일 지정 (공휴일 등)                         |

`mealType`은 `LUNCH`(점심) 또는 `DINNER`(저녁).

### 영상 `/api/videos`

| 메서드 | 경로          | 권한           | 설명                                                          |
| ------ | ------------- | -------------- | ------------------------------------------------------------- |
| GET    | `/`           | 로그인         | 목록 (`?date=&subject=`). 학생은 공개된 것만                  |
| POST   | `/`           | ADMIN, TEACHER | 업로드 (`multipart/form-data`, 파일 필드명 `video`, 최대 1GB) |
| GET    | `/:id/stream` | 로그인         | 스트리밍 (Range 지원 → 브라우저에서 구간 이동 가능)           |
| PATCH  | `/:id`        | ADMIN, TEACHER | 제목·공개 여부 수정                                           |

## 4. 데이터 모델

```
User (로그인 계정)
 ├──0:1── Student ──1:N── Attendance      (studentId + date 유니크)
 │           ├──1:N── Payment             (studentId + periodId 유니크)
 │           ├──1:N── MealReservation     (신청, 전날까지 취소 가능)
 │           ├──1:N── MealRecord          (실제 수령)
 │           └──1:N── MealSettlement      (월별 후불 정산)
 └──1:N── Video

BillingPeriod ──1:N── Payment             (학원비, 16일~15일 주기)
MealServiceDay                            (급식 미운영일)
```

- **User** 는 로그인 계정. `role` 로 원장/강사/학생 구분
- **Student** 는 계정과 분리돼 있다. **학생 로그인 없이도 원생을 등록·관리할 수 있고**,
  나중에 학생 계정을 붙일 때 연결만 하면 된다 (`userId` 는 선택 항목)
- **`seatNo`(좌석번호)** 가 학원의 실질적 학생 식별자다. 학원비 명부·급식 신청·질의응답
  예약이 모두 이 번호를 쓴다
- 급식은 **신청 → 수령 → 정산** 세 단계가 각각 다른 표에 남는다. 신청만 하고 안 먹은 날은
  청구되지 않고, 정산은 `MealRecord`(실제 수령)만 집계한다
- **유니크 제약** 덕분에 같은 날 출결 중복 입력, 같은 주기 학원비 중복 청구, 같은 날
  급식 중복 수령이 DB 차원에서 막힌다

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
└── routes/            auth · students · attendance · payments · meals · videos
```

## 6. 자주 쓰는 명령어

| 명령어            | 설명                                            |
| ----------------- | ----------------------------------------------- |
| `pnpm dev`        | 개발 서버 (파일 변경 시 자동 재시작)            |
| `pnpm db:migrate` | 스키마 변경을 마이그레이션으로 만들어 DB에 반영 |
| `pnpm db:status`  | 적용 안 된 마이그레이션 확인                    |
| `pnpm db:studio`  | 브라우저에서 DB 데이터 확인/편집                |
| `pnpm typecheck`  | 타입 검사                                       |

스키마를 고쳤으면 `pnpm db:migrate`를 쓴다. `db:push`는 마이그레이션 기록을 남기지
않아 배포 환경과 어긋나므로 쓰지 않는다.

## 7. 알아둘 점

- **Prisma 7부터** DB 주소가 `schema.prisma`가 아니라 `prisma.config.ts`에 있다. 인터넷 자료
  대부분은 6버전 기준이라 `url = env("DATABASE_URL")`을 스키마에 쓰라고 하는데, 7에서는 에러가 난다.
- 영상은 현재 서버 로컬 `uploads/` 폴더에 저장된다. 실제 배포 시에는 Bunny Stream 같은 외부
  스토리지로 옮겨야 한다.
- 비밀번호는 bcrypt 해시로만 저장되며 평문은 어디에도 남지 않는다.
- `src/generated/`는 Prisma가 자동 생성하는 코드라 커밋하지 않는다. `pnpm install` 후
  `pnpm db:generate`로 다시 만든다.
- 급식 취소 마감(전날)은 **한국 시간 기준**으로 판정한다 (`todayInKst`).
