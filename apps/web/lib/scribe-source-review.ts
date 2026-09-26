import {
  MedicalEncounterNoteV1Schema,
  type EvidenceRef,
  type MedicalEncounterNoteV1,
  type MedicalEvidenceField,
} from '@cureocity/contracts';
import { canonicalJson } from './sign-note-payload';

export type ScribeSourceSnapshot = {
  draftId: string;
  version: string;
  draftContent: MedicalEncounterNoteV1;
  transcript: string | null;
  sourceState: 'available' | 'empty' | 'unavailable' | 'quarantined';
  sourceMessage: string | null;
};

export const SOURCE_REVIEW_FIELDS: readonly { field: MedicalEvidenceField; label: string }[] = [
  { field: 'chiefComplaint', label: 'Chief complaint' },
  { field: 'hpi', label: 'History of present illness' },
  { field: 'reviewOfSystems', label: 'Review of systems' },
  { field: 'physicalExam', label: 'Physical examination' },
  { field: 'vitals', label: 'Vitals' },
  { field: 'assessment', label: 'Assessment' },
  { field: 'plan', label: 'Plan' },
];

/** Validate a fetched snapshot without allowing a failed/quarantined source to carry text. */
export function parseScribeSourceSnapshot(value: unknown): ScribeSourceSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const identifier = (input: unknown): input is string =>
    typeof input === 'string' && input.length > 0 && input.trim() === input;
  if (
    !identifier(row.draftId) ||
    !identifier(row.version) ||
    !(row.sourceMessage === null || typeof row.sourceMessage === 'string')
  )
    return null;
  const note = MedicalEncounterNoteV1Schema.safeParse(row.draftContent);
  if (!note.success) return null;
  let transcript: string | null;
  const sourceState = row.sourceState;
  if (sourceState === 'available') {
    if (typeof row.transcript !== 'string' || !row.transcript.trim()) return null;
    transcript = row.transcript;
  } else if (sourceState === 'empty') {
    if (row.transcript !== null && row.transcript !== '') return null;
    transcript = '';
  } else if (sourceState === 'unavailable' || sourceState === 'quarantined') {
    if (row.transcript !== null) return null;
    transcript = null;
  } else return null;
  return {
    draftId: row.draftId,
    version: row.version,
    draftContent: note.data,
    transcript,
    sourceState,
    sourceMessage: row.sourceMessage,
  };
}

/** Content identity, not a signature: retains all fields, evidence links and array ordering. */
export function sourceNoteIdentity(note: MedicalEncounterNoteV1): string {
  return canonicalJson(note);
}

/** Plain saved values, including contradictions between the exam flag and its findings. */
export function sourceFieldText(note: MedicalEncounterNoteV1, field: MedicalEvidenceField): string {
  if (field === 'reviewOfSystems') return note.reviewOfSystems.join('\n');
  if (field === 'physicalExam')
    return [note.physicalExam.examined ? 'Examined' : 'Not examined', note.physicalExam.findings]
      .filter((value) => value.length > 0)
      .join('\n');
  if (field === 'vitals') {
    const fields: readonly [keyof MedicalEncounterNoteV1['vitals'], string, string][] = [
      ['bpSystolic', 'BP systolic', 'mmHg'],
      ['bpDiastolic', 'BP diastolic', 'mmHg'],
      ['heartRateBpm', 'Heart rate', 'bpm'],
      ['respRateBpm', 'Respiratory rate', 'breaths/min'],
      ['tempCelsius', 'Temperature', '°C'],
      ['spo2Pct', 'SpO₂', '%'],
      ['weightKg', 'Weight', 'kg'],
    ];
    return fields
      .flatMap(([key, label, unit]) =>
        note.vitals[key] === undefined ? [] : [`${label}: ${note.vitals[key]} ${unit}`],
      )
      .join('\n');
  }
  return note[field];
}

export type SourceEvidenceResolution = {
  status: 'located' | 'not_found' | 'no_quote' | 'source_unavailable';
  /** Original UTF-16 offsets: transcript.slice(start, end); end is exclusive. */
  matches: { start: number; end: number }[];
  /** Work or result limit reached; never present the result as an exhaustive search. */
  truncated?: boolean;
};

const MAX_MATCHES = 50;
const MAX_TRANSCRIPT_UNITS = 1_000_000;
const MAX_QUOTE_UNITS = 16_384;
const whitespace = /\s/u;

/**
 * Locate quoted text only. A match does not establish that the linked claim is
 * true, complete, correctly attributed, or supported in context. No IDs, times,
 * case-folding, punctuation removal, Unicode normalization or fuzzy matching.
 * Only whitespace runs are folded; returned offsets always address the source.
 */
export function resolveSourceEvidence(
  evidence: EvidenceRef,
  transcript: string | null,
): SourceEvidenceResolution {
  const rawQuote = evidence.quote;
  if (rawQuote === undefined || rawQuote.length === 0) return { status: 'no_quote', matches: [] };
  if (rawQuote.length > MAX_QUOTE_UNITS)
    return { status: 'source_unavailable', matches: [], truncated: true };
  const quote = rawQuote.replace(/\s+/gu, ' ').trim();
  if (!quote) return { status: 'no_quote', matches: [] };
  if (transcript === null || transcript.length === 0)
    return { status: 'source_unavailable', matches: [] };
  if (transcript.length > MAX_TRANSCRIPT_UNITS)
    return { status: 'source_unavailable', matches: [], truncated: true };
  if (!transcript.trim()) return { status: 'source_unavailable', matches: [] };

  // KMP bounds scanning to O(source + quote), including repetitive input.
  // A quote-sized ring tracks source offsets without copying the transcript.
  const prefix = new Uint32Array(quote.length);
  for (let index = 1, matched = 0; index < quote.length; index += 1) {
    while (matched > 0 && quote[index] !== quote[matched]) matched = prefix[matched - 1];
    if (quote[index] === quote[matched]) matched += 1;
    prefix[index] = matched;
  }
  const starts = new Uint32Array(quote.length);
  const matches: SourceEvidenceResolution['matches'] = [];
  let matched = 0;
  let normalizedIndex = 0;
  for (let index = 0; index < transcript.length; ) {
    const start = index;
    let character = transcript[index++];
    if (whitespace.test(character)) {
      character = ' ';
      while (index < transcript.length && whitespace.test(transcript[index])) index += 1;
    }
    starts[normalizedIndex % quote.length] = start;
    while (matched > 0 && character !== quote[matched]) matched = prefix[matched - 1];
    if (character === quote[matched]) matched += 1;
    if (matched === quote.length) {
      if (matches.length === MAX_MATCHES) return { status: 'located', matches, truncated: true };
      matches.push({
        start: starts[(normalizedIndex - quote.length + 1) % quote.length],
        end: index,
      });
      matched = prefix[matched - 1];
    }
    normalizedIndex += 1;
  }
  return { status: matches.length > 0 ? 'located' : 'not_found', matches };
}
