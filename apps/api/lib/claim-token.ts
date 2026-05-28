import { randomBytes } from 'node:crypto';

const TOKEN_BYTES = 16;

export function generateClaimToken(): string {
  return randomBytes(TOKEN_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return '';
  return trimmed.split(/\s+/)[0] ?? '';
}
