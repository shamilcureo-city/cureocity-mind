/** Safe in both browser and server bundles. Never send bearer-link locations. */
export function telemetryRoute(value: string): string {
  try {
    const path = new URL(value, 'https://redacted.invalid').pathname;
    // A route template is enough to diagnose a private-page failure. Do not
    // preserve identifiers, query strings, fragments or unknown path segments.
    if (/^\/(?:api\/v1\/)?p(?:\/|$)/.test(path)) return '/p/[private]';
    if (/^\/(?:api\/v1\/)?(?:claim|claim-tokens)(?:\/|$)/.test(path)) return '/claim/[private]';
    // Next data URLs can embed the same bearer token as the private page.
    // Only static chunk assets are safe to retain for source-map diagnostics.
    if (path.startsWith('/_next/static/')) return path;
    if (path.startsWith('/_next/')) return '/_next/[private]';
    if (/^\/(?:login|onboarding|account-status|app|console)\/?$/.test(path)) return path;
    const segments = path.split('/').filter(Boolean);
    const known = new Set([
      'api',
      'v1',
      'app',
      'console',
      'public',
      'care',
      'sessions',
      'clients',
      'patients',
      'appointments',
      'reception',
      'therapists',
      'video',
      'join',
      'cancel',
      'home',
      'today',
      'record',
      'note',
      'notes',
      'sign',
      'share',
      'shares',
      'checkin',
      'homework',
      'auth',
      'session',
      'signout',
      'observability',
      'client-error',
    ]);
    return '/' + segments.map((segment) => (known.has(segment) ? segment : '[private]')).join('/');
  } catch {
    return '[private-url]';
  }
}

/** Defense in depth for credentials embedded inside diagnostic strings. */
export function redactTelemetryText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => telemetryRoute(url))
    .replace(/\/(?:api\/v1\/)?(?:p|claim|claim-tokens)\/[^\s<>"']+/g, (url) => telemetryRoute(url))
    .replace(/Bearer\s+[^\s<>"']+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(
      /\b(token|sig|signature|authorization|cookie|secret)=([^\s&<>"']+)/gi,
      '$1=[redacted]',
    );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const safeLabel = (value: unknown) =>
  typeof value === 'string' ? redactTelemetryText(value).slice(0, 200) : undefined;

/** Explicitly allow diagnostic fields, never raw body, cookies or console args. */
export function scrubTelemetryBreadcrumb<T>(breadcrumb: T): T {
  const b = record(breadcrumb);
  const data = record(b['data']);
  return {
    type: safeLabel(b['type']),
    category: safeLabel(b['category']),
    level: safeLabel(b['level']),
    timestamp: b['timestamp'],
    data: {
      ...(typeof data['url'] === 'string' && { url: telemetryRoute(data['url']) }),
      ...(typeof data['from'] === 'string' && { from: telemetryRoute(data['from']) }),
      ...(typeof data['to'] === 'string' && { to: telemetryRoute(data['to']) }),
      method: safeLabel(data['method']),
      status_code: data['status_code'],
    },
  } as T;
}

/**
 * Sentry hook for errors AND transactions. Custom contexts/extra and exception
 * prose can contain patient content; retain route, digest and stack positions
 * instead. sendDefaultPii=false alone does not scrub these explicit fields.
 */
export function scrubTelemetryEvent<T>(event: T): T {
  const e = record(event);
  const request = record(e['request']);
  const contexts = record(e['contexts']);
  const capture = record(contexts['capture']);
  const trace = record(contexts['trace']);
  const exception = record(e['exception']);
  const tags = record(e['tags']);
  const values = Array.isArray(exception['values']) ? exception['values'] : [];
  const result = {
    ...e,
    message: e['message'] === undefined ? undefined : 'Error details withheld',
    logentry: undefined,
    user: undefined,
    extra: undefined,
    server_name: undefined,
    transaction:
      typeof e['transaction'] === 'string' ? telemetryRoute(e['transaction']) : undefined,
    request: {
      method: safeLabel(request['method']),
      ...(typeof request['url'] === 'string' && { url: telemetryRoute(request['url']) }),
    },
    tags: {
      source: safeLabel(tags['source']),
      route: typeof tags['route'] === 'string' ? telemetryRoute(tags['route']) : undefined,
      method: safeLabel(tags['method']),
    },
    contexts: {
      trace: {
        trace_id: trace['trace_id'],
        span_id: trace['span_id'],
        parent_span_id: trace['parent_span_id'],
        op: safeLabel(trace['op']),
        status: safeLabel(trace['status']),
      },
      capture: {
        source: safeLabel(capture['source']),
        digest: safeLabel(capture['digest']),
        url: typeof capture['url'] === 'string' ? telemetryRoute(capture['url']) : undefined,
      },
    },
    breadcrumbs: Array.isArray(e['breadcrumbs'])
      ? e['breadcrumbs'].map(scrubTelemetryBreadcrumb)
      : undefined,
    exception: {
      values: values.map((entry: unknown) => {
        const value = record(entry);
        const stack = record(value['stacktrace']);
        const frames = Array.isArray(stack['frames']) ? stack['frames'] : [];
        return {
          type: safeLabel(value['type']),
          value: 'Error details withheld',
          stacktrace: {
            frames: frames.map((entry: unknown) => {
              const frame = record(entry);
              return {
                filename:
                  typeof frame['filename'] === 'string'
                    ? telemetryRoute(frame['filename'])
                    : undefined,
                function: safeLabel(frame['function']),
                lineno: frame['lineno'],
                colno: frame['colno'],
                in_app: frame['in_app'],
              };
            }),
          },
        };
      }),
    },
    spans: Array.isArray(e['spans'])
      ? e['spans'].map((entry: unknown) => {
          const span = record(entry);
          return { ...span, description: undefined, data: undefined, tags: undefined };
        })
      : undefined,
  };
  return result as T;
}
