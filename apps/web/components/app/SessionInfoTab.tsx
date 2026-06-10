import { Badge } from '../ui/Badge';

interface ConsentSnapshotEntry {
  scope: string;
  scriptVersion: string;
  ackedAt: string;
}

interface AuditEntry {
  id: string;
  action: string;
  actorType: string;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
}

interface SessionInfoData {
  id: string;
  modality: string;
  status: string;
  scheduledAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  consentSnapshot: ConsentSnapshotEntry[];
  audio: {
    chunkCount: number;
    totalSizeBytes: number;
    totalDurationMs: number;
  };
  auditTrail: AuditEntry[];
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatActionLabel(action: string): string {
  return action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function SessionInfoTab({ data }: { data: SessionInfoData }) {
  const elapsed =
    data.startedAt && data.endedAt
      ? data.endedAt.getTime() - data.startedAt.getTime()
      : null;
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Session
        </h3>
        <dl className="mt-4 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <Field label="Modality" value={data.modality} />
          <Field
            label="Status"
            valueNode={
              <Badge
                tone={
                  data.status === 'COMPLETED'
                    ? 'accent'
                    : data.status === 'IN_PROGRESS'
                      ? 'warn'
                      : 'muted'
                }
              >
                {data.status.replace(/_/g, ' ').toLowerCase()}
              </Badge>
            }
          />
          <Field
            label="Scheduled"
            value={data.scheduledAt.toLocaleString('en-IN', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          />
          <Field
            label="Recorded"
            value={
              elapsed !== null
                ? `${formatDuration(elapsed)} (${data.startedAt!.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} – ${data.endedAt!.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })})`
                : data.startedAt
                  ? 'Started, not ended'
                  : 'Not started'
            }
          />
          <Field label="Session ID" value={data.id.slice(0, 12) + '…'} mono />
          <Field
            label="Created"
            value={data.createdAt.toLocaleString('en-IN', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          />
        </dl>
      </section>

      <section className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Consent snapshot
        </h3>
        {data.consentSnapshot.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-ink-2)]">
            No consent snapshot captured for this session.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {data.consentSnapshot.map((c) => (
              <li
                key={`${c.scope}-${c.ackedAt}`}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line-soft)] pb-2 last:border-b-0"
              >
                <span className="font-medium">{c.scope.replace(/_/g, ' ')}</span>
                <span className="text-xs text-[var(--color-ink-3)]">
                  {c.scriptVersion} · {new Date(c.ackedAt).toLocaleString('en-IN')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Audio</h3>
        <dl className="mt-3 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-3">
          <Field label="Chunks" value={String(data.audio.chunkCount)} />
          <Field label="Total size" value={formatBytes(data.audio.totalSizeBytes)} />
          <Field label="Captured" value={formatDuration(data.audio.totalDurationMs)} />
        </dl>
      </section>

      <section className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Audit trail
        </h3>
        {data.auditTrail.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-ink-2)]">
            No audit events recorded for this session yet.
          </p>
        ) : (
          <ol className="mt-3 space-y-2 text-sm">
            {data.auditTrail.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--color-line-soft)] pb-2 last:border-b-0"
              >
                <span>{formatActionLabel(e.action)}</span>
                <span className="text-xs text-[var(--color-ink-3)]">
                  {e.actorType.toLowerCase()} ·{' '}
                  {e.createdAt.toLocaleString('en-IN', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  valueNode,
  mono,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{label}</dt>
      <dd className={`mt-1 text-[var(--color-ink)] ${mono ? 'font-mono text-xs' : ''}`}>
        {valueNode ?? value}
      </dd>
    </div>
  );
}
