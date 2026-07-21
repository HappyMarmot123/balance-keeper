import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import type { KoreaMapSession, NaverMapsNamespace } from '../../src/entities/map';
import { type KoreaMapServices, KoreaMapView } from '../../src/widgets/korea-map/ui/KoreaMapView';

function deferred<Value>() {
  let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function fixtureMaps(): NaverMapsNamespace {
  return {
    Map: class FixtureMap {},
    jsContentLoaded: true,
  } as unknown as NaverMapsNamespace;
}

function sessionFixture(ready: Promise<void> = Promise.resolve()): KoreaMapSession {
  return {
    destroy: vi.fn(),
    ready,
    resetView: vi.fn(),
  };
}

function servicesFixture(overrides: Partial<KoreaMapServices> = {}): KoreaMapServices {
  return {
    createSession: vi.fn(() => sessionFixture()),
    loadMaps: vi.fn(async () => fixtureMaps()),
    subscribeAuthenticationFailure: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

describe('KoreaMapView', () => {
  it('keeps a named full-height region without requesting the SDK when the canonical key is missing', () => {
    const services = servicesFixture();
    const { container } = render(<KoreaMapView config={{ kind: 'missing-key' }} services={services} />);

    const region = screen.getByRole('region', { name: '대한민국 상황 지도' });
    expect(region.getAttribute('aria-busy')).toBeNull();
    expect(region.classList.contains('min-h-160')).toBe(true);
    expect(region.classList.contains('lg:min-h-192')).toBe(true);
    expect(
      screen.getByText('대한민국 지도를 표시하려면 지도 연결 설정이 필요합니다. 관리자에게 문의하세요.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
    expect(services.loadMaps).not.toHaveBeenCalled();
    const mapRoot = container.querySelector('[data-naver-map-root]');
    expect(mapRoot?.classList.contains('z-0')).toBe(true);
    expect(mapRoot?.classList.contains('h-full')).toBe(true);
    expect(mapRoot?.classList.contains('w-full')).toBe(true);
    expect(mapRoot?.childNodes).toHaveLength(0);
    expect(screen.getByRole('status').closest('.z-10')).not.toBeNull();
  });

  it('announces SDK and init loading while keeping the provider mount element empty', () => {
    const loading = deferred<NaverMapsNamespace>();
    const services = servicesFixture({ loadMaps: vi.fn(() => loading.promise) });
    const { container } = render(
      <KoreaMapView config={{ apiKeyId: 'fixture-key', kind: 'ready' }} services={services} />,
    );

    const region = screen.getByRole('region', { name: '대한민국 상황 지도' });
    expect(region.getAttribute('aria-busy')).toBe('true');
    const loadingStatus = screen.getByRole('status');
    expect(loadingStatus.textContent).toContain('대한민국 지도 화면을 준비하고 있습니다.');
    expect(loadingStatus.classList.contains('z-10')).toBe(true);
    expect(container.querySelector('[data-naver-map-root]')?.childNodes).toHaveLength(0);
  });

  it('reports a custom-style ready state and resets the existing session only', async () => {
    const ready = deferred<void>();
    const session = sessionFixture(ready.promise);
    const services = servicesFixture({ createSession: vi.fn(() => session) });
    render(
      <KoreaMapView
        config={{ apiKeyId: 'fixture-key', kind: 'ready', styleId: 'fixture-style' }}
        services={services}
      />,
    );

    await waitFor(() => expect(services.createSession).toHaveBeenCalledOnce());
    expect(screen.getByRole('region', { name: '대한민국 상황 지도' }).getAttribute('aria-busy')).toBe('true');
    expect(services.createSession).toHaveBeenCalledWith({
      container: expect.any(HTMLElement),
      maps: expect.any(Object),
      styleId: 'fixture-style',
    });

    ready.resolve();
    await screen.findByText('NAVER GL · 다크 맞춤 스타일');
    const reset = screen.getByRole('button', { name: '대한민국 전체 보기' });
    fireEvent.click(reset);

    expect(session.resetView).toHaveBeenCalledOnce();
    expect(services.createSession).toHaveBeenCalledOnce();
    expect(screen.getByRole('region', { name: '대한민국 상황 지도' }).getAttribute('aria-busy')).toBeNull();
  });

  it('makes the default-GL degraded state explicit when no custom style is configured', async () => {
    const services = servicesFixture();
    render(<KoreaMapView config={{ apiKeyId: 'fixture-key', kind: 'ready' }} services={services} />);

    await screen.findByText('NAVER GL · 기본 스타일');
    expect(screen.getByText('맞춤 지도 스타일이 설정되지 않아 기본 지도를 표시합니다.')).toBeTruthy();
    expect(services.createSession).toHaveBeenCalledWith({
      container: expect.any(HTMLElement),
      maps: expect.any(Object),
    });
  });

  it('falls back once to default GL when a configured custom style never renders tiles', async () => {
    const customReady = deferred<void>();
    const customSession = sessionFixture(customReady.promise);
    const defaultSession = sessionFixture();
    const createSession = vi
      .fn<KoreaMapServices['createSession']>()
      .mockReturnValueOnce(customSession)
      .mockReturnValueOnce(defaultSession);
    const services = servicesFixture({ createSession });
    render(
      <KoreaMapView
        config={{ apiKeyId: 'fixture-key', kind: 'ready', styleId: 'fixture-style' }}
        services={services}
      />,
    );

    await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
    customReady.reject(Object.assign(new Error('render detail'), { code: 'RENDER_TIMEOUT' }));

    expect(await screen.findByText('NAVER GL · 기본 스타일')).toBeTruthy();
    expect(screen.getByText('맞춤 지도 스타일을 불러오지 못해 기본 지도로 전환했습니다.')).toBeTruthy();
    expect(customSession.destroy).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(createSession).toHaveBeenNthCalledWith(2, {
      container: expect.any(HTMLElement),
      maps: expect.any(Object),
    });
  });

  it('maps raw failures to safe copy and retries without displaying identifiers or provider details', async () => {
    const rawFailure = Object.assign(new Error('provider detail fixture-secret-key'), {
      code: 'NETWORK_FAILED',
    });
    const loadMaps = vi.fn().mockRejectedValueOnce(rawFailure).mockResolvedValueOnce(fixtureMaps());
    const services = servicesFixture({ loadMaps });
    render(<KoreaMapView config={{ apiKeyId: 'fixture-secret-key', kind: 'ready' }} services={services} />);

    await screen.findByRole('alert');
    expect(
      screen.getByText('지도 서비스를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도하세요.'),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain('fixture-secret-key');
    expect(document.body.textContent).not.toContain('provider detail');
    expect(screen.getByRole('region', { name: '대한민국 상황 지도' }).getAttribute('aria-busy')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await screen.findByText('NAVER GL · 기본 스타일');
    expect(loadMaps).toHaveBeenCalledTimes(2);
  });

  it('turns a Map-stage authentication failure into an immediate safe failure state', async () => {
    const ready = deferred<void>();
    const session = sessionFixture(ready.promise);
    let notifyAuthenticationFailure: () => void = () => undefined;
    const unsubscribe = vi.fn();
    const subscribeAuthenticationFailure = vi.fn((listener: () => void) => {
      notifyAuthenticationFailure = listener;
      return unsubscribe;
    });
    const services = {
      ...servicesFixture({ createSession: vi.fn(() => session) }),
      subscribeAuthenticationFailure,
    } as KoreaMapServices;
    render(<KoreaMapView config={{ apiKeyId: 'fixture-key', kind: 'ready' }} services={services} />);

    await waitFor(() => expect(services.createSession).toHaveBeenCalledOnce());
    expect(subscribeAuthenticationFailure).toHaveBeenCalledOnce();
    notifyAuthenticationFailure();

    expect(
      await screen.findByText(
        '지도 인증을 확인할 수 없습니다. 등록된 서비스 주소와 지도 설정을 확인한 뒤 다시 시도하세요.',
      ),
    ).toBeTruthy();
    expect(session.destroy).toHaveBeenCalledOnce();
  });

  it('fails safely before Map construction when the authentication channel cannot be acquired', async () => {
    const services = servicesFixture({
      subscribeAuthenticationFailure: vi.fn(() => {
        throw Object.assign(new Error('global owner detail'), { code: 'CALLBACK_CONFLICT' });
      }),
    });
    render(<KoreaMapView config={{ apiKeyId: 'fixture-key', kind: 'ready' }} services={services} />);

    expect(await screen.findByText('지도를 준비하지 못했습니다. 잠시 후 다시 시도하세요.')).toBeTruthy();
    expect(services.createSession).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('global owner detail');
  });

  it('does not create a session when the shared SDK resolves after unmount', async () => {
    const loading = deferred<NaverMapsNamespace>();
    const services = servicesFixture({ loadMaps: vi.fn(() => loading.promise) });
    const view = render(<KoreaMapView config={{ apiKeyId: 'fixture-key', kind: 'ready' }} services={services} />);

    view.unmount();
    loading.resolve(fixtureMaps());
    await loading.promise;
    await Promise.resolve();

    expect(services.createSession).not.toHaveBeenCalled();
  });

  it('destroys an owned init-pending session exactly once on unmount', async () => {
    const ready = deferred<void>();
    const session = sessionFixture(ready.promise);
    const services = servicesFixture({ createSession: vi.fn(() => session) });
    const view = render(<KoreaMapView config={{ apiKeyId: 'fixture-key', kind: 'ready' }} services={services} />);
    await waitFor(() => expect(services.createSession).toHaveBeenCalledOnce());

    view.unmount();
    expect(session.destroy).toHaveBeenCalledOnce();
  });

  it('does not reload or reconstruct the map for a shell theme change and equivalent rerender', async () => {
    const services = servicesFixture();
    const config = { apiKeyId: 'fixture-key', kind: 'ready' } as const;
    const view = render(<KoreaMapView config={config} services={services} />);
    await screen.findByText('NAVER GL · 기본 스타일');

    document.documentElement.classList.add('dark');
    view.rerender(<KoreaMapView config={config} services={services} />);
    await Promise.resolve();

    expect(services.loadMaps).toHaveBeenCalledOnce();
    expect(services.createSession).toHaveBeenCalledOnce();
    document.documentElement.classList.remove('dark');
  });
});
