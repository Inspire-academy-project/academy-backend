# 배포 (API 서버)

Railway에 올린다. 무료 주소가 나오므로 도메인은 없어도 된다.

현재 배포 주소: `https://academy-backend-production-6ad0.up.railway.app`

## 점검표

처음 배포할 때 아래 여섯 가지에서 막혔다. 순서대로 확인하면 대부분 걸러진다.

| 확인할 것                      | 어디서                 | 놓치면                         |
| ------------------------------ | ---------------------- | ------------------------------ |
| 소스 브랜치가 `develop` 인가   | Settings → Source      | 엉뚱한 브랜치를 빌드           |
| **자동 배포가 켜져 있는가**    | Settings → Source      | **고쳐도 옛 커밋만 반복 빌드** |
| 리전이 Southeast Asia 인가     | Settings → Region      | 쿼리마다 대륙 왕복             |
| `PORT` 와 도메인 포트가 같은가 | Variables / Networking | 주소는 생기는데 502            |
| 도메인을 생성했는가            | Settings → Networking  | 외부 접속 불가                 |
| **변수 값에 따옴표가 없는가**  | Variables              | 서버가 시작하다 죽음           |

특히 두 번째와 여섯 번째가 원인을 찾기 어렵다. 둘 다 화면상으로는 정상으로 보이기 때문이다.

## 1. Railway 프로젝트 만들기

