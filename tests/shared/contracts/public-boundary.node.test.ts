// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(process.cwd());

type BoundaryExpectation = {
  exports: readonly string[];
  path: string;
};

const boundaries: readonly BoundaryExpectation[] = [
  {
    path: 'src/shared/contracts/index.ts',
    exports: [
      'AppError',
      'apiErrorCodeSchema',
      'errorEnvelopeSchema',
      'isAppError',
      'statusForApiErrorCode',
      'successEnvelopeSchema',
    ],
  },
  {
    path: 'src/server/http/index.ts',
    exports: ['toErrorEnvelope', 'toSuccessEnvelope'],
  },
];

describe('transport contract public boundaries', () => {
  it.each(boundaries)('$path exists and exposes the approved API', ({ exports, path }) => {
    const absolutePath = resolve(projectRoot, path);

    expect(existsSync(absolutePath), `${path} must exist`).toBe(true);

    const source = readFileSync(absolutePath, 'utf8');

    for (const exportedName of exports) {
      expect(source, `${path} must expose ${exportedName}`).toMatch(new RegExp(`\\b${exportedName}\\b`));
    }
  });
});
