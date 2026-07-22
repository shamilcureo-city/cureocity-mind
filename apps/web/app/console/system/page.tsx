import {
  AdminPageHeader,
  StatGrid,
  StatTile,
  AdminCard,
  DefRow,
  Pill,
  PresenceBadge,
  Table,
  Thead,
  Tr,
  Td,
} from '@/components/console/AdminUI';
import { requirePageAdmin } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

/**
 * Admin · System — the deployment config topology rendered inline.
 *
 * Mirrors what `GET /api/v1/health?token=…` reports (env presence, flags,
 * backend names) so an operator can answer "is this deploy actually wired?"
 * without reading logs. It reads `process.env` server-side and shows ONLY
 * booleans / backend-names / public URLs via PresenceBadge + Pill — NEVER a
 * secret value. No DB reads, no mutations, no external calls.
 */

// Small env accessors (kept off the guessing path — every key here is a real
// var referenced elsewhere in the codebase).
const env = (k: string): string | undefined => process.env[k];
const isTrue = (k: string): boolean => process.env[k] === 'true';
const present = (k: string): boolean => Boolean(process.env[k]);

/** A yes/no flag pill where "on" is the desirable posture (good) vs muted. */
function FlagPill({
  on,
  onText = 'on',
  offText = 'off',
}: {
  on: boolean;
  onText?: string;
  offText?: string;
}) {
  return on ? <Pill tone="good">{onText}</Pill> : <Pill tone="muted">{offText}</Pill>;
}

/** A yes/no flag pill where "on" is a caution (warn) — escape hatches, etc. */
function RiskPill({
  on,
  onText = 'on',
  offText = 'off',
}: {
  on: boolean;
  onText?: string;
  offText?: string;
}) {
  return on ? <Pill tone="warn">{onText}</Pill> : <Pill tone="good">{offText}</Pill>;
}

const Mono = ({ children }: { children: string }) => (
  <span className="font-mono text-xs break-all text-[var(--color-ink)]">{children}</span>
);

const CRONS: { path: string; schedule: string; note: string }[] = [
  {
    path: '/api/v1/cron/audio-retention',
    schedule: '0 3 * * *',
    note: 'Purge expired session audio',
  },
  {
    path: '/api/v1/cron/billing-reminders',
    schedule: '30 3 * * *',
    note: 'Renewal / dunning reminders',
  },
  {
    path: '/api/v1/cron/reclaim-stuck',
    schedule: '15 * * * *',
    note: 'Reclaim stuck IN_PROGRESS sessions',
  },
  {
    path: '/api/v1/cron/unsigned-digest',
    schedule: '30 2 * * *',
    note: 'Unsigned-note nudge digest',
  },
  {
    path: '/api/v1/cron/care-session-sweeper',
    schedule: '*/30 * * * *',
    note: 'Close abandoned Care sessions',
  },
  {
    path: '/api/v1/cron/care-nudges',
    schedule: '0 * * * *',
    note: 'Care habit / re-engagement nudges',
  },
];

