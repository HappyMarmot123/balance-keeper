---
name: vercel-api-gateway
description: Apply this project's coarse Vercel gateway, server-side public-data fetcher, cache-resilience, and CCTV media-delivery rules. Use when adding or reviewing API routes, provider calls, Korean public APIs, Upstash coordination, response envelopes, or provider-issued media URLs.
---

# Vercel API Gateway

## Start from the accepted boundaries

Read `docs/PROJECT-JOURNAL.md` decisions D-013 through D-015 and the relevant provider row before implementation. Treat volatile endpoint, quota, response-shape, and media facts marked `CONDITIONAL` as gated evidence, not defaults.

## Keep one gateway policy surface

- Expose product routes through one or a small number of coarse gateway Functions and an internal route registry. Do not create one Vercel Function file per product route.
- Keep the reusable core shaped as `(request: Request, dependencies) => Promise<Response>`. Let thin Vercel and Node adapters own runtime-specific environment and lifecycle details.
- Parse and validate the method, route, and normalized query before registry dispatch. Inject server-only credentials only after selecting an approved provider.
- Return normalized JSON through the shared success or error envelope. Never include secrets, raw authorization, upstream error bodies, or stacks.

## Separate local optimization from fleet state

- Use a process-local promise map only to coalesce the same key inside one warm instance. It is not fleet-wide state.
- Keep fresh and last-good records, distributed locks, rate counters, and breaker state in Upstash atomic operations with TTL.
- Treat a distributed breaker as a recovery hint because Upstash replication has eventual consistency; tolerate rare duplicate upstream calls and prefer last-good fallback.
- Leave thresholds, cooldowns, ETag algorithms, TTL values, and lock timing for T06 tests and route profiles. Do not freeze them in this skill.
- Consider only a normal 2xx empty response for short negative caching. Never negative-cache a timeout, 4xx, 5xx, or schema failure.

## Preserve the media byte exception

- Send every upstream API, authentication, list, query, and media-metadata request through the gateway.
- Allow the browser to fetch bytes only under the media-only exception: the gateway returned a provider-issued HTTPS media URL, the URL contains no server secret, and it passed the provider allowlist.
- Validate the initial URL and every redirect final URL against protocol, host, and path rules. Confirm provider terms and CORS before enabling direct browser delivery.
- Do not relay large image, video, or HLS segment bytes continuously through a standard Vercel Function.
- If direct delivery cannot meet those conditions, render the capability unavailable and obtain approval for a separate media topology before implementing manifest, key, segment, or byte-range relay.

## Gate Korean provider details

- Treat current ITS CCTV values as candidates: `type=ex|its`, `cctvType=3` still image, and `cctvType=4` HTTPS-HLS.
- Run a credentialed gated probe in T19 through T21 before freezing the CCTV host, path, port, parameter spelling, URL expiry, size, CORS, or display conditions. Run the equivalent T26 probe for ITS expansion routes. Do not promote an unauthenticated `:9443` reachability result to a production endpoint contract.
- Use Safetydata `DSSP-IF-00247`, KMA `getEqkMsg`, and AirKorea `getCtprvnRltmMesureDnsty` only as documented candidates. Keep XML error branches, empty results, date windows, key encoding, quota, coordinates, and administrative-region behavior in their owning Task fixtures and gated probes.

## Reject unsafe shortcuts

- Reject browser calls to protected API or metadata endpoints.
- Reject per-route copies of cache, error, and credential policy.
- Reject process memory as a fleet lock or breaker source of truth.
- Reject stale data presented without upstream freshness and degraded status.
- Reject provider claims that exceed the evidence level recorded in the project journal.
