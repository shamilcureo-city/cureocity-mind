import {
  SaveMindSessionPreparationInputSchema,
  type MindSessionPreparationResponse,
  type MindSessionPreparationSaveResponse,
  type PrepareSummaryV1,
  type SessionDefaults,
} from '@cureocity/contracts';
import type { MindTodayWorkspaceProps } from '@/components/app/MindTodayWorkspace';
import type { MindClientOverviewProps } from '@/components/app/MindClientOverview';

export const CLIENT = 'fictional-ananya';
export const SESSION = 'fictional-october-visit';
export const SCHEDULED_AT = '2026-10-12T04:30:00.000Z';

const defaults: SessionDefaults = {
  kind: 'TREATMENT',
  modality: 'CBT',
  modalitySource: 'plan',
  language: 'en',
  spokenLanguages: ['en'],
  consentsAlreadyGranted: [],
  consentsNeeded: ['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'],
  sessionsCompleted: 5,
  lastInstrumentAdministrations: {},
  lastCompletedSessionAt: '2026-10-05T04:30:00.000Z',
};

const prepare: PrepareSummaryV1 = {
  version: 'V1',
  clientId: CLIENT,
  cachedBrief: {
    version: 'V1',
    language: 'en',
    contextLine: 'Fictional session 6 · CBT',
    lastSessionRecap:
      'At the last session, Ananya described noticing worry before work meetings. You explored a short pause and agreed to review what felt useful.',
    todaysFocus: 'Ask what felt useful about the pause and agree together on one manageable step.',
    openingLine: 'Where would you like to begin today?',
    riskWatchpoints: ['Check current safety and any changes before choosing the session focus.'],
    homeworkStatus: {
      description: 'Try a short pause before one work meeting.',
      outcome: 'unknown',
      notes: null,
    },
    carryoverCrisis: [],
    latestInstruments: [],
  },
  briefGeneratedAt: '2026-10-05T05:30:00.000Z',
  briefIsStale: false,
  journey: {
    stage: 'ACTIVE_TREATMENT',
    activePlan: null,
    instrumentChanges: [],
    nextBestAction: null,
  },
  homework: [],
  openCrises: [],
  lastCompletedSessionId: 'fictional-previous-visit',
  lastAgreements: [],
  activeAgreements: [],
  activeAgreementCount: 0,
  activeAgreementsNextCursor: null,
  formulationSnapshot: null,
  carriedQuestions: [],
  confirmedDiagnoses: [],
};

export const today: MindTodayWorkspaceProps = {
  dateLabel: 'Monday, 12 October 2026',
  hero: {
    id: SESSION,
    status: 'SCHEDULED',
    scheduledAt: SCHEDULED_AT,
    modality: 'CBT',
    kind: 'TREATMENT',
    clientId: CLIENT,
    clientName: 'Ananya M.',
    clientIsDemo: true,
    hasSignedNote: false,
    draftStatus: null,
    captureMode: 'LIVE',
  },
  agenda: [
    {
      session: {
        id: 'fictional-noor-visit',
        status: 'SCHEDULED',
        scheduledAt: '2026-10-12T06:00:00.000Z',
        modality: 'SUPPORTIVE',
        kind: 'TREATMENT',
        clientId: 'fictional-noor',
        clientName: 'Noor K.',
        clientIsDemo: true,
        hasSignedNote: false,
        draftStatus: null,
      },
    },
    {
      session: {
        id: 'fictional-arjun-visit',
        status: 'SCHEDULED',
        scheduledAt: '2026-10-12T08:30:00.000Z',
        modality: null,
        kind: 'INTAKE',
        clientId: 'fictional-arjun',
        clientName: 'Arjun R.',
        clientIsDemo: true,
        hasSignedNote: false,
        draftStatus: null,
      },
    },
    {
      session: {
        id: 'fictional-leela-visit',
        status: 'COMPLETED',
        scheduledAt: '2026-10-12T03:00:00.000Z',
        modality: 'ACT',
        kind: 'TREATMENT',
        clientId: 'fictional-leela',
        clientName: 'Leela S.',
        clientIsDemo: true,
        hasSignedNote: false,
        draftStatus: 'COMPLETED',
      },
    },
  ],
  upcoming: [],
  attentionItems: [
    {
      id: 'fictional-review',
      kind: 'NOTE_REVIEW',
      occurredAt: '2026-10-12T04:00:00.000Z',
      title: 'Leela S. · note ready',
      detail: 'Review the draft before signing.',
      href: '/app/sessions/fictional-leela-visit',
      ctaLabel: 'Review note',
    },
  ],
  defaultCapture: 'LIVE',
  progress: { completed: 1, signed: 0, ready: 1, remaining: 1 },
  sessionPreparationEnabled: true,
};

