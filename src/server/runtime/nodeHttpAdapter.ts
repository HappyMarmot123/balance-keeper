import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

class InvalidNodeRequestTargetError extends TypeError {}

const invalidOrigin = (): never => {
  throw new TypeError('Node gateway origin must be a valid HTTP origin');
};

const parseNodeGatewayOrigin = (value: string): string => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return invalidOrigin();
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.hostname.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== '/' ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return invalidOrigin();
  }

  return url.origin;
};

const invalidTarget = (): never => {
  throw new InvalidNodeRequestTargetError('Node request must use a canonical origin-form request target');
};

export function createSafeNodeRequestUrl(origin: string, rawTarget: string | undefined): URL {
  const safeOrigin = parseNodeGatewayOrigin(origin);

  if (
    rawTarget === undefined ||
    rawTarget.length === 0 ||
    !rawTarget.startsWith('/') ||
    rawTarget.startsWith('//') ||
    rawTarget.includes('\\') ||
    rawTarget.includes('#')
  ) {
    return invalidTarget();
  }

  const rawPathname = rawTarget.split('?', 1)[0] ?? '';

  for (const segment of rawPathname.split('/')) {
    let decoded: string;

    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return invalidTarget();
    }

    const containsControlCharacter = [...decoded].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    });

    if (decoded === '.' || decoded === '..' || decoded.includes('\\') || containsControlCharacter) {
      return invalidTarget();
    }
  }

  const url = new URL(`${safeOrigin}${rawTarget}`);

  if (url.origin !== safeOrigin || url.pathname !== rawPathname) {
    return invalidTarget();
  }

  return url;
}

export type NodeHttpRequestContext = Readonly<{
  remoteAddress: string | null;
}>;

export type NodeHttpRequestHandler = (request: Request, context: NodeHttpRequestContext) => Promise<Response>;

export type CreateNodeHttpServerOptions = Readonly<{
  handleRequest: NodeHttpRequestHandler;
  origin: string;
}>;

const createRequestHeaders = (request: IncomingMessage): Headers => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const connectionHeaders =
    headers
      .get('Connection')
      ?.split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean) ?? [];
  const strippedHeaders = new Set([
    ...connectionHeaders,
    'connection',
    'forwarded',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authentication-info',
    'proxy-authorization',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-proto',
    'x-real-ip',
    'x-vercel-forwarded-for',
  ]);

  for (const name of strippedHeaders) {
    headers.delete(name);
  }

  return headers;
};

const createWebRequest = (incoming: IncomingMessage, url: URL, signal: AbortSignal): Request => {
  const method = incoming.method ?? 'GET';
  const init: RequestInit & { duplex?: 'half' } = {
    headers: createRequestHeaders(incoming),
    method,
    signal,
  };

  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(incoming, {
      strategy: {
        highWaterMark: incoming.readableHighWaterMark,
        size: (chunk) => (chunk as Uint8Array).byteLength,
      },
    }) as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }

  return new Request(url, init);
};

const setResponseHeaders = (outgoing: ServerResponse, response: Response): void => {
  const connectionHeaders =
    response.headers
      .get('Connection')
      ?.split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean) ?? [];
  const strippedHeaders = new Set([
    ...connectionHeaders,
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authentication-info',
    'proxy-authorization',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]);

  for (const [name, value] of response.headers) {
    if (name.toLowerCase() !== 'set-cookie' && !strippedHeaders.has(name.toLowerCase())) {
      outgoing.setHeader(name, value);
    }
  }

  const cookies = response.headers.getSetCookie();

  if (cookies.length > 0) {
    outgoing.setHeader('Set-Cookie', cookies);
  }
};

const isBodylessStatus = (status: number): boolean => status === 204 || status === 205 || status === 304;

const writeWebResponse = async (
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  response: Response,
  signal: AbortSignal,
): Promise<void> => {
  outgoing.statusCode = response.status;
  if (response.statusText.length > 0) {
    outgoing.statusMessage = response.statusText;
  }
  setResponseHeaders(outgoing, response);

  if (incoming.method === 'HEAD' || isBodylessStatus(response.status) || response.body === null) {
    if (response.status === 204 || response.status === 205) {
      outgoing.removeHeader('Content-Length');
    }
    if (response.body !== null) {
      void response.body.cancel().catch(() => undefined);
    }
    outgoing.end();
    return;
  }

  await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream, { signal }), outgoing);
};

