import {
  MedicalEncounterNoteV1Schema,
  RxPadV1Schema,
  type RxPadPatchOp,
} from '@cureocity/contracts';
import {
  DEFAULT_SCRIBE_NOTE_STYLE,
  type ScribeNoteStyle,
  type ScribeShortcut,
} from '@/lib/scribe-personalization-contracts';
import type { ScribeRecord } from '@/lib/scribe-workspace-store';
import type { ScribeTaskBody } from '@/lib/scribe-preparation-contracts';
import type { ScribeIntakeRecord } from '@/lib/scribe-intake-contracts';
import type { ReportSummary } from '@/lib/scribe-report-schema';
import type { InstructionsBody } from '@/lib/scribe-instructions-schema';

export const PREVIEW_CLIENT = 'fictional-patient';
export const PREVIEW_SESSION = 'fictional-visit';
const date = '2026-09-25T08:00:00.000Z';
export const WORKFLOW_PREVIEW_NOTE = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  encounterKind: 'FOLLOW_UP',
  chiefComplaint: 'Follow-up for tiredness.',
  hpi: 'Fictional patient reports more regular sleep. Previous report brought for review.',
  assessment: 'Fictional demonstration: assessment to be reviewed by the doctor.',
  plan: 'Review the supplied report and agree the next visit with the patient.',
});
const envelope = <T>(id: string, body: T): ScribeRecord<T> => ({
  id,
  body,
  revision: 1,
  clientId: PREVIEW_CLIENT,
  sessionId: PREVIEW_SESSION,
  createdAt: date,
  updatedAt: date,
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Only used by the gated local page. Unknown actions fail; nothing falls through to patient APIs. */
export function createScribeWorkflowFixture(): typeof fetch {
  const pad = RxPadV1Schema.parse({
    version: 'V1',
    adviceLines: ['Bring previous reports to the next visit.'],
  });
  let style: ScribeRecord<ScribeNoteStyle> | null = null;
  let shortcuts: ScribeRecord<ScribeShortcut>[] = [
    envelope('favorite-advice', {
      type: 'advice',
      title: 'Bring previous reports',
      text: 'Bring previous reports to the next visit.',
    }),
    envelope('favorite-test', {
      type: 'investigation',
      title: 'Example investigation',
      name: 'Example investigation (fictional)',
    }),
    envelope('favorite-phrase', {
      type: 'phrase',
      title: 'Review together',
      field: 'plan',
      text: 'Review the agreed follow-up plan with the patient.',
    }),
  ];
  let tasks: ScribeRecord<ScribeTaskBody>[] = [
    envelope('task-1', {
      category: 'results',
      title: 'Review the report brought today',
      details: 'Fictional review task; no reminder will be sent.',
      dueDate: '2026-09-25',
      assignee: 'Doctor (you)',
      status: 'open',
      completionNote: '',
    }),
  ];
  let intake: ScribeIntakeRecord[] = [
    envelope('intake-1', {
      expiresAt: '2026-09-26T08:00:00.000Z',
      revokedAt: null,
      submittedAt: date,
      authorVerified: false,
      report: {
        authorName: 'Ananya Rao (fictional)',
        authorRole: 'patient',
        reasonForVisit: 'Follow-up for tiredness; I brought my last report.',
        medications: 'Please confirm with me during the visit.',
        allergyStatus: 'unknown',
        allergies: '',
        history: 'Sleep routine has improved.',
        acknowledged: true,
        vitals: null,
      },
      review: { status: 'pending', reviewedBy: null, reviewedAt: null, note: '' },
    }),
  ];
  let reports: ScribeRecord<ReportSummary>[] = [
    envelope('report-1', {
      version: 1,
      status: 'candidate',
      original: {
        name: 'Fictional report.png',
        mime: 'image/png',
        size: 1024,
        pages: 1,
        sha256: 'a'.repeat(64),
      },
      candidates: [
        {
          id: 'result-1',
          name: 'Haemoglobin',
          value: '12.4',
          unit: 'g/dL',
          reportDate: '2026-09-20',
          page: 1,
          sourceText: 'Haemoglobin 12.4 g/dL · 20 September 2026',
          included: true,
        },
      ],
      extractedAt: date,
      reviewedAt: null,
      reviewedBy: null,
    }),
  ];
  let instructions = [
    {
      ...envelope<InstructionsBody>('instructions-1', {
        version: 1,
        status: 'draft',
        language: 'source',
        sourceHash: 'b'.repeat(64),
        noteId: 'fictional-signed-note',
        signedAt: date,
        lines: [
          {
            id: 'advice-1',
            kind: 'advice',
            source: 'Bring previous reports to the next visit.',
            text: 'Bring previous reports to the next visit.',
          },
          {
            id: 'followup-2',
            kind: 'followup',
            source: 'Follow up as agreed with your doctor.',
            text: 'Follow up as agreed with your doctor.',
          },
        ],
        clinicalReviewed: false,
        languageReviewed: false,
        reviewedAt: null,
        reviewedBy: null,
      }),
      sourceCurrent: true,
    },
  ];
  let counter = 0;
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      'http://localhost',
    );
    const path = url.pathname;
    const method = init?.method ?? 'GET';
    const data = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const id = path.split('/').at(-1)!;
    if (path.endsWith('/scribe-briefing'))
      return response({
        allergies: { status: 'not_recorded', entries: [] },
        intake: {
          submittedAt: date,
          reasonForVisit: 'Follow-up for tiredness; previous report brought today.',
          reviewStatus: intake[0]?.body.review.status === 'reviewed' ? 'reviewed' : 'pending',
          authorRole: 'patient',
          vitals: null,
        },
        visits: [
          {
            sessionId: 'fictional-earlier-visit',
            encounterAt: '2026-09-11T08:00:00.000Z',
            signedAt: '2026-09-11T08:15:00.000Z',
            complaint: 'Tiredness and irregular sleep.',
            assessment: 'Fictional historical note, not a current assessment.',
            plan: 'Bring previous reports to follow-up.',
            prescriptions: [],
          },
        ],
      });
    if (path.endsWith('/scribe-intake') && method === 'GET') return response({ items: intake });
    if (path.endsWith('/scribe-intake') && method === 'POST') {
      const record: ScribeIntakeRecord = envelope(`intake-${++counter + 1}`, {
        expiresAt: '2026-09-26T08:00:00.000Z',
        revokedAt: null,
        submittedAt: null,
        report: null,
        authorVerified: false,
        review: { status: 'pending', reviewedAt: null, reviewedBy: null, note: '' },
      });
      intake = [record, ...intake];
      return response({ linkPath: '/dev/scribe-live#fictional-intake-only', record });
    }
    if (path.includes('/scribe-intake/') && method === 'PATCH') {
      const current = intake.find((row) => row.id === id);
      if (!current || current.revision !== data.expectedRevision)
        return response({ error: 'Preview changed. Reload.' }, 409);
      const record = {
        ...current,
        revision: current.revision + 1,
        body: {
          ...current.body,
          ...(data.action === 'revoke'
            ? { revokedAt: date }
            : {
                review: {
                  status: data.action,
                  reviewedAt: date,
                  reviewedBy: 'fictional-doctor',
                  note: data.note,
                },
              }),
        },
      };
      intake = intake.map((row) => (row.id === id ? record : row));
      return response({ record });
    }
    if (path === '/api/v1/scribe-tasks' && method === 'GET')
      return response({ tasks, unsigned: [], unsignedMayHaveMore: false, tasksMayHaveMore: false });
    if (path === '/api/v1/scribe-tasks' && method === 'POST') {
      const record = envelope<ScribeTaskBody>(`task-${++counter}`, {
        ...data.task,
        status: 'open',
        completionNote: '',
      });
      tasks = [record, ...tasks];
      return response({ record });
    }
    if (path.startsWith('/api/v1/scribe-tasks/') && method === 'PATCH') {
      const current = tasks.find((row) => row.id === id);
      if (!current || current.revision !== data.expectedRevision)
        return response({ error: 'Preview changed. Reload.' }, 409);
      const record = { ...current, body: data.task, revision: current.revision + 1 };
      tasks = tasks.map((row) => (row.id === id ? record : row));
      return response({ record });
    }
    if (path === '/api/v1/scribe/note-styles') {
      if (method === 'PUT')
        style = {
          ...envelope('preview-note-style', data.body ?? DEFAULT_SCRIBE_NOTE_STYLE),
          revision: (style?.revision ?? 0) + 1,
        };
      return response({ record: style });
    }
    if (path === '/api/v1/scribe/shortcuts' && method === 'GET')
      return response({ records: shortcuts });
    if (path === '/api/v1/scribe/shortcuts' && method === 'POST') {
      const record = envelope(`favorite-${++counter}`, data as ScribeShortcut);
      shortcuts = [record, ...shortcuts];
      return response({ record });
    }
    if (path.startsWith('/api/v1/scribe/shortcuts/')) {
      const current = shortcuts.find((row) => row.id === id);
      if (!current || current.revision !== data.revision)
        return response({ error: 'Preview changed. Reload.' }, 409);
      if (method === 'DELETE') {
        shortcuts = shortcuts.filter((row) => row.id !== id);
        return response({ ok: true });
      }
      const record = { ...current, body: data.body, revision: current.revision + 1 };
      shortcuts = shortcuts.map((row) => (row.id === id ? record : row));
      return response({ record });
    }
    if (path.endsWith('/rx-pad')) {
      if (method === 'PATCH')
        for (const op of data.ops as RxPadPatchOp[]) {
          if (op.op === 'addMed')
            pad.meds.push({
              ...op.med,
              continued: false,
              status: 'confirmed',
              warnings: [],
              source: op.source,
            });
          if (op.op === 'removeMed') pad.meds = pad.meds.filter((row) => row.drug !== op.drug);
          if (op.op === 'confirmMed' || op.op === 'unconfirmMed')
            pad.meds = pad.meds.map((row) =>
              row.drug === op.drug
                ? { ...row, status: op.op === 'confirmMed' ? 'confirmed' : 'pending' }
                : row,
            );
          if (op.op === 'updateMed')
            pad.meds = pad.meds.map((row) => (row.drug === op.drug ? { ...row, ...op.med } : row));
          if (op.op === 'addAdvice') pad.adviceLines.push(op.text);
          if (op.op === 'removeAdvice')
            pad.adviceLines = pad.adviceLines.filter((text) => text !== op.text);
          if (op.op === 'addInvestigation')
            pad.investigations.push({ name: op.name, source: op.source });
          if (op.op === 'removeInvestigation')
            pad.investigations = pad.investigations.filter((row) => row.name !== op.name);
          if (op.op === 'setFollowUp')
            pad.followUp = { when: op.when, ...(op.withWhat ? { withWhat: op.withWhat } : {}) };
          if (op.op === 'clearFollowUp') delete pad.followUp;
        }
      return response({ rxPad: pad, signed: false });
    }
    if (path === '/api/v1/scribe/reports' && method === 'GET')
      return response({ records: reports, nextCursor: null });
    if (path.endsWith('/original'))
      return fetch('/dev/scribe-live/report-original', { cache: 'no-store' });
    if (path.startsWith('/api/v1/scribe/reports/') && method === 'PATCH') {
      const current = reports.find((row) => row.id === id);
      if (!current) return response({ error: 'Preview report missing.' }, 404);
      const record = {
        ...current,
        revision: current.revision + 1,
        body: {
          ...current.body,
          candidates: data.candidates,
          status: 'confirmed' as const,
          reviewedAt: date,
          reviewedBy: 'fictional-doctor',
        },
      };
      reports = reports.map((row) => (row.id === id ? record : row));
      return response({ record });
    }
    if (path === '/api/v1/scribe/instructions' && method === 'GET')
      return response({ records: instructions });
    if (path === '/api/v1/scribe/instructions' && method === 'POST') {
      if (data.language !== 'source')
        return response(
          {
            error:
              'Translation is not simulated. This fictional preview uses signed source wording only.',
          },
          409,
        );
      return response({ record: instructions[0] });
    }
    if (path.startsWith('/api/v1/scribe/instructions/') && method === 'PATCH') {
      const current = instructions.find((row) => row.id === id);
      if (!current) return response({ error: 'Preview instructions missing.' }, 404);
      const record = {
        ...current,
        revision: current.revision + 1,
        body: {
          ...current.body,
          lines: current.body.lines.map((line) => ({
            ...line,
            text:
              data.lines.find((edited: { id: string; text: string }) => edited.id === line.id)
                ?.text ?? line.text,
          })),
          status: 'reviewed' as const,
          clinicalReviewed: true,
          languageReviewed: true,
          reviewedAt: date,
          reviewedBy: 'fictional-doctor',
        },
      };
      instructions = instructions.map((row) => (row.id === id ? record : row));
      return response({ record });
    }
    if (path.endsWith('/text'))
      return new Response(
        'FICTIONAL PREVIEW ONLY\nBring previous reports to the next visit.\nNothing has been sent to a patient.',
        { headers: { 'content-type': 'text/plain' } },
      );
    return response(
      { error: 'This action is not simulated. No real patient API or AI service was called.' },
      409,
    );
  };
}
