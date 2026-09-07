const DATABASE_ENV_ALIASES = [
  'DATABASE_URL',
  'DATABASE_RUNTIME_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
] as const;

// Do not allow URL parameters to override the authority/database we checked.
// These tuning parameters do not choose a different server or database.
const SAFE_QUERY_PARAMETERS = new Set([
  'schema',
  'connection_limit',
  'pool_timeout',
  'connect_timeout',
  'socket_timeout',
  'statement_cache_size',
  'pgbouncer',
  'sslmode',
]);

function checkUrl(name: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid disposable PostgreSQL URL.`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/cureocity_mind_test' ||
    url.hash
  ) {
    throw new Error(`${name} must target localhost or 127.0.0.1 database cureocity_mind_test.`);
  }
  for (const parameter of url.searchParams.keys()) {
    if (!SAFE_QUERY_PARAMETERS.has(parameter)) {
      throw new Error(`${name} contains a connection parameter not allowed for destructive tests.`);
    }
  }
}

/** Destructive test suites only. No network/DB access and no bypass option.
 * Return the checked DATABASE_URL so every test Prisma client can be pinned to
 * it. Reject remote aliases even though today's Nest services use DATABASE_URL:
 * web/runtime and migration clients have different URL precedence rules.
 * A loopback URL cannot prove the server is disposable (e.g. SSH tunnels);
 * the operator must still provision and verify a separate local test server. */
export function assertDisposableIntegrationDatabase(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (env['RUN_INTEGRATION_TESTS'] !== '1' || env['NODE_ENV'] === 'production') {
    throw new Error(
      'Destructive database tests require RUN_INTEGRATION_TESTS=1 outside production.',
    );
  }
  const primary = env['DATABASE_URL'];
  if (!primary?.trim()) throw new Error('DATABASE_URL is required for destructive database tests.');
  for (const name of DATABASE_ENV_ALIASES) {
    const value = env[name];
    if (value !== undefined) checkUrl(name, value);
  }
  return primary;
}