1. [railway.app](https://railway.app) 가입 (GitHub 계정으로)
2. **New Project → Deploy from GitHub repo → academy-backend** 선택
3. Root directory는 비워둔다 (저장소 루트가 곧 서버 폴더)

`railway.json`이 저장소에 있어 빌드·실행 명령과 헬스체크는 자동으로 잡힌다.

### 자동 배포를 켠다

**Settings → Source** 에서 브랜치가 `develop`인지 확인하고,
`Auto deploy is disabled` 라고 되어 있으면 **Enable** 을 누른다.

이게 꺼져 있으면 Railway가 **처음 가져온 커밋에 멈춘 채** 계속 그것만 빌드한다.
코드를 고치고 머지해도 반영되지 않으므로, 같은 오류가 반복되면 여기부터 본다.

### 리전을 바꾼다

**Settings → Region** 에서 **Southeast Asia (Singapore)** 를 고른다.

기본값이 US 또는 EU West인데, 데이터베이스(Supabase)가 서울에 있어서 리전이 멀면
**쿼리 한 번마다 대륙을 왕복**한다. 싱가포르는 서울과 왕복 약 70ms, 유럽은 약 250ms다.

### 주소 만들기

배포된 직후에는 `Unexposed service` 상태라 외부에서 접속할 수 없다.
**Settings → Networking → Generate Domain** 을 눌러야 주소가 생긴다.

이때 **"Enter the port your app is listening on"** 을 묻는다. 입력칸에 흐리게 보이는 `8080`은
Railway의 예시일 뿐이니 **`4000`** 을 직접 입력한다. Variables의 `PORT`와 같은 값이어야 한다.

## 2. 환경변수 넣기

Railway 프로젝트 → **Variables** 에 아래를 넣는다.

| 변수           | 값                             | 설명                                   |
| -------------- | ------------------------------ | -------------------------------------- |
| `DATABASE_URL` | Supabase Session pooler URI    | 로컬 `.env`와 같은 값                  |
| `JWT_SECRET`   | **새로 만든 긴 무작위 문자열** | 로컬 값을 그대로 쓰지 말 것            |
| `CORS_ORIGIN`  | 프론트 배포 주소               | 쉼표로 여러 개 가능                    |
| `PORT`         | `4000`                         | 도메인 생성 시 입력한 포트와 같아야 함 |
| `UPLOAD_DIR`   | `./uploads`                    | 기본값 그대로                          |

### 따옴표를 넣지 않는다

로컬 `.env` 파일에는 값이 따옴표로 감싸여 있다.

```
DATABASE_URL="postgresql://..."
```

**dotenv는 따옴표를 벗겨서 읽지만, Railway는 입력한 문자를 그대로 값으로 쓴다.**
따옴표째 붙여넣으면 값이 `"postgresql://...` 로 시작해 아래 오류가 난다.

```
P1013: The provided database string is invalid. The scheme is not recognized
```

`postgresql://` 로 **바로 시작**해야 하고 앞뒤에 따옴표·공백·줄바꿈이 없어야 한다.
`CORS_ORIGIN`도 마찬가지다. 따옴표가 들어가면 주소가 일치하지 않아 **모든 요청이 차단**되는데,
서버는 정상으로 보여서 원인을 찾기 어렵다.

### JWT_SECRET 만들기

이 값을 아는 사람은 관리자 토큰을 위조할 수 있다. `.env.example`의 값은 공개 저장소에 있으므로
반드시 새로 만든다.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 3. 배포 확인

주소만 확인하고 끝내지 말고 **데이터베이스까지 닿는지** 확인한다.

```bash
curl https://academy-backend-production-6ad0.up.railway.app/health
```

```bash
curl -X POST https://academy-backend-production-6ad0.up.railway.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@academy.kr","password":"academy1234"}'
```

`/health`는 서버만 확인한다. **토큰이 나와야** DB 연결까지 정상이라는 뜻이다.

`pnpm start`가 `prisma migrate deploy`를 먼저 실행하므로 스키마는 배포할 때마다 최신이 된다.

## 4. 프론트와 연결

1. 프론트(Cloudflare Pages)의 `NEXT_PUBLIC_API_URL`에 Railway 주소를 넣는다
2. Railway의 `CORS_ORIGIN`에 Cloudflare Pages 주소를 넣는다

두 값이 서로를 가리켜야 한다. 한쪽만 설정하면 브라우저가 요청을 막는다.

```
http://localhost:3000,https://academy-frontend.pages.dev
```

연결됐는지는 브라우저에서 실제로 로그인해 확인한다.

## 실패했을 때

### 빌드 단계

**`ERR_PNPM_BROKEN_LOCKFILE: expected a single document in the stream, but found more`**

pnpm 11은 락파일을 YAML 문서 두 개로 쓰는데(앞은 pnpm 자체 버전 관리용, 뒤가 실제 의존성),
빌드 환경의 pnpm이 이 형식을 읽지 못한다.

그래서 이 저장소는 **pnpm 10으로 고정**한다. `package.json`에 `devEngines`가 있으면
`packageManager`가 무시되므로 `devEngines`는 두지 않는다.

```json
"packageManager": "pnpm@10.34.5"
```

**`packages field missing or empty`**

`pnpm-workspace.yaml`에 `packages` 항목이 없으면 pnpm이 설치를 거부한다.
이미 `packages: ['.']` 이 들어 있으니, 이 오류가 보인다면 옛 커밋을 빌드하고 있는 것이다.

### 배포 단계

**Healthcheck failure**

빌드는 됐는데 `/health`가 응답하지 않는 상태다. **Deploy Logs**(Build Logs가 아니다)를 본다.

| 로그에 보이는 것                      | 원인                                 |
| ------------------------------------- | ------------------------------------ |
| `P1013 ... scheme is not recognized`  | `DATABASE_URL`에 따옴표가 붙었다     |
| `P1001: Can't reach database server`  | DB 주소가 틀렸거나 Supabase가 멈췄다 |
| `환경변수 설정이 잘못되었습니다`      | 필수 변수가 비어 있다                |
| `API 서버 실행 중` 이 보이는데도 실패 | 포트가 어긋났다                      |

`pnpm start`는 `prisma migrate deploy && node dist/index.js` 두 단계다.
앞이 실패하면 서버는 아예 시작하지 않으므로, 컨테이너는 떠 있는데 아무도 응답하지 않는다.

### 고쳤는데 같은 오류가 반복될 때

**자동 배포가 꺼져 있는지 먼저 확인한다.** 꺼져 있으면 Railway는 처음 가져온 커밋만
계속 빌드하므로, 코드를 아무리 고쳐도 반영되지 않는다.

Deployments 목록의 커밋 메시지와 시각으로 판단한다. 카드 옆의 8자리 문자열은 커밋 해시가
아니라 **Railway 배포 ID**이므로 커밋 확인에 쓸 수 없다.

## 알아둘 점

- **파일이 재배포 때 사라진다.** Railway 디스크는 임시라 `uploads/`에 올린 영상은 다시 배포하면
  없어진다. 영상 기능(P2)을 붙일 때는 Bunny Stream 같은 외부 저장소를 써야 한다.
- **`JWT_SECRET`을 바꾸면 모두 로그아웃된다.** 발급된 토큰이 전부 무효가 되므로 운영 중에는 바꾸지
  않는다.
- **로그**는 Deployments → View logs 에서 본다. Build Logs와 Deploy Logs가 나뉘어 있으니
  증상에 맞는 쪽을 본다.
