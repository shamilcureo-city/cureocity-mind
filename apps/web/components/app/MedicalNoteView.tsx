import type { ReactNode } from 'react';
import type {
  EvidenceRef,
  MedicalEncounterNoteV1,
  MedicalEvidenceField,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';

/**
 * Sprint DV3 — read view for a MedicalEncounterNoteV1 (the doctor
 * analogue of the therapy NotesTab). Pure presentation; strips the
 * dev-only [mock] tag the mock backend prepends. The physical exam shows
 * an explicit "Not examined" when the guard is unset, never a fabricated
 * normal. See docs/DOCTOR_VERTICAL.md §6, §10.
 */
const MOCK_TAG = /^\s*\[mock\]\s*/i;
function clean(s: string): string {
  return s.replace(MOCK_TAG, '').trim();
}

export function MedicalNoteView({ note }: { note: MedicalEncounterNoteV1 }) {
  const v = note.vitals;
  const vitalsLine = [
    v.bpSystolic && v.bpDiastolic ? `BP ${v.bpSystolic}/${v.bpDiastolic}` : null,
    v.heartRateBpm ? `HR ${v.heartRateBpm}` : null,
    v.respRateBpm ? `RR ${v.respRateBpm}` : null,
    v.tempCelsius ? `Temp ${v.tempCelsius}°C` : null,
    v.spo2Pct ? `SpO₂ ${v.spo2Pct}%` : null,
    v.weightKg ? `Wt ${v.weightKg} kg` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <div className="space-y-5">
      <Section label="Chief complaint" evidence={evidenceFor(note, 'chiefComplaint')}>
        {clean(note.chiefComplaint) || '—'}
      </Section>
      <Section label="History of present illness" evidence={evidenceFor(note, 'hpi')}>
        {clean(note.hpi) || '—'}
      </Section>

      {note.reviewOfSystems.length > 0 && (
        <Section label="Review of systems" evidence={evidenceFor(note, 'reviewOfSystems')}>
          <ul className="list-disc space-y-1 pl-5">
            {note.reviewOfSystems.map((r, i) => (
              <li key={i}>{clean(r)}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section label="Physical exam" evidence={evidenceFor(note, 'physicalExam')}>
        {note.physicalExam.examined ? (
          clean(note.physicalExam.findings) || '—'
        ) : (
          <span className="text-[var(--color-ink-3)]">Not examined this encounter.</span>
        )}
      </Section>

      {vitalsLine && (
        <Section label="Vitals" evidence={evidenceFor(note, 'vitals')}>
          {vitalsLine}
        </Section>
      )}

      <Section label="Assessment" evidence={evidenceFor(note, 'assessment')}>
        {clean(note.assessment) || '—'}
      </Section>
      <Section label="Plan" evidence={evidenceFor(note, 'plan')}>
        {clean(note.plan) || '—'}
      </Section>

      {note.linkedEvidence.some((e) => !e.field) && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
            Linked evidence
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {note.linkedEvidence
              .filter((e) => !e.field)
              .map((e, i) => (
                <EvidenceBadge key={i} evidence={e} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function evidenceFor(note: MedicalEncounterNoteV1, field: MedicalEvidenceField): EvidenceRef[] {
  return note.linkedEvidence.filter((e) => e.field === field);
}

function EvidenceBadge({ evidence }: { evidence: EvidenceRef }) {
  const timestamp = evidence.startMs !== undefined ? formatTimestamp(evidence.startMs) : null;
  return (
    <Badge tone="muted">
      {evidence.claim ? `${clean(evidence.claim)} — ` : ''}
      {evidence.quote ? `“${clean(evidence.quote).slice(0, 96)}”` : 'Source transcript'}
      {timestamp ? ` · ${timestamp}` : ''}
    </Badge>
  );
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function Section({
  label,
  children,
  evidence = [],
}: {
  label: string;
  children: ReactNode;
  evidence?: EvidenceRef[];
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        {label}
      </p>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink)]">
        {children}
      </div>
      {evidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${label} source evidence`}>
          {evidence.map((item, index) => (
            <EvidenceBadge
              key={`${item.segmentId ?? item.startMs ?? 'source'}:${index}`}
              evidence={item}
            />
          ))}
        </div>
      )}
    </div>
  );
}
