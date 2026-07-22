# Balance Keeper / Korea Monitor

한국과 주변 지역의 공개 데이터를 한 화면에서 확인하는 실시간 상황판을 새로 구현하는 저장소입니다.

## Foundation stack

- Node.js 24 + npm 11
- TypeScript 6 in strict mode
- Preact + Signals
- TanStack Query for Preact
- Vite 8 + Tailwind CSS 4
- Vitest + Testing Library
- Biome for linting and formatting
- Vercel Node 24 deployment target
- Docker Compose with non-root Node API + Nginx web runtime

지도 SDK와 provider route는 해당 기능 Task에서 추가합니다. 공용 gateway core와 Upstash adapter는 준비돼 있지만 실제 provider route 목록은 아직 비어 있습니다.

## Project skills

프로젝트 스킬은 .agents/skills/에 있으며 skills-lock.json으로 설치 출처와 폴더 해시를 추적합니다. 외부에서 가져온 스킬은 원문과 라이선스를 유지하고, Planning Agent와 Full FSD 같은 저장소 전용 규칙은 이 프로젝트에서 관리합니다.

## Development workflow

[개발일지](docs/PROJECT-JOURNAL.md)가 제품 결정, Task 범위, 승인, 검증 결과의 단일 정본입니다. 현재는 승인모드이므로 APPROVED된 Task 하나만 수행하고, 검증 PASS를 보고한 뒤 사용자 ACCEPTED 전에는 다음 Task를 시작하지 않습니다.

클라이언트는 app → pages → widgets → features → entities → shared Full FSD 방향을 사용합니다. 첫 화면은 pages/dashboard로 구성하되 두 번째 실제 URL이 승인되기 전에는 router를 추가하지 않습니다. 세부 실행 규칙은 [AGENTS.md](AGENTS.md)를 따릅니다.

## Commands

    npm ci
    npm run dev
    npm run validate

전체 로컬 스택은 Docker Compose 한 명령으로 실행합니다.

    docker compose up --build --wait

브라우저에서 `http://127.0.0.1:8080`을 열고, 종료할 때는 다음 명령을 사용합니다.

    docker compose down

Docker 없이 API와 Vite를 나눠 실행하려면 API 터미널에서 서버 번들을 먼저 만들고 실행합니다.

    npm run build:server
    npm run start:api

다른 터미널에서 `npm run dev`를 실행하면 `/api/*`와 `/healthz`가 `127.0.0.1:8787`로 same-origin proxy됩니다.

환경변수는 .env.example을 기준으로 로컬 .env에 설정합니다. Docker build에는 브라우저에 공개되는
`VITE_NAVER_MAPS_KEY_ID`와 `VITE_NAVER_MAP_STYLE_ID`만 전달하며, 서버 비밀값에는 VITE_ 접두어를
사용하거나 build argument로 전달하지 않습니다.
