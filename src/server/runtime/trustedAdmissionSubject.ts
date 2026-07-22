import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { createAdmissionSubject, type OpaqueAdmissionSubject } from '../gateway';

export const TRUSTED_ADMISSION_SUBJECT_HEADER = 'x-bk-admission-subject';

const normalizeTrustedIdentity = (value: string | null): string => {
  const candidate = value?.trim() ?? '';

  if (isIP(candidate) === 0) {
    return 'anonymous';
  }

  return candidate.toLowerCase();
};

const digestTrustedIdentity = (value: string | null): string =>
  createHash('sha256')
    .update('balance-keeper:admission-subject:v1\0', 'utf8')
    .update(normalizeTrustedIdentity(value), 'utf8')
    .digest('base64url');

export function withTrustedAdmissionSubject(request: Request, identity: string | null): Request {
  const headers = new Headers(request.headers);
  headers.delete(TRUSTED_ADMISSION_SUBJECT_HEADER);
  headers.set(TRUSTED_ADMISSION_SUBJECT_HEADER, digestTrustedIdentity(identity));

  return new Request(request, { headers });
}

export function readTrustedAdmissionSubject(request: Request): OpaqueAdmissionSubject {
  const subject = request.headers.get(TRUSTED_ADMISSION_SUBJECT_HEADER);

  if (subject === null) {
    throw new TypeError('Trusted admission subject is missing');
  }

  return createAdmissionSubject(subject);
}
