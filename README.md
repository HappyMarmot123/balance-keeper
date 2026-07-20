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
- Vercel deployment target

지도, CCTV, RSS, Redis 의존성은 해당 기능을 구현할 때 동적 로딩과 함께 추가합니다. 초기 번들에는 포함하지 않습니다.

## Project skills

프로젝트 스킬은 .agents/skills/에 있으며 skills-lock.json으로 설치 출처와 폴더 해시를 추적합니다. 외부에서 가져온 스킬은 원문과 라이선스를 유지하고, Planning Agent와 Full FSD 같은 저장소 전용 규칙은 이 프로젝트에서 관리합니다.

## Development workflow

[개발일지](docs/PROJECT-JOURNAL.md)가 제품 결정, Task 범위, 승인, 검증 결과의 단일 정본입니다. 현재는 승인모드이므로 APPROVED된 Task 하나만 수행하고, 검증 PASS를 보고한 뒤 사용자 ACCEPTED 전에는 다음 Task를 시작하지 않습니다.

클라이언트는 app → pages → widgets → features → entities → shared Full FSD 방향을 사용합니다. 첫 화면은 pages/dashboard로 구성하되 두 번째 실제 URL이 승인되기 전에는 router를 추가하지 않습니다. 세부 실행 규칙은 [AGENTS.md](AGENTS.md)를 따릅니다.

## Commands

    npm ci
    npm run dev
    npm run validate

환경변수는 .env.example을 기준으로 로컬 .env에 설정합니다. 서버 비밀값에는 VITE_ 접두어를 사용하지 않습니다.
