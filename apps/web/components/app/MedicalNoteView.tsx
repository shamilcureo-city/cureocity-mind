import type { ReactNode } from 'react';
import type { MedicalEncounterNoteV1 } from '@cureocity/contracts';
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
      <Section label="Chief complaint">{clean(note.chiefComplaint) || '—'}</Section>
      <Section label="History of present illness">{clean(note.hpi) || '—'}</Section>

      {note.reviewOfSystems.length > 0 && (
        <Section label="Review of systems">
          <ul className="list-disc space-y-1 pl-5">
            {note.reviewOfSystems.map((r, i) => (
              <li key={i}>{clean(r)}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section label="Physical exam">
        {note.physicalExam.examined ? (
          clean(note.physicalExam.findings) || '—'
        ) : (
          <span className="text-[var(--color-ink-3)]">Not examined this encounter.</span>
        )}
      </Section>

      {vitalsLine && <Section label="Vitals">{vitalsLine}</Section>}

      <Section label="Assessment">{clean(note.assessment) || '—'}</Section>
      <Section label="Plan">{clean(note.plan) || '—'}</Section>

      {note.linkedEvidence.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
            Linked evidence
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {note.linkedEvidence.map((e, i) => (
              <Badge key={i} tone="muted">
                {e.quote ? `“${clean(e.quote).slice(0, 48)}”` : `@ ${e.startMs ?? 0} ms`}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        {label}
      </p>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink)]">
        {children}
      </div>
    </div>
  );
}
