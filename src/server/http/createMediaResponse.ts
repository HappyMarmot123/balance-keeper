export type CreateMediaResponseOptions = Readonly<{
  body: Uint8Array;
  contentType: 'image/jpeg';
  requestId: string;
}>;

export function createMediaResponse(options: CreateMediaResponseOptions): Response {
  if (options.body.byteLength === 0) {
    throw new TypeError('Media response body must not be empty');
  }

  return new Response(options.body.slice().buffer, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Length': String(options.body.byteLength),
      'Content-Type': options.contentType,
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': options.requestId,
    },
    status: 200,
  });
}
