---
name: vercel-api-gateway
description: Use when writing a Vercel serverless API route or server-side data fetcher in this project, or when calling the Korean public APIs (data.go.kr weather/air/earthquake, ITS traffic, disaster messages). Covers the gateway pattern, caching, and verified endpoint gotchas.
---

# Vercel API Gateway

## Overview
Every external call goes through a server-side Vercel API Route acting as a lightweight gateway: inject the key, cache in Upstash, normalize, return a typed `Envelope`. The browser never holds keys and never calls upstreams directly.

## Route pattern
```ts
// api/weather.ts
import { defineRoute } from '../src/server/route';
import { fetchWeather } from '../src/server/sources/weather';

export default defineRoute(async (req) => {
  const region = String(req.query.region ?? 'seoul');
  return fetchWeather(region); // returns normalized domain data
});
// defineRoute wraps: key injection (env) → cachedFetch (Upstash) → AppError→Envelope → Cache-Control + ETag
```

Gateway responsibilities (don't reimplement per route):
1. **Key injection** from `process.env` (never shipped to client).
2. **cachedFetch**: Upstash lookup → on miss, coalesce concurrent misses → upstream call → normalize → store with TTL → **negative cache** (cache null results) + **stale-on-error** (serve last good on upstream failure).
3. **Circuit breaker**: 2 consecutive failures → cooldown.
4. **Envelope + AppError**: success `{data, meta}`, failure `{error:{code}}`; client `fetchJson` rethrows as `AppError`.
5. `Cache-Control` (`s-maxage`) + FNV-1a ETag → 304.

## Verified endpoint gotchas (tested 2026-06-24 — get these exactly right)
| API | Correct usage |
|---|---|
| **ITS traffic/CCTV** | `https://openapi.its.go.kr:9443/cctvInfo` — **port 9443**, path `/cctvInfo`, param `apiKey` (lowercase), `type`=ex/its/all, `cctvType`=1 HLS / 2 still-JPEG / 3 both, BBox lowercase `minX/maxX/minY/maxY`, `getType`=json. NOT `/api/NCCTVInfo`, no `ReqType`. |
| **Disaster messages (DSSP-IF-00247)** | Host is `https://www.safetydata.go.kr/V2/api/DSSP-IF-00247` — NOT `apis.data.go.kr`. Returns `{header, body:[...]}`. |
| **Earthquake (EqkInfoService)** | Operation is `getEqkMsg` (not `getEqkInfo`/`getEqkInfoList` → 404). Date range max **3 days** back or `resultCode 99`. |
| **Air quality (ArpltnInforInqireSvc)** | `getCtprvnRltmMesureDnsty`, success `resultCode 00` / `NORMAL_CODE`; empty result still 200 with `totalCount 0`. |
| **data.go.kr keys** | The hex `DATA_GO_KR_KEY` works URL-encoded; no extra decode needed. data.go.kr APIs are NOT geo-blocked (work from any region). |

## Common Mistakes
- **Calling upstreams from the client.** Leaks keys, hits CORS/mixed-content. Always proxy through `api/`.
- **ITS on port 443 / `/api/NCCTVInfo`.** Connection times out — use `:9443/cctvInfo`.
- **Treating `resultCode 99`/empty as an outage.** It's a param/empty signal, not a key failure.
- **No stale-on-error.** Upstream blips should serve last-good with a stale marker, not a hard error (see web-design-guidelines freshness).
