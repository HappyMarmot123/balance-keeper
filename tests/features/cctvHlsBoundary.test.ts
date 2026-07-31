// @vitest-environment node

import type { HlsConfig, LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderStats } from 'hls.js';
import { describe, expect, it, vi } from 'vitest';

import { createCctvHlsBoundaryLoader } from '../../src/features/cctv-live/model/cctvHlsBoundary';

const masterUrl = 'https://cctvsec.ktict.co.kr:8082/live/master.m3u8?wmsAuthSign=opaque-master-signature';
const mediaUrl =
  'https://cctvsec.ktict.co.kr:8082/live/channel/index.m3u8?nimblesessionid=opaque-session&wmsAuthSign=opaque-media-signature';
const segmentUrl =
  'https://cctvsec.ktict.co.kr:8082/live/channel/segment-1.ts?nimblesessionid=opaque-session&wmsAuthSign=opaque-media-signature';

const stats: LoaderStats = {
  aborted: false,
  buffering: { end: 0, first: 0, start: 0 },
  bwEstimate: 0,
  chunkCount: 0,
  loaded: 0,
  loading: { end: 0, first: 0, start: 0 },
  parsing: { end: 0, start: 0 },
  retry: 0,
  total: 0,
};

const configuration = {} as LoaderConfiguration;

type CapturedLoad = Readonly<{
  callbacks: LoaderCallbacks<LoaderContext>;
  context: LoaderContext;
}>;

class FakeBaseLoader {
  static configs: HlsConfig[] = [];
  static instances: FakeBaseLoader[] = [];

  callbacks?: LoaderCallbacks<LoaderContext>;
  context: LoaderContext | null = null;
  readonly stats = stats;
  abort = vi.fn();
  destroy = vi.fn();
  getCacheAge = vi.fn(() => 3);
  getResponseHeader = vi.fn(() => 'header-value');
  load = vi.fn(
    (context: LoaderContext, _configuration: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) => {
      this.context = context;
      this.callbacks = callbacks;
    },
  );

  constructor(config: HlsConfig) {
    FakeBaseLoader.configs.push(config);
    FakeBaseLoader.instances.push(this);
  }
}

const createCallbacks = () => ({
  onAbort: vi.fn(),
  onError: vi.fn(),
  onProgress: vi.fn(),
  onSuccess: vi.fn(),
  onTimeout: vi.fn(),
});

const createLoader = () => {
  FakeBaseLoader.configs = [];
  FakeBaseLoader.instances = [];
  const BoundaryLoader = createCctvHlsBoundaryLoader(FakeBaseLoader);
  const loader = new BoundaryLoader({ progressive: true } as HlsConfig);
  const base = FakeBaseLoader.instances[0];
  if (base === undefined) {
    throw new TypeError('Expected the boundary loader to construct its delegate');
  }
  return { base, loader };
};

const getCapturedLoad = (base: FakeBaseLoader): CapturedLoad => {
  if (base.callbacks === undefined || base.context === null) {
    throw new TypeError('Expected the base loader to capture one request');
  }
  return { callbacks: base.callbacks, context: base.context };
};

