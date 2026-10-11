import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  telemetryRoute,
  redactTelemetryText,
  scrubTelemetryEvent,
  scrubTelemetryBreadcrumb,
} from './telemetry-redaction';

const secret = 'fictionalPrivateBearerToken';
describe('private-link telemetry boundary', () => {
  it.each([
    `/p/${secret}`,
    `/p/claim/${secret}`,
    `/claim/${secret}`,
    `/api/v1/p/${secret}/homework`,
    `/p/sessions/session-id/join?sig=${secret}`,
    `/api/v1/public/appointments/id/cancel?sig=${secret}`,
    `/app/clients/client-id?token=${secret}#${secret}`,
    `/_next/data/build-id/p/${secret}.json`,
    `/_next/data/build-id/p%2F${secret}.json`,
    `/_next/image?url=/p/${secret}`,
  ])('templates %s before it leaves the browser', (path) => {
    const clean = telemetryRoute(`https://mind.example.test${path}`);
    expect(clean).not.toContain(secret);
    expect(clean).not.toContain('session-id');
    expect(clean).not.toContain('client-id');
    expect(clean).not.toContain('?');
    expect(clean).not.toContain('#');
    expect(telemetryRoute(clean)).toBe(clean);
  });
  it('redacts URL and token strings in error prose', () => {
    const clean = redactTelemetryText(
      `Failed https://mind.example.test/p/${secret}?sig=${secret} Bearer ${secret} sig=${secret} /p/${secret}`,
    );
    expect(clean).not.toContain(secret);
  });
  it('retains static source-map locations without query strings', () => {
    expect(
      telemetryRoute(`https://mind.example.test/_next/static/chunks/app.js?token=${secret}`),
    ).toBe('/_next/static/chunks/app.js');
  });
  it('strips credential URLs, request payloads, custom contexts and free-form prose', () => {
    const url = `https://mind.example.test/p/${secret}?sig=${secret}`;
    const clean = scrubTelemetryEvent({
      event_id: 'diagnostic-id',
      message: secret,
      user: { email: secret },
      extra: { token: secret },
      request: {
        url,
        headers: { authorization: secret },
        cookies: secret,
        data: secret,
        query_string: secret,
      },
      contexts: { capture: { url, patient: secret }, custom: { token: secret } },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: secret,
            stacktrace: {
              frames: [
                { filename: url, lineno: 42, context_line: secret, vars: { token: secret } },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        { category: 'fetch', message: url, data: { url, args: [secret], body: secret } },
      ],
      spans: [{ description: url, data: { token: secret }, span_id: 'diagnostic-span' }],
    });
    expect(JSON.stringify(clean)).not.toContain(secret);
    expect(JSON.stringify(clean)).toContain('diagnostic-id');
    expect(JSON.stringify(clean)).toContain('42');
  });
  it('drops console breadcrumb arguments', () => {
    expect(
      JSON.stringify(scrubTelemetryBreadcrumb({ message: secret, data: { arguments: [secret] } })),
    ).not.toContain(secret);
  });
  it('hooks all three Sentry runtimes and transactions', () => {
    for (const runtime of ['server', 'client', 'edge']) {
      const source = readFileSync(
        new URL(`../sentry.${runtime}.config.ts`, import.meta.url),
        'utf8',
      );
      expect(source).toContain('beforeSend: scrubTelemetryEvent');
      expect(source).toContain('beforeSendTransaction: scrubTelemetryEvent');
      expect(source).toContain('beforeBreadcrumb: scrubTelemetryBreadcrumb');
    }
  });
});
