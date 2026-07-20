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

## Commands

```bash
npm install
npm run dev
npm run validate
```

환경변수는 `.env.example`을 기준으로 로컬 `.env`에 설정합니다. 서버 비밀값에는 `VITE_` 접두어를 사용하지 않습니다.