export default async function AdminSystemPage() {
  await requirePageAdmin();
  const vercelEnv = env('VERCEL_ENV') ?? 'local';
  const isProd = vercelEnv === 'production';
  const nodeEnv = env('NODE_ENV') ?? '—';
  const dbSet = present('DATABASE_URL') || present('POSTGRES_PRISMA_URL');

  const bypassOn = isTrue('AUTH_BYPASS');

  const llmBackend = env('LLM_BACKEND') ?? 'mock';
  const kmsBackend = env('KMS_BACKEND') ?? 'local-dev';
  const billingBackend = env('BILLING_BACKEND') ?? 'mock';
  const billingEnforcement = env('BILLING_ENFORCEMENT') ?? 'on';
  const careLiveBackend = env('CARE_LIVE_BACKEND') ?? 'mock';
  const careOpen = isTrue('CARE_SIGNUPS_OPEN');

  const flashModel = env('VERTEX_FLASH_MODEL') ?? 'gemini-2.5-flash';
  const proModel = env('VERTEX_PRO_MODEL') ?? 'gemini-2.5-pro';
  const gatewayUrl = env('NEXT_PUBLIC_LIVE_GATEWAY_URL') ?? 'ws://localhost:8787';

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="System"
        description="Deployment config topology — env presence, feature flags, backends, and crons. Presence and backend-names only; no secret value is ever rendered. Mirrors the /api/v1/health config readout."
        right={
          <a
            href="/api/v1/health?token="
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            Live health JSON →
          </a>
        }
      />

      <StatGrid>
        <StatTile label="Environment" value={vercelEnv} tone="accent" sub={`NODE_ENV ${nodeEnv}`} />
        <StatTile
          label="LLM backend"
          value={llmBackend}
          tone={llmBackend === 'vertex' ? 'good' : 'warn'}
        />
        <StatTile
          label="KMS backend"
          value={kmsBackend}
          tone={kmsBackend === 'gcp-kms' ? 'good' : 'warn'}
        />
        <StatTile
          label="Auth bypass"
          value={bypassOn ? 'ON' : 'off'}
          tone={bypassOn ? (isProd ? 'danger' : 'warn') : 'good'}
          sub={bypassOn ? 'seeded dev fixture resolves all requests' : 'real Firebase auth'}
        />
      </StatGrid>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <AdminCard
          title="Runtime"
          hint="Where this instance is deployed and whether the DB is wired."
        >
          <DefRow label="VERCEL_ENV">
            <Pill tone={isProd ? 'accent' : 'muted'}>{vercelEnv}</Pill>
          </DefRow>
          <DefRow label="NODE_ENV">
            <Pill tone="muted">{nodeEnv}</Pill>
          </DefRow>
          <DefRow label="Database URL">
            <PresenceBadge set={dbSet} okText="wired" missingText="unset" />
          </DefRow>
        </AdminCard>

        <AdminCard title="Auth" hint="Firebase admin creds + the guards that gate access.">
          <DefRow label="FIREBASE_PROJECT_ID">
            <PresenceBadge set={present('FIREBASE_PROJECT_ID')} />
          </DefRow>
          <DefRow label="FIREBASE_CLIENT_EMAIL">
            <PresenceBadge set={present('FIREBASE_CLIENT_EMAIL')} />
          </DefRow>
          <DefRow label="FIREBASE_PRIVATE_KEY">
            <PresenceBadge set={present('FIREBASE_PRIVATE_KEY')} />
          </DefRow>
          <DefRow label="AUTH_BYPASS">
            {bypassOn ? (
              isProd ? (
                <Pill tone="danger">ON</Pill>
              ) : (
                <Pill tone="warn">on</Pill>
              )
            ) : (
              <Pill tone="good">off</Pill>
            )}
          </DefRow>
          <DefRow label="PILOT_INVITE_REQUIRED">
            <FlagPill on={isTrue('PILOT_INVITE_REQUIRED')} />
          </DefRow>
          <DefRow label="REQUIRE_WEBAUTHN_SIGNING">
            <FlagPill on={isTrue('REQUIRE_WEBAUTHN_SIGNING')} />
          </DefRow>
          <DefRow label="BOOTSTRAP_ADMIN_EMAILS">
            <PresenceBadge set={present('BOOTSTRAP_ADMIN_EMAILS')} />
          </DefRow>
        </AdminCard>

        <AdminCard
          title="AI backend"
          hint="Which Gemini path serves clinical content + the model pins."
        >
          <DefRow label="LLM_BACKEND">
            <Pill
              tone={llmBackend === 'vertex' ? 'good' : llmBackend === 'mock' ? 'warn' : 'muted'}
            >
              {llmBackend}
            </Pill>
          </DefRow>
          <DefRow label="ALLOW_MOCK_LLM">
            <RiskPill on={isTrue('ALLOW_MOCK_LLM')} />
          </DefRow>
          <DefRow label="VERTEX_PROJECT_ID">
            <PresenceBadge set={present('VERTEX_PROJECT_ID')} />
          </DefRow>
          <DefRow label="VERTEX_FLASH_MODEL">
            <Mono>{flashModel}</Mono>
          </DefRow>
          <DefRow label="VERTEX_PRO_MODEL">
            <Mono>{proModel}</Mono>
          </DefRow>
        </AdminCard>

        <AdminCard title="Crypto" hint="Envelope encryption backend for Client PII.">
          <DefRow label="KMS_BACKEND">
            <Pill tone={kmsBackend === 'gcp-kms' ? 'good' : 'warn'}>{kmsBackend}</Pill>
          </DefRow>
          <DefRow label="GCP_KMS_KEY_NAME">
            <PresenceBadge set={present('GCP_KMS_KEY_NAME')} />
          </DefRow>
        </AdminCard>

        <AdminCard title="Billing" hint="Razorpay backend + trial/plan-cap enforcement.">
          <DefRow label="BILLING_BACKEND">
            <Pill
              tone={
                billingBackend === 'razorpay'
                  ? 'good'
                  : billingBackend === 'mock'
                    ? 'warn'
                    : 'muted'
              }
            >
              {billingBackend}
            </Pill>
          </DefRow>
          <DefRow label="BILLING_ENFORCEMENT">
            <Pill tone={billingEnforcement.toLowerCase() === 'off' ? 'warn' : 'good'}>
              {billingEnforcement}
            </Pill>
          </DefRow>
          <DefRow label="RAZORPAY_KEY_ID">
            <PresenceBadge set={present('RAZORPAY_KEY_ID')} />
          </DefRow>
          <DefRow label="RAZORPAY_WEBHOOK_SECRET">
            <PresenceBadge set={present('RAZORPAY_WEBHOOK_SECRET')} />
          </DefRow>
        </AdminCard>

        <AdminCard title="Notifications" hint="Outbound channel adapters.">
          <DefRow label="SENDGRID_API_KEY">
            <PresenceBadge set={present('SENDGRID_API_KEY')} />
          </DefRow>
          <DefRow label="WATI_BEARER_TOKEN">
            <PresenceBadge set={present('WATI_BEARER_TOKEN')} />
          </DefRow>
        </AdminCard>

        <AdminCard
          title="Observability"
          hint="Error + trace forwarding, plus the ops-endpoint tokens."
        >
          <DefRow label="SENTRY_DSN">
            <PresenceBadge set={present('SENTRY_DSN')} />
          </DefRow>
          <DefRow label="OTEL_EXPORTER_OTLP_ENDPOINT">
            <PresenceBadge set={present('OTEL_EXPORTER_OTLP_ENDPOINT')} />
          </DefRow>
          <DefRow label="HEALTH_CHECK_TOKEN">
            <PresenceBadge set={present('HEALTH_CHECK_TOKEN')} />
          </DefRow>
          <DefRow label="CRON_SECRET">
            <PresenceBadge set={present('CRON_SECRET')} />
          </DefRow>
        </AdminCard>

        <AdminCard title="Live gateway (doctor)" hint="Standalone WebSocket consult runtime.">
          <DefRow label="NEXT_PUBLIC_LIVE_GATEWAY_URL">
            <Mono>{gatewayUrl}</Mono>
          </DefRow>
          <DefRow label="LIVE_GATEWAY_SECRET">
            <PresenceBadge set={present('LIVE_GATEWAY_SECRET')} />
          </DefRow>
        </AdminCard>

        <AdminCard title="Care" hint="Consumer AI-therapist product gate + live backend.">
          <DefRow label="CARE_SIGNUPS_OPEN">
            {careOpen ? <Pill tone="good">open</Pill> : <Pill tone="warn">waitlist</Pill>}
          </DefRow>
          <DefRow label="CARE_LIVE_BACKEND">
            <Pill tone={careLiveBackend === 'mock' ? 'warn' : 'good'}>{careLiveBackend}</Pill>
          </DefRow>
        </AdminCard>
      </div>

      <AdminCard
        title="Cron schedules"
        hint="Declared in apps/web/vercel.json. Each authenticates via CRON_SECRET (Authorization: Bearer) or Vercel's x-vercel-cron header — see the Observability card for the secret's presence."
        className="mt-4"
      >
        <Table>
          <Thead
            cols={[
              { label: 'Job' },
              { label: 'Path' },
              { label: 'Schedule (UTC)', align: 'right' },
            ]}
          />
          <tbody>
            {CRONS.map((c) => (
              <Tr key={c.path}>
                <Td>{c.note}</Td>
                <Td>
                  <Mono>{c.path}</Mono>
                </Td>
                <Td align="right" nums>
                  <Mono>{c.schedule}</Mono>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </AdminCard>
    </>
  );
}
