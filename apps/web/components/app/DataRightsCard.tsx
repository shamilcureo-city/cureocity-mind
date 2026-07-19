'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input, Label, Select, Textarea } from '../ui/Field';

interface Props {
  clientId: string;
  clientName: string;
}

type ActiveForm = 'erasure' | 'correction' | 'nomination' | 'consent' | 'grievance' | null;

/**
 * Therapist-facing DPDP Data Rights surface. Therapist acts on
 * behalf of the client to fulfil rights received via email / phone /
 * in-person until the client-web PWA ships and clients can self-
 * serve. Each action audits as the appropriate DSR_* verb.
 */
export function DataRightsCard({ clientId, clientName }: Props) {
  const [exporting, setExporting] = useState(false);
  const [active, setActive] = useState<ActiveForm>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const exportData = useCallback(async () => {
    setExporting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/dsr/data-export`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dsr-export-${clientId.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage({ tone: 'ok', text: 'Export downloaded.' });
    } catch (e) {
      setMessage({ tone: 'warn', text: (e as Error).message });
    } finally {
      setExporting(false);
    }
  }, [clientId]);

  const post = useCallback(
    async (path: string, body: Record<string, unknown>, okText: string) => {
      setSubmitting(true);
      setMessage(null);
      try {
        const res = await fetch(`/api/v1/clients/${clientId}/dsr/${path}`, {
          method: path === 'correction' ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? `HTTP ${res.status}`);
        }
        setMessage({ tone: 'ok', text: okText });
        setActive(null);
      } catch (e) {
        setMessage({ tone: 'warn', text: (e as Error).message });
      } finally {
        setSubmitting(false);
      }
    },
    [clientId],
  );

  return (
    <Card className="p-6">
      <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
        Data rights (DPDP)
      </h3>
      <p className="mt-2 text-sm text-[var(--color-ink-2)]">
        Fulfil requests {clientName} makes under the DPDP Act. Every action here is recorded in the
        audit log.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={exportData} disabled={exporting}>
          {exporting ? 'Generating…' : '§ 11 Export data'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setActive(active === 'correction' ? null : 'correction')}
        >
          § 12 Correction
        </Button>
        <Button
          variant="secondary"
          onClick={() => setActive(active === 'nomination' ? null : 'nomination')}
        >
          § 13 Nomination
        </Button>
        <Button
          variant="secondary"
          onClick={() => setActive(active === 'consent' ? null : 'consent')}
        >
          § 13 Withdraw consent
        </Button>
        <Button
          variant="secondary"
          onClick={() => setActive(active === 'grievance' ? null : 'grievance')}
        >
          § 14 Grievance
        </Button>
        <Button
          variant="secondary"
          onClick={() => setActive(active === 'erasure' ? null : 'erasure')}
        >
          § 15 Erasure
        </Button>
      </div>

      {active === 'erasure' && (
        <ErasureForm
          submitting={submitting}
          onSubmit={(reason) =>
            post(
              'erasure',
              { reason },
              'Erasure request filed. Review queue at /app/admin/erasure-queue.',
            )
          }
        />
      )}
      {active === 'correction' && (
        <CorrectionForm
          submitting={submitting}
          onSubmit={(d) =>
            post(
              'correction',
              d,
              `Correction applied: ${Object.keys(d)
                .filter((k) => k !== 'reason')
                .join(', ')}.`,
            )
          }
        />
      )}
      {active === 'nomination' && (
        <NominationForm
          submitting={submitting}
          onSubmit={(d) =>
            post('nomination', d, 'Nomination recorded. Prior nomination (if any) superseded.')
          }
        />
      )}
      {active === 'consent' && (
        <ConsentWithdrawalForm
          submitting={submitting}
          onSubmit={(d) =>
            post(
              'consent-withdrawal',
              d,
              `Consent for ${d.scope} withdrawn. Future processing for that scope blocked.`,
            )
          }
        />
      )}
      {active === 'grievance' && (
        <GrievanceForm
          submitting={submitting}
          onSubmit={(d) =>
            post('grievance', d, 'Grievance filed at status OPEN. Acknowledge per redressal SLA.')
          }
        />
      )}

      {message && (
        <p
          className={`mt-4 text-sm ${
            message.tone === 'ok' ? 'text-[var(--color-ink-2)]' : 'text-[var(--color-warn)]'
          }`}
        >
          {message.text}
        </p>
      )}
    </Card>
  );
}

function ErasureForm({
  submitting,
  onSubmit,
}: {
  submitting: boolean;
  onSubmit: (reason: string | undefined) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason || undefined);
      }}
      className="mt-4 space-y-3"
    >
      <div>
        <Label htmlFor="er-reason" hint="Optional · 0–2000 chars">
          Reason supplied by the client
        </Label>
        <Textarea
          id="er-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Filing…' : 'File erasure request'}
        </Button>
      </div>
    </form>
  );
}

function CorrectionForm({
  submitting,
  onSubmit,
}: {
  submitting: boolean;
  onSubmit: (d: Record<string, string>) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const d: Record<string, string> = { reason };
        if (fullName) d['fullName'] = fullName;
        if (contactPhone) d['contactPhone'] = contactPhone;
        if (contactEmail) d['contactEmail'] = contactEmail;
        onSubmit(d);
      }}
      className="mt-4 space-y-3"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="co-name" hint="leave blank to skip">
            New full name
          </Label>
          <Input id="co-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="co-phone" hint="leave blank to skip">
            New phone
          </Label>
          <Input
            id="co-phone"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="co-email" hint="leave blank to skip">
            New email
          </Label>
          <Input
            id="co-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="co-reason">Reason for correction</Label>
        <Textarea
          id="co-reason"
          rows={2}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Client legally changed surname after marriage."
        />
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={submitting || (!fullName && !contactPhone && !contactEmail)}
        >
          {submitting ? 'Applying…' : 'Apply correction'}
        </Button>
      </div>
    </form>
  );
}

function NominationForm({
  submitting,
  onSubmit,
}: {
  submitting: boolean;
  onSubmit: (d: Record<string, string>) => void;
}) {
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('+91');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <form
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const d: Record<string, string> = {
          nomineeName: name,
          nomineeRelation: relation,
          nomineePhone: phone,
        };
        if (email) d['nomineeEmail'] = email;
        if (notes) d['notes'] = notes;
        onSubmit(d);
      }}
      className="mt-4 space-y-3"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="nm-name">Nominee name</Label>
          <Input id="nm-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="nm-relation">Relation</Label>
          <Input
            id="nm-relation"
            required
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
            placeholder="spouse, parent, sibling…"
          />
        </div>
        <div>
          <Label htmlFor="nm-phone">Nominee phone</Label>
          <Input
            id="nm-phone"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+919876543210"
          />
        </div>
        <div>
          <Label htmlFor="nm-email" hint="optional">
            Nominee email
          </Label>
          <Input
            id="nm-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="nm-notes" hint="optional · scope/conditions">
          Notes
        </Label>
        <Textarea
          id="nm-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Authority limited to medical incapacity."
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Recording…' : 'Record nomination'}
        </Button>
      </div>
    </form>
  );
}

function ConsentWithdrawalForm({
  submitting,
  onSubmit,
}: {
  submitting: boolean;
  onSubmit: (d: { scope: string; reason?: string }) => void;
}) {
  const [scope, setScope] = useState('AI_NOTE_GENERATION');
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        onSubmit(reason ? { scope, reason } : { scope });
      }}
      className="mt-4 space-y-3"
    >
      <div>
        <Label htmlFor="cw-scope">Scope to withdraw</Label>
        <Select id="cw-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="AUDIO_RECORDING">AUDIO_RECORDING</option>
          <option value="AI_NOTE_GENERATION">AI_NOTE_GENERATION</option>
          <option value="CROSS_BORDER_PROCESSING">CROSS_BORDER_PROCESSING</option>
          <option value="DATA_RETENTION_EXTENDED">DATA_RETENTION_EXTENDED</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="cw-reason" hint="optional">
          Reason
        </Label>
        <Textarea
          id="cw-reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <p className="text-xs text-[var(--color-ink-3)]">
        Withdrawal is not retroactive per DPDP. Past processing under this scope remains lawful; no
        further processing under this scope is permitted from now on.
      </p>
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Withdrawing…' : 'Withdraw consent'}
        </Button>
      </div>
    </form>
  );
}

function GrievanceForm({
  submitting,
  onSubmit,
}: {
  submitting: boolean;
  onSubmit: (d: { subject: string; body: string }) => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  return (
    <form
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        onSubmit({ subject, body });
      }}
      className="mt-4 space-y-3"
    >
      <div>
        <Label htmlFor="gr-subject">Subject</Label>
        <Input
          id="gr-subject"
          required
          maxLength={200}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="gr-body">Grievance body</Label>
        <Textarea
          id="gr-body"
          required
          rows={4}
          maxLength={10_000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Filing…' : 'File grievance'}
        </Button>
      </div>
    </form>
  );
}
