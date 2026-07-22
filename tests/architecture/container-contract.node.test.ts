import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../..');

describe('container deployment contract', () => {
  it('provides one multi-stage build with non-root API and web runtime targets', () => {
    const dockerfilePath = resolve(workspaceRoot, 'Dockerfile');
    expect(existsSync(dockerfilePath)).toBe(true);

    const dockerfile = readFileSync(dockerfilePath, 'utf8');
    expect(dockerfile).toContain('AS api');
    expect(dockerfile).toContain('AS web');
    expect(dockerfile).toMatch(/USER (?:node|1000:1000)/);
    expect(dockerfile).toMatch(/USER (?:nginx|101:101)/);
    expect(dockerfile).toContain('sha256:');
    expect(dockerfile).toContain('ARG VITE_NAVER_MAPS_KEY_ID');
    expect(dockerfile).toContain('ARG VITE_NAVER_MAP_STYLE_ID');
  });

  it('keeps API internal and exposes only the hardened web service', () => {
    const composePath = resolve(workspaceRoot, 'compose.yaml');
    expect(existsSync(composePath)).toBe(true);

    const compose = readFileSync(composePath, 'utf8');
    expect(compose).toContain('target: api');
    expect(compose).toContain('target: web');
    expect(compose).toContain('condition: service_healthy');
    expect(compose).toContain('127.0.0.1:$' + '{BK_WEB_PORT:-8080}:8080');
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toMatch(/VITE_NAVER_MAPS_KEY_ID:\s*\$\{VITE_NAVER_MAPS_KEY_ID:-\}/);
    expect(compose).toMatch(/VITE_NAVER_MAP_STYLE_ID:\s*\$\{VITE_NAVER_MAP_STYLE_ID:-\}/);
  });

  it('uses read-only-safe Nginx paths and proxies health plus every API depth', () => {
    const nginxPath = resolve(workspaceRoot, 'infra/nginx/nginx.conf');
    expect(existsSync(nginxPath)).toBe(true);

    const nginx = readFileSync(nginxPath, 'utf8');
    expect(nginx).toContain('listen 8080');
    expect(nginx).toContain('pid /tmp/nginx.pid');
    expect(nginx).toContain('location = /healthz');
    expect(nginx).toContain('location = /api');
    expect(nginx).toContain('location ^~ /api/');
    expect(nginx).toContain('proxy_pass http://api_upstream');
  });

  it('excludes local secrets and generated state from the Docker build context', () => {
    const dockerignorePath = resolve(workspaceRoot, '.dockerignore');
    expect(existsSync(dockerignorePath)).toBe(true);

    const ignored = readFileSync(dockerignorePath, 'utf8').split(/\r?\n/);
    expect(ignored).toContain('.env*');
    expect(ignored).toContain('**/.env*');
    expect(ignored).toContain('node_modules/');
    expect(ignored).toContain('dist/');
    expect(ignored).toContain('dist-server/');
  });
});
