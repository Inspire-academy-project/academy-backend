# 배포 (API 서버)

Railway에 올린다. 무료 주소가 나오므로 도메인은 없어도 된다.

## 1. Railway 프로젝트 만들기

1. [railway.app](https://railway.app) 가입 (GitHub 계정으로)
2. **New Project → Deploy from GitHub repo → academy-backend** 선택
3. Root directory는 비워둔다 (저장소 루트가 곧 서버 폴더)

`railway.json`이 저장소에 있어 빌드·실행 명령과 헬스체크는 자동으로 잡힌다.

### 리전을 반드시 바꾼다

**Settings → Region** 에서 **Southeast Asia (Singapore)** 를 고른다.

기본값이 US 또는 EU West인데, 데이터베이스(Supabase)가 서울에 있어서 리전이 멀면
**쿼리 한 번마다 대륙을 왕복**한다. 화면 하나에 쿼리가 여러 번 나가므로 체감 속도가 크게 떨어진다.
싱가포르는 서울과 왕복 약 70ms, 유럽은 약 250ms다.

### 주소 만들기

배포된 직후에는 `Unexposed service` 상태라 외부에서 접속할 수 없다.
**Settings → Networking → Generate Domain** 을 눌러야 `...up.railway.app` 주소가 생긴다.

이때 **"Enter the port your app is listening on"** 을 묻는다. 입력칸에 흐리게 보이는 `8080`은
Railway의 예시일 뿐이니 **`4000`** 을 직접 입력한다. Variables의 `PORT`와 같은 값이어야 한다.

## 2. 환경변수 넣기

Railway 프로젝트 → **Variables** 에 아래를 넣는다.

| 변수 | 값 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | Supabase Session pooler URI | 로컬 `.env`와 같은 값 |
| `JWT_SECRET` | **새로 만든 긴 무작위 문자열** | 로컬 값을 그대로 쓰지 말 것 |
| `CORS_ORIGIN` | 프론트 배포 주소 | 쉼표로 여러 개 가능 |
| `UPLOAD_DIR` | `./uploads` | 기본값 그대로 |
| `PORT` | `4000` | 아래 설명 참고 |

서버는 `PORT` 환경변수를 읽고, 없으면 **4000**으로 뜬다 (`src/lib/env.ts`).
Railway가 주소를 만들 때 **어느 포트로 트래픽을 보낼지** 물어보므로, 양쪽을 4000으로 맞춰
어긋나지 않게 한다.

⚠️ **변수 이름만 만들고 값을 비워두면 안 된다.** Railway는 이름만 등록해도 목록에 나타나므로
값을 넣었다고 착각하기 쉽다. `DATABASE_URL`과 `JWT_SECRET`이 비면 서버가 이유를 출력하고
바로 종료하니 로그에서 확인할 수 있다.

`JWT_SECRET` 만들기 — 이 값을 아는 사람은 관리자 토큰을 위조할 수 있다.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 3. 배포 확인

Railway가 준 주소로 확인한다.

```bash
curl https://<프로젝트>.up.railway.app/health
```

`{"ok":true}` 가 나오면 성공이다.

`pnpm start`가 `prisma migrate deploy`를 먼저 실행하므로, 스키마는 배포할 때마다 자동으로
최신 상태가 된다.

## 4. 프론트와 연결

1. 프론트(Cloudflare Pages)의 `NEXT_PUBLIC_API_URL`에 Railway 주소를 넣는다
2. Railway의 `CORS_ORIGIN`에 Cloudflare Pages 주소를 넣는다

두 값이 서로를 가리켜야 한다. 한쪽만 설정하면 브라우저가 요청을 막는다.

## 빌드가 실패할 때

**`packages field missing or empty`**

`pnpm-workspace.yaml`에 `packages` 항목이 없으면 pnpm이 설치 단계에서 멈춘다.
이 저장소에는 이미 `packages: ['.']` 이 들어 있으니, 이 오류가 보인다면 배포되는 브랜치가
옛 커밋일 가능성이 높다. Railway가 어떤 브랜치를 보고 있는지 확인한다.

**빌드는 되는데 실행이 안 될 때**

`start`가 `prisma migrate deploy`를 먼저 돌린다. `DATABASE_URL`이 없거나 틀리면 여기서 멈추므로
Variables를 먼저 확인한다.

## 알아둘 점

- **파일이 재배포 때 사라진다.** Railway 디스크는 임시라 `uploads/`에 올린 영상은 다시 배포하면
  없어진다. 영상 기능(P2)을 붙일 때는 Bunny Stream 같은 외부 저장소를 써야 한다.
- **`JWT_SECRET`을 바꾸면 모두 로그아웃된다.** 발급된 토큰이 전부 무효가 되므로 운영 중에는 바꾸지
  않는다.
- **로그**는 Railway 프로젝트의 Deployments 탭에서 볼 수 있다. 500 오류가 나면 여기부터 본다.
