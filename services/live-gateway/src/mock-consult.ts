import type {
  EncounterGap,
  LiveGatewayEvent,
  LiveTranscriptDelta,
  MedicalEncounterNoteV1,
} from '@cureocity/contracts';

type Emit = (event: LiveGatewayEvent) => void;

/**
 * A scripted Hinglish cardiology OPD consult. Steps fire on a timeline so
 * the note visibly fills in (Rail 2) and red flags surface mid-consult
 * (Rail 3) — the whole point of the live copilot. The real gateway
 * derives these from streaming ASR + a debounced structurer.
 */
interface Step {
  afterMs: number;
  event: LiveGatewayEvent;
}

const line = (text: string, speaker: 'doctor' | 'patient'): LiveTranscriptDelta => ({
  text,
  isFinal: true,
  speaker,
});

const gap = (
  kind: EncounterGap['kind'],
  severity: EncounterGap['severity'],
  message: string,
): EncounterGap => ({ kind, severity, message });

const SCRIPT: Step[] = [
  { afterMs: 200, event: { type: 'status', state: 'listening' } },
  {
    afterMs: 600,
    event: {
      type: 'transcript',
      delta: line('Doctor, do din se seene mein pressure ho raha hai.', 'patient'),
    },
  },
  { afterMs: 1400, event: { type: 'note', partial: { chiefComplaint: 'Chest pressure ×2 days' } } },
  {
    afterMs: 1900,
    event: { type: 'transcript', delta: line('Kab hota hai — chalne pe ya rest pe?', 'doctor') },
  },
  {
    afterMs: 2700,
    event: {
      type: 'transcript',
      delta: line('Walking pe zyada. Rest pe theek ho jata hai.', 'patient'),
    },
  },
  {
    afterMs: 3300,
    event: {
      type: 'note',
      partial: {
        chiefComplaint: 'Chest pressure ×2 days',
        hpi: 'Retrosternal pressure, exertional, relieved by rest.',
      },
    },
  },
  {
    afterMs: 3500,
    event: {
      type: 'gap',
      gap: gap('RED_FLAG', 'critical', 'Exertional chest pain — consider ECG now (ACS red flag).'),
    },
  },
  {
    afterMs: 4300,
    event: {
      type: 'gap',
      gap: gap(
        'MISSING_QUESTION',
        'warn',
        'Not yet asked: radiation to arm/jaw, sweating, breathlessness.',
      ),
    },
  },
  {
    afterMs: 5100,
    event: {
      type: 'transcript',
      delta: line('Koi pasina aata hai, ya haath mein dard?', 'doctor'),
    },
  },
  {
    afterMs: 5900,
    event: {
      type: 'transcript',
      delta: line('Nahi, sirf pressure. BP high rehta hai mera.', 'patient'),
    },
  },
  {
    afterMs: 6500,
    event: {
      type: 'note',
      partial: {
        chiefComplaint: 'Chest pressure ×2 days',
        hpi: 'Retrosternal pressure, exertional, relieved by rest. No radiation or sweating. Known hypertension.',
        vitals: { bpSystolic: 148, bpDiastolic: 92 },
      },
    },
  },
  {
    afterMs: 6700,
    event: {
      type: 'gap',
      gap: gap(
        'MISSING_QUESTION',
        'info',
        'Document smoking + diabetes status (cardiac risk factors).',
      ),
    },
  },
  {
    afterMs: 7500,
    event: {
      type: 'note',
      partial: {
        chiefComplaint: 'Chest pressure ×2 days',
        hpi: 'Retrosternal pressure, exertional, relieved by rest. No radiation or sweating. Known hypertension.',
        assessment: 'Exertional chest pain — rule out stable angina / ACS. Hypertension.',
        vitals: { bpSystolic: 148, bpDiastolic: 92 },
      },
    },
  },
  {
    afterMs: 7700,
    event: {
      type: 'gap',
      gap: gap('CODING', 'info', 'Documentation supports I20.x (angina) — confirm before coding.'),
    },
  },
];

const FINAL_NOTE: MedicalEncounterNoteV1 = {
  version: 'V1',
  encounterKind: 'NEW_OPD',
  chiefComplaint: 'Exertional chest pressure ×2 days',
  hpi: 'Retrosternal pressure on exertion ×2 days, relieved by rest. No radiation to arm/jaw, no sweating, no breathlessness. Known hypertensive.',
  reviewOfSystems: [
    'Cardiovascular: exertional chest pressure',
    'Respiratory: no breathlessness at rest',
  ],
  physicalExam: { examined: false, findings: '' },
  vitals: { bpSystolic: 148, bpDiastolic: 92 },
  assessment:
    'Exertional chest pain — rule out stable angina / ACS. Hypertension, suboptimally controlled.',
  plan: 'ECG today; aspirin if no contraindication; lipid profile + fasting glucose; review in 3 days with reports; return immediately if pain at rest, radiation, or sweating.',
  linkedEvidence: [{ quote: 'seene mein pressure … walking pe zyada' }],
};

export class MockConsultDriver {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private finalized = false;

  constructor(private readonly emit: Emit) {}

  start(): void {
    for (const step of SCRIPT) {
      this.timers.push(setTimeout(() => this.emit(step.event), step.afterMs));
    }
  }

  finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    this.dispose();
    this.emit({ type: 'status', state: 'finalizing' });
    this.timers.push(
      setTimeout(() => {
        this.emit({ type: 'final', note: FINAL_NOTE });
        this.emit({ type: 'status', state: 'done' });
      }, 800),
    );
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }
}
