// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const skillPath = resolve(process.cwd(), '.agents/skills/vercel-api-gateway/SKILL.md');

function readSkill(): string {
  return readFileSync(skillPath, 'utf8');
}

describe('vercel-api-gateway skill contract', () => {
  it('directs product routes through a coarse Web Request gateway and internal registry', () => {
    const skill = readSkill();

    expect(skill).toMatch(/coarse gateway Function/i);
    expect(skill).toMatch(/internal route registry/i);
    expect(skill).toMatch(/request: Request/);
    expect(skill).not.toContain('// api/weather.ts');
    expect(skill).not.toContain('req.query');
  });

  it('separates instance-local optimization from fleet-wide resilient state without freezing T06 policy', () => {
    const skill = readSkill();

    expect(skill).toMatch(/process-local promise map/i);
    expect(skill).toMatch(/warm instance/i);
    expect(skill).toMatch(/Upstash atomic operation/i);
    expect(skill).toMatch(/eventual consistency/i);
    expect(skill).toMatch(/breaker.*hint/i);
    expect(skill).toMatch(/normal 2xx empty/i);
    expect(skill).toMatch(/timeout.*4xx.*5xx.*schema failure/i);
    expect(skill).not.toMatch(/2 consecutive failures/i);
    expect(skill).not.toMatch(/FNV-1a/i);
  });

  it('preserves the narrowly scoped provider-media byte exception', () => {
    const skill = readSkill();

    expect(skill).toMatch(/media-only exception/i);
    expect(skill).toMatch(/provider-issued HTTPS media URL/i);
    expect(skill).toMatch(/server secret/i);
    expect(skill).toMatch(/allowlist/i);
    expect(skill).toMatch(/redirect.*final URL/i);
    expect(skill).toMatch(/provider terms.*CORS/i);
    expect(skill).toMatch(/do not relay.*video/i);
    expect(skill).toMatch(/do not relay.*HLS segment/i);
    expect(skill).toMatch(/unavailable.*separate media topology/i);
    expect(skill).not.toMatch(/browser never .*calls upstreams directly/i);
    expect(skill).not.toMatch(/Always proxy through `api\/`/i);
  });

  it('treats current ITS CCTV values as gated candidates instead of a frozen legacy endpoint', () => {
    const skill = readSkill();

    expect(skill).toMatch(/type=ex\|its/i);
    expect(skill).toMatch(/cctvType=3.*still image/i);
    expect(skill).toMatch(/cctvType=4.*HTTPS-HLS/i);
    expect(skill).toMatch(/gated probe/i);
    expect(skill).toMatch(/host.*path.*port/i);
    expect(skill).not.toMatch(/cctvType=1 HLS \/ 2 still-JPEG \/ 3 both/i);
    expect(skill).not.toMatch(/use `:9443\/cctvInfo`/i);
  });
});