export const clientOverview: MindClientOverviewProps = {
  clientId: CLIENT,
  name: 'Ananya M.',
  age: 29,
  createdAt: new Date('2026-09-07T04:30:00.000Z'),
  isDemo: true,
  presentingConcerns: 'Work-related worry and difficulty unwinding at the end of the day.',
  journey: {
    clientId: CLIENT,
    stage: 'ACTIVE_TREATMENT',
    sessionsCompleted: 5,
    lastSessionAt: '2026-10-05T04:30:00.000Z',
    workingDiagnosis: null,
    activePlan: {
      id: 'fictional-care-plan',
      version: 1,
      modality: 'CBT',
      goals: [
        {
          index: 0,
          description: 'Working toward more space for everyday life.',
          measure: 'Review the client’s experience of meeting-related worry.',
          status: 'IN_PROGRESS',
        },
        {
          index: 1,
          description: 'Make room for rest after work.',
          measure: 'Discuss what makes it easier or harder to unwind.',
          status: 'NOT_STARTED',
        },
      ],
      goalsAchieved: 0,
      goalsTotal: 2,
      confirmedAt: '2026-09-28T05:30:00.000Z',
    },
    instrumentChanges: [
      {
        instrumentKey: 'GAD7',
        baselineScore: 14,
        latestScore: 10,
        delta: -4,
        percentChange: -28.57,
        verdict: 'reliable_improvement',
        isResponse: false,
        isRemission: false,
        baselineSeverityKey: 'moderate',
        latestSeverityKey: 'moderate',
        administrationCount: 2,
        baselineAt: '2026-09-07T04:30:00.000Z',
        latestAt: '2026-10-05T04:30:00.000Z',
      },
    ],
    nextBestAction: null,
    closedEpisode: null,
  },
  sessions: [
    {
      id: SESSION,
      status: 'SCHEDULED',
      scheduledAt: new Date(SCHEDULED_AT),
      modality: 'CBT',
      captureMode: 'LIVE',
      therapyNote: null,
      noteDraft: null,
    },
    ...['2026-10-05', '2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07'].map((day, index) => ({
      id: `fictional-prior-${index}`,
      status: 'COMPLETED',
      scheduledAt: new Date(`${day}T04:30:00.000Z`),
      modality: 'CBT',
      therapyNote: {
        id: `fictional-note-${index}`,
        locked: true,
        signedAt: `${day}T05:30:00.000Z`,
      },
      noteDraft: null,
    })),
  ],
  activeHomeworkCount: 1,
  defaultCapture: 'LIVE',
  now: new Date('2026-10-12T04:00:00.000Z'),
};

/** No passthrough: every fetch resolves in memory or is explicitly rejected. */
export function createFictionalTransport() {
  let current: MindSessionPreparationResponse = {
    sessionId: SESSION,
    clientId: CLIENT,
    scheduledAt: SCHEDULED_AT,
    status: 'SCHEDULED',
    preparation: null,
  };
  const receipts = new Map<string, MindSessionPreparationSaveResponse>();
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      window.location.origin,
    );
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.pathname.endsWith('/preparation')) {
      if (method === 'GET') return Response.json(current);
      const parsed = SaveMindSessionPreparationInputSchema.safeParse(
        JSON.parse(String(init?.body)),
      );
      if (!parsed.success || parsed.data.expectedClientId !== CLIENT)
        return Response.json({}, { status: 400 });
      const packet = parsed.data;
      const prior = receipts.get(packet.operationId);
      if (prior) return Response.json({ ...prior, replayed: true });
      if (packet.expectedRevision !== (current.preparation?.revision ?? 0))
        return Response.json({}, { status: 409 });
      // A visible acknowledgement window exercises pending-start guards without a real server.
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      const preparation: MindSessionPreparationSaveResponse['preparation'] = {
        id: `fictional-focus-${packet.expectedRevision + 1}`,
        sessionId: SESSION,
        psychologistId: 'fictional-maya',
        revision: packet.expectedRevision + 1,
        operationId: packet.operationId,
        body: {
          version: 1,
          focus: packet.focus,
          source: 'CLINICIAN_WRITTEN',
          scheduledAt: SCHEDULED_AT,
        },
        createdAt: '2026-10-12T04:00:00.000Z',
      };
      current = { ...current, preparation };
      const response = {
        ...current,
        preparation,
        currentRevision: preparation.revision,
        replayed: false,
      };
      receipts.set(packet.operationId, response);
      return Response.json(response);
    }
    if (method !== 'GET')
      return Response.json(
        { error: 'Local design fixture: this action is not connected.' },
        { status: 403 },
      );
    if (url.pathname.endsWith('/session-defaults'))
      return Response.json({
        defaults,
        guides: [
          {
            id: 'fictional-guide',
            name: 'Collaborative check-in',
            updatedAt: '2026-10-05T05:30:00.000Z',
          },
        ],
      });
    if (url.pathname.endsWith('/prepare')) return Response.json(prepare);
    if (url.pathname.endsWith('/care-record')) return Response.json({ record: null });
    if (url.pathname === `/api/v1/sessions/${SESSION}`)
      return Response.json({
        id: SESSION,
        clientId: CLIENT,
        kind: 'TREATMENT',
        modality: 'CBT',
        language: 'en',
        status: 'SCHEDULED',
        scheduledAt: SCHEDULED_AT,
        updatedAt: '2026-10-12T03:00:00.000Z',
        mindDocumentationMode: 'AI_ASSISTED',
      });
    if (url.pathname === '/api/v1/live/health')
      return Response.json({ ok: false, atCapacity: false });
    return Response.json(
      { error: 'No network is used by this fictional fixture.' },
      { status: 404 },
    );
  };
  return transport;
}