describe('CCTV hls.js boundary loader', () => {
  it('forces fail-closed fetch redirect and credential settings on the delegate', async () => {
    createLoader();
    const config = FakeBaseLoader.configs[0];
    if (config?.fetchSetup === undefined) {
      throw new TypeError('Expected the boundary loader to install fetchSetup');
    }

    const request = await config.fetchSetup(
      { responseType: 'text', url: masterUrl },
      {
        cache: 'default',
        credentials: 'include',
        method: 'GET',
        redirect: 'follow',
        referrerPolicy: 'unsafe-url',
      },
    );

    expect(request.redirect).toBe('error');
    expect(request.credentials).toBe('omit');
    expect(request.referrerPolicy).toBe('no-referrer');
    expect(request.cache).toBe('no-store');
    expect(config.progressive).toBe(false);
  });

  it('accepts the approved redirect chain and releases buffered progress only after final URL validation', () => {
    const { base, loader } = createLoader();
    const callbacks = createCallbacks();
    loader.load({ responseType: 'text', url: masterUrl }, configuration, callbacks);
    const captured = getCapturedLoad(base);

    captured.callbacks.onProgress?.(stats, captured.context, '#EXTM3U', null);
    captured.callbacks.onProgress?.(stats, captured.context, '#EXT-X-VERSION:3', null);
    expect(callbacks.onProgress).not.toHaveBeenCalled();

    captured.callbacks.onSuccess({ code: 200, data: '#EXTM3U', url: masterUrl }, stats, captured.context, null);
    expect(callbacks.onProgress).toHaveBeenCalledTimes(2);
    expect(callbacks.onProgress.mock.calls.map((call) => call[2])).toEqual(['#EXTM3U', '#EXT-X-VERSION:3']);
    expect(callbacks.onSuccess).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(loader.getCacheAge?.()).toBe(3);
    expect(loader.getResponseHeader?.('content-type')).toBe('header-value');

    for (const url of [masterUrl, mediaUrl, segmentUrl]) {
      const next = createLoader();
      const nextCallbacks = createCallbacks();
      next.loader.load(
        url === segmentUrl
          ? { headers: {}, rangeEnd: 0, rangeStart: 0, responseType: 'arraybuffer', url }
          : { responseType: 'text', url },
        configuration,
        nextCallbacks,
      );
      expect(next.base.load).toHaveBeenCalledOnce();
    }
  });

  it('does not opt the delegate into progressive loading when the caller omitted progress handling', () => {
    const { base, loader } = createLoader();
    const callbacks = {
      onError: vi.fn(),
      onSuccess: vi.fn(),
      onTimeout: vi.fn(),
    };
    loader.load({ responseType: 'text', url: masterUrl }, configuration, callbacks);
    const captured = getCapturedLoad(base);

    expect(captured.callbacks.onProgress).toBeUndefined();
  });

  it('rejects unapproved request URLs, resource types, and byte ranges before network access', () => {
    for (const context of [
      { responseType: 'text', url: masterUrl.replace('cctvsec.ktict.co.kr', 'example.com') },
      { responseType: 'arraybuffer', url: masterUrl.replace('.m3u8', '.key') },
      { rangeEnd: 100, rangeStart: 0, responseType: 'arraybuffer', url: segmentUrl },
      { headers: { rAnGe: 'bytes=0-99' }, responseType: 'arraybuffer', url: segmentUrl },
      { frag: { sn: 'initSegment' }, responseType: 'arraybuffer', url: segmentUrl },
      { keyInfo: {}, responseType: 'arraybuffer', url: segmentUrl },
    ]) {
      const { base, loader } = createLoader();
      const callbacks = createCallbacks();
      loader.load(context, configuration, callbacks);

      expect(base.load).not.toHaveBeenCalled();
      expect(callbacks.onError).toHaveBeenCalledOnce();
      expect(callbacks.onSuccess).not.toHaveBeenCalled();
    }
  });

  it('rejects an unapproved final redirect without exposing progress or success data', () => {
    const { base, loader } = createLoader();
    const callbacks = createCallbacks();
    loader.load({ responseType: 'text', url: masterUrl }, configuration, callbacks);
    const captured = getCapturedLoad(base);

    captured.callbacks.onProgress?.(stats, captured.context, '#EXTM3U', null);
    captured.callbacks.onSuccess(
      { code: 200, data: '#EXTM3U', url: 'https://example.com/live/master.m3u8' },
      stats,
      captured.context,
      null,
    );

    expect(base.abort).toHaveBeenCalledOnce();
    expect(callbacks.onProgress).not.toHaveBeenCalled();
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledOnce();
    expect(callbacks.onError.mock.calls[0]?.[0]).toEqual({
      code: 0,
      text: 'CCTV media boundary rejected',
    });
    expect(callbacks.onError.mock.calls[0]?.[2]).toBeNull();
  });

  it('rejects conflicting network response URLs and ignores callbacks after a terminal event', () => {
    const rejected = createLoader();
    const rejectedCallbacks = createCallbacks();
    rejected.loader.load({ responseType: 'text', url: masterUrl }, configuration, rejectedCallbacks);
    const rejectedLoad = getCapturedLoad(rejected.base);
    rejectedLoad.callbacks.onSuccess({ code: 200, data: '#EXTM3U', url: masterUrl }, stats, rejectedLoad.context, {
      url: mediaUrl,
    });
    expect(rejectedCallbacks.onError).toHaveBeenCalledOnce();
    expect(rejectedCallbacks.onSuccess).not.toHaveBeenCalled();

    const completed = createLoader();
    const completedCallbacks = createCallbacks();
    completed.loader.load({ responseType: 'text', url: masterUrl }, configuration, completedCallbacks);
    const completedLoad = getCapturedLoad(completed.base);
    completedLoad.callbacks.onSuccess({ code: 200, data: '#EXTM3U', url: masterUrl }, stats, completedLoad.context, {
      url: masterUrl,
    });
    completedLoad.callbacks.onError({ code: 500, text: 'late' }, completedLoad.context, null, stats);
    completedLoad.callbacks.onTimeout(stats, completedLoad.context, null);
    completedLoad.callbacks.onAbort?.(stats, completedLoad.context, null);
    completedLoad.callbacks.onProgress?.(stats, completedLoad.context, 'late', null);

    expect(completedCallbacks.onSuccess).toHaveBeenCalledOnce();
    expect(completedCallbacks.onError).not.toHaveBeenCalled();
    expect(completedCallbacks.onTimeout).not.toHaveBeenCalled();
    expect(completedCallbacks.onAbort).not.toHaveBeenCalled();
    expect(completedCallbacks.onProgress).not.toHaveBeenCalled();
  });

  it('discards buffered progress when the delegate fails before final URL validation', () => {
    const { base, loader } = createLoader();
    const callbacks = createCallbacks();
    loader.load({ responseType: 'text', url: masterUrl }, configuration, callbacks);
    const captured = getCapturedLoad(base);
    const error = { code: 502, text: 'upstream failed' };
    const networkDetails = { marker: 'network-details' };

    captured.callbacks.onProgress?.(stats, captured.context, '#EXTM3U', networkDetails);
    captured.callbacks.onError(error, captured.context, networkDetails, stats);
    captured.callbacks.onSuccess({ code: 200, data: '#EXTM3U', url: masterUrl }, stats, captured.context, null);

    expect(callbacks.onProgress).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledWith(error, captured.context, networkDetails, stats);
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
  });
});