const writeError = (outgoing: ServerResponse, status: 400 | 500, code: 'BAD_REQUEST' | 'INTERNAL'): void => {
  if (outgoing.headersSent || outgoing.destroyed) {
    outgoing.destroy();
    return;
  }

  outgoing.removeHeader('Set-Cookie');
  outgoing.removeHeader('Content-Length');
  outgoing.removeHeader('Content-Type');
  const requestId = randomUUID();
  const body = JSON.stringify({ error: { code, requestId } });
  outgoing.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Request-Id': requestId,
  });
  outgoing.end(body);
};

const handleNodeRequest = async (
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  options: CreateNodeHttpServerOptions,
): Promise<void> => {
  let url: URL;

  try {
    url = createSafeNodeRequestUrl(options.origin, incoming.url);
  } catch (error) {
    if (error instanceof InvalidNodeRequestTargetError) {
      writeError(outgoing, 400, 'BAD_REQUEST');
      return;
    }
    throw error;
  }

  const abortController = new AbortController();
  const abortRequest = () => {
    if (!abortController.signal.aborted) {
      abortController.abort(new DOMException('Node client disconnected', 'AbortError'));
    }
  };
  const abortOnIncompleteRequest = () => {
    if (!incoming.complete) {
      abortRequest();
    }
  };
  const abortOnPrematureClose = () => {
    if (!outgoing.writableFinished) {
      abortRequest();
    }
  };

  incoming.once('close', abortOnIncompleteRequest);
  incoming.once('error', abortRequest);
  outgoing.once('close', abortOnPrematureClose);
  outgoing.once('error', abortRequest);

  try {
    const request = createWebRequest(incoming, url, abortController.signal);
    const response = await options.handleRequest(request, {
      remoteAddress: incoming.socket.remoteAddress ?? null,
    });
    await writeWebResponse(incoming, outgoing, response, abortController.signal);
  } catch {
    writeError(outgoing, 500, 'INTERNAL');
  } finally {
    incoming.off('close', abortOnIncompleteRequest);
    incoming.off('error', abortRequest);
    outgoing.off('close', abortOnPrematureClose);
    outgoing.off('error', abortRequest);
  }
};

export function createNodeHttpServer(options: CreateNodeHttpServerOptions): Server {
  parseNodeGatewayOrigin(options.origin);

  return createServer((incoming, outgoing) => {
    void handleNodeRequest(incoming, outgoing, options).catch(() => {
      writeError(outgoing, 500, 'INTERNAL');
    });
  });
}

export type StartNodeHttpServerOptions = CreateNodeHttpServerOptions &
  Readonly<{
    host: string;
    port: number;
    shutdownTimeoutMs: number;
  }>;

export type RunningNodeHttpServer = Readonly<{
  close(): Promise<void>;
  port: number;
}>;

const assertStartOptions = (options: StartNodeHttpServerOptions): void => {
  if (options.host.trim().length === 0 || /\s/.test(options.host)) {
    throw new TypeError('Node server host must be a non-empty host without whitespace');
  }

  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new RangeError('Node server port must be an integer between 0 and 65535');
  }

  if (!Number.isSafeInteger(options.shutdownTimeoutMs) || options.shutdownTimeoutMs <= 0) {
    throw new RangeError('Node shutdown timeout must be a positive safe integer');
  }
};

const listen = (server: Server, host: string, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

const createShutdown = (server: Server, timeoutMs: number): (() => Promise<void>) => {
  let shutdown: Promise<void> | undefined;

  return () => {
    if (shutdown !== undefined) {
      return shutdown;
    }

    shutdown = new Promise<void>((resolve, reject) => {
      let settled = false;
      let idleSweep: NodeJS.Timeout;
      let timer: NodeJS.Timeout;
      const settle = (error?: Error | null) => {
        if (settled) {
          return;
        }

        settled = true;
        clearInterval(idleSweep);
        clearTimeout(timer);
        if (
          error !== undefined &&
          error !== null &&
          (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
        ) {
          reject(error);
        } else {
          resolve();
        }
      };

      timer = setTimeout(() => {
        server.closeAllConnections();
        settle();
      }, timeoutMs);
      timer.unref();

      idleSweep = setInterval(() => server.closeIdleConnections(), 10);
      idleSweep.unref();

      server.close(settle);
      server.closeIdleConnections();
    });

    return shutdown;
  };
};

export async function startNodeHttpServer(options: StartNodeHttpServerOptions): Promise<RunningNodeHttpServer> {
  assertStartOptions(options);
  const server = createNodeHttpServer(options);
  await listen(server, options.host, options.port);
  const address = server.address();

  if (address === null || typeof address === 'string') {
    server.closeAllConnections();
    throw new TypeError('Node HTTP server did not expose a TCP address');
  }

  return Object.freeze({
    close: createShutdown(server, options.shutdownTimeoutMs),
    port: address.port,
  });
}
