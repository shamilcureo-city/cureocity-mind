'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  BeginRegistrationResponse,
  WebAuthnCredential,
  WebAuthnTransport,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface CredentialsResponse {
  items: WebAuthnCredential[];
}

interface BeginResponse extends BeginRegistrationResponse {
  error?: string;
}

export function SecuritySettingsCard() {
  const [items, setItems] = useState<WebAuthnCredential[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/psychologists/me/webauthn-credentials', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as CredentialsResponse;
      setItems(body.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const register = useCallback(async () => {
    if (typeof window === 'undefined' || !('credentials' in navigator)) {
      setError('WebAuthn is not supported in this browser.');
      return;
    }
    setRegistering(true);
    setError(null);
    try {
      const beginRes = await fetch(
        '/api/v1/psychologists/me/webauthn-credentials/begin-registration',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(label ? { label } : {}),
        },
      );
      const begin = (await beginRes.json().catch(() => ({}))) as BeginResponse;
      if (!beginRes.ok) throw new Error(begin.error ?? `HTTP ${beginRes.status}`);

      const userId = base64UrlToUint8Array(begin.user.id);
      const challenge = base64UrlToUint8Array(begin.challenge);
      const excludeCredentials = begin.excludeCredentialIds.map((id) => ({
        type: 'public-key' as const,
        id: base64UrlToUint8Array(id),
      }));

      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { id: begin.rpId, name: begin.rpName },
          user: {
            id: userId,
            name: begin.user.name,
            displayName: begin.user.displayName,
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },   // ES256
            { type: 'public-key', alg: -257 }, // RS256
          ],
          authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'required',
          },
          attestation: 'none',
          timeout: begin.timeoutSec * 1000,
          excludeCredentials,
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new Error('Registration cancelled.');
      const response = cred.response as AuthenticatorAttestationResponse;

      const transports = (
        typeof response.getTransports === 'function' ? response.getTransports() : []
      ) as WebAuthnTransport[];

      const publicKey = response.getPublicKey?.();
      if (!publicKey) {
        throw new Error('Authenticator did not expose a public key — registration cannot proceed.');
      }

      const finishRes = await fetch(
        '/api/v1/psychologists/me/webauthn-credentials/finish-registration',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticket: begin.ticket,
            ...(label ? { label } : {}),
            credentialId: uint8ArrayToBase64Url(new Uint8Array(cred.rawId)),
            publicKey: uint8ArrayToBase64Url(new Uint8Array(publicKey)),
            clientDataJSON: uint8ArrayToBase64Url(new Uint8Array(response.clientDataJSON)),
            attestationObject: uint8ArrayToBase64Url(
              new Uint8Array(response.attestationObject),
            ),
            transports,
          }),
        },
      );
      const finish = (await finishRes.json().catch(() => ({}))) as { error?: string };
      if (!finishRes.ok) throw new Error(finish.error ?? `HTTP ${finishRes.status}`);

      setLabel('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRegistering(false);
    }
  }, [label, load]);

  const revoke = useCallback(
    async (id: string) => {
      setError(null);
      const res = await fetch(`/api/v1/psychologists/me/webauthn-credentials/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      await load();
    },
    [load],
  );

  const hasActive = items && items.some((c) => c.revokedAt === null);

  return (
    <Card className="p-6">
      <header className="mb-4">
        <h2 className="font-serif text-2xl">Security</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          Register a platform authenticator (Touch ID, Windows Hello, security key) for
          passwordless replay-resistant note signing. Once a credential is on file, signing
          requires it.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-4">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Register a device
        </h3>
        <div className="mt-3 grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Device label (e.g. MacBook Touch ID)"
            className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3 text-sm"
          />
          <Button onClick={() => void register()} disabled={registering}>
            {registering ? 'Waiting for device…' : 'Register'}
          </Button>
        </div>
        <p className="mt-3 text-xs text-[var(--color-ink-3)]">
          You will be prompted to confirm with your device's biometric or PIN. Cureocity does
          not see your biometric data — only the public key.
        </p>
      </section>

      {error && (
        <div className="mt-4 rounded-2xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-3 text-sm text-[var(--color-warn)]">
          {error}
        </div>
      )}

      <h3 className="mt-6 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
        Registered credentials
      </h3>
      {loading && !items && (
        <p className="mt-2 text-sm text-[var(--color-ink-3)]">Loading…</p>
      )}
      {items && items.length === 0 && (
        <p className="mt-2 text-sm text-[var(--color-ink-3)]">
          No credentials registered. Notes can still be signed (legacy mode) until you register one.
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="mt-2 divide-y divide-[var(--color-line-soft)] border-y border-[var(--color-line-soft)]">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-3 px-1 py-3 text-sm">
              <div>
                <strong>{c.label ?? '(unlabelled)'}</strong>
                <span className="ml-2 text-xs text-[var(--color-ink-3)]">
                  {c.transports.length > 0 ? c.transports.join(', ') : 'no transports'}
                  {' · '}signCount {c.signCount}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {c.revokedAt === null ? (
                  <Badge tone="accent">active</Badge>
                ) : (
                  <Badge tone="muted">revoked</Badge>
                )}
                {c.revokedAt === null && (
                  <Button
                    variant="secondary"
                    onClick={() => void revoke(c.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-[var(--color-ink-3)]">
        {hasActive
          ? 'Sign-time assertion is REQUIRED for this account.'
          : 'No active credentials — sign-time assertion is currently optional.'}
      </p>
    </Card>
  );
}

function base64UrlToUint8Array(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
