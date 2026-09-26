'use client';

import type { ReactNode } from 'react';
import type {
  EvidenceRef,
  MedicalEncounterNoteV1,
  MedicalEvidenceField,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { useScribeNoteStyle } from '@/lib/use-scribe-personalization';
import { noteEditValue } from '@/lib/note-edit-value';

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

export function MedicalNoteView({
  note,
  baseline,
  onReviewSource,
}: {
  note: MedicalEncounterNoteV1;
  baseline?: MedicalEncounterNoteV1;
  onReviewSource?: (field: MedicalEvidenceField) => void;
}) {
  const { style } = useScribeNoteStyle();
  const profile =
    style[
      note.encounterKind === 'FOLLOW_UP' || note.encounterKind === 'REVIEW_REPORTS'
        ? 'followUp'
        : 'firstVisit'
    ];
  const v = note.vitals;
  const vitalsLine = [
    v.bpSystolic !== undefined && v.bpDiastolic !== undefined
      ? `BP ${v.bpSystolic}/${v.bpDiastolic}`
      : v.bpSystolic !== undefined
        ? `BP systolic ${v.bpSystolic}`
        : v.bpDiastolic !== undefined
          ? `BP diastolic ${v.bpDiastolic}`
          : null,
    v.heartRateBpm !== undefined ? `HR ${v.heartRateBpm}` : null,
    v.respRateBpm !== undefined ? `RR ${v.respRateBpm}` : null,
    v.tempCelsius !== undefined ? `Temp ${v.tempCelsius}°C` : null,
    v.spo2Pct !== undefined ? `SpO₂ ${v.spo2Pct}%` : null,
    v.weightKg !== undefined ? `Wt ${v.weightKg} kg` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const sections: Record<MedicalEvidenceField, ReactNode> = {
    chiefComplaint: (
      <Section label={profile.labels.chiefComplaint} evidence={evidenceFor(note, 'chiefComplaint')}>
        {clean(note.chiefComplaint) || '—'}
      </Section>
    ),
    hpi: (
      <Section label={profile.labels.hpi} evidence={evidenceFor(note, 'hpi')}>
        {clean(note.hpi) || '—'}
      </Section>
    ),
    reviewOfSystems: (
      <Section
        label={profile.labels.reviewOfSystems}
        evidence={evidenceFor(note, 'reviewOfSystems')}
      >
        {note.reviewOfSystems.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5">
            {note.reviewOfSystems.map((r, i) => (
              <li key={i}>{clean(r)}</li>
            ))}
          </ul>
        ) : (
          'Not recorded.'
        )}
      </Section>
    ),
    physicalExam: (
      <Section label={profile.labels.physicalExam} evidence={evidenceFor(note, 'physicalExam')}>
        {note.physicalExam.examined ? (
          clean(note.physicalExam.findings) || '—'
        ) : (
          <span className="text-[var(--color-ink-3)]">Not examined this encounter.</span>
        )}
      </Section>
    ),
    vitals: (
      <Section label={profile.labels.vitals} evidence={evidenceFor(note, 'vitals')}>
        {vitalsLine || 'Not recorded.'}
      </Section>
    ),
    assessment: (
      <Section label={profile.labels.assessment} evidence={evidenceFor(note, 'assessment')}>
        {clean(note.assessment) || '—'}
      </Section>
    ),
    plan: (
      <Section label={profile.labels.plan} evidence={evidenceFor(note, 'plan')}>
        {clean(note.plan) || '—'}
      </Section>
    ),
  };

  return (
    <div className={profile.density === 'concise' ? 'space-y-3' : 'space-y-6'}>
      {profile.order.map((field) => (
        <div key={field}>
          {sections[field]}
          {baseline &&
            noteEditValue(baseline, field) !== noteEditValue(note, field) &&
            evidenceFor(note, field).length > 0 && (
              <p className="mt-2 text-xs text-[var(--color-warn)]">
                Original draft references: this section has been edited. These links do not verify
                your correction.
              </p>
            )}
          {onReviewSource && (
            <button
              type="button"
              className="mt-1 min-h-11 rounded-lg px-2 text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              aria-label={`Compare ${profile.labels[field]} with saved source`}
              onClick={() => onReviewSource(field)}
            >
              Check source
            </button>
          )}
        </div>
      ))}

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
