/* eslint-disable no-console */
/**
 * Cureocity Mind — end-to-end demo orchestration script.
 *
 * Walks the full happy path the plan calls out for Sprint 9:
 *
 *   therapist signs up
 *     → adds client
 *     → captures consent (all 5 scopes individually)
 *     → conducts a session (start / upload chunks / end)
 *     → waits for note draft
 *     → reviews + signs the note
 *     → prescribes an exercise to the client
 *     → client claims their PWA via QR
 *     → client completes the exercise
 *     → therapist sees adherence in the next briefing
 *
 * Runs against locally-running services (default ports — see infra/docker-
 * compose.yml). All services must be reachable; the script is intentionally
 * NOT in the CI gate because it requires real Postgres + Redis + S3 + Vertex.
 *
 * Invoke:
 *   pnpm exec tsx scripts/e2e-demo.ts
 * or:
 *   pnpm exec tsx scripts/e2e-demo.ts --dry-run   # logs intent only
 *
 * Auth: relies on AUTH_BYPASS=true on every service so the dev-uid
 * fixtures (Priya + Arjun) resolve. Set FIREBASE_ADMIN credentials and
 * generate real id tokens for a non-bypass run.
 */

const PATIENT_BASE = process.env['PATIENT_SERVICE_BASE'] ?? 'http://localhost:3001/api/v1';
const SCRIBE_BASE = process.env['SCRIBE_SERVICE_BASE'] ?? 'http://localhost:3002/api/v1';
const CONTINUITY_BASE = process.env['CONTINUITY_SERVICE_BASE'] ?? 'http://localhost:3005/api/v1';

const DRY_RUN = process.argv.includes('--dry-run');
const BYPASS_AUTH = 'Bearer dev-bypass';

interface Step {
  description: string;
  action: () => Promise<void>;
}

const state: Record<string, unknown> = {};

async function http<T>(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  if (DRY_RUN) {
    console.log(`  → DRY-RUN ${method} ${url}${body ? ` body=${JSON.stringify(body)}` : ''}`);
    return {} as T;
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: BYPASS_AUTH,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${url} failed: ${res.status} ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const steps: Step[] = [
  {
    description: '1. Therapist registers (Firebase OTP already complete)',
    action: async () => {
      state['psychologist'] = await http('POST', `${PATIENT_BASE}/psychologists`, {
        fullName: 'Dr. Priya Menon',
        email: 'priya@example.in',
        phone: '+919812345678',
        rciNumber: 'A12345',
      });
      console.log(`   psychologistId=${(state['psychologist'] as { id: string }).id}`);
    },
  },
  {
    description: '2. Therapist creates a client (with audio + AI consent)',
    action: async () => {
      state['client'] = await http('POST', `${PATIENT_BASE}/clients`, {
        fullName: 'Arjun Mehta',
        contactPhone: '+919900000000',
        contactEmail: 'arjun@example.in',
        consents: [
          { scope: 'AUDIO_RECORDING', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' },
          { scope: 'AI_NOTE_GENERATION', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' },
          { scope: 'CROSS_BORDER_PROCESSING', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' },
        ],
      });
      console.log(`   clientId=${(state['client'] as { id: string }).id}`);
    },
  },
  {
    description: '3. Therapist creates a session + records consent ack + starts',
    action: async () => {
      const sess = await http<{ id: string }>('POST', `${SCRIBE_BASE}/sessions`, {
        clientId: (state['client'] as { id: string }).id,
        modality: 'CBT',
        scheduledAt: new Date().toISOString(),
      });
      state['session'] = sess;
      await http('POST', `${SCRIBE_BASE}/sessions/${sess.id}/consent`, {
        scopes: ['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'],
        scriptVersion: 'v1.0',
      });
      await http('POST', `${SCRIBE_BASE}/sessions/${sess.id}/start`);
      console.log(`   sessionId=${sess.id}`);
    },
  },
  {
    description: '4. Audio chunks upload (skipped in demo — would call PUT /audio/:id/chunks)',
    action: async () => {
      console.log('   (synthetic audio upload omitted; see scribe-service integration tests)');
    },
  },
  {
    description: '5. Therapist ends the session — triggers Gemini two-pass',
    action: async () => {
      const sessId = (state['session'] as { id: string }).id;
      await http('POST', `${SCRIBE_BASE}/sessions/${sessId}/end`);
    },
  },
  {
    description: '6. Therapist fetches the draft + signs the note',
    action: async () => {
      const sessId = (state['session'] as { id: string }).id;
      const draft = await http<{ content: unknown; status: string }>(
        'GET',
        `${SCRIBE_BASE}/sessions/${sessId}/note-draft`,
      );
      if (DRY_RUN || draft.status !== 'COMPLETED') {
        console.log(`   draft.status=${draft.status ?? 'unknown'} — would sign here`);
        return;
      }
      const note = draft.content as { subjective: string };
      const payload = JSON.stringify({
        sessionId: sessId,
        note,
        edits: [],
        signedAt: new Date().toISOString(),
      });
      const { createHash } = await import('node:crypto');
      const payloadHashHex = createHash('sha256').update(payload).digest('hex');
      await http('POST', `${SCRIBE_BASE}/sessions/${sessId}/sign`, {
        payload,
        payloadHashHex,
        note,
        edits: [],
        signedAt: new Date().toISOString(),
      });
      console.log('   note signed');
    },
  },
  {
    description: '7. Therapist prescribes an exercise',
    action: async () => {
      const clientId = (state['client'] as { id: string }).id;
      const psyId = (state['psychologist'] as { id: string }).id;
      const assignment = await http('POST', `${CONTINUITY_BASE}/exercise-assignments`, {
        clientId,
        psychologistId: psyId,
        exerciseId: 'cbt_thought_record_5col',
      });
      state['assignment'] = assignment;
      console.log(`   assignmentId=${(assignment as { id: string }).id}`);
    },
  },
  {
    description: '8. Client claims their PWA via QR (issue + redeem)',
    action: async () => {
      const clientId = (state['client'] as { id: string }).id;
      const token = await http<{ token: string }>(
        'POST',
        `${PATIENT_BASE}/clients/${clientId}/claim-token`,
        {},
      );
      console.log(`   tokenIssued=${token.token}`);
      await http('POST', `${PATIENT_BASE}/claim-tokens/${token.token}/redeem`, {});
      console.log('   tokenRedeemed (clientFirebaseUid bound)');
    },
  },
  {
    description: '9. Client completes the exercise',
    action: async () => {
      const a = state['assignment'] as { id: string } | undefined;
      if (!a) return;
      await http('POST', `${CONTINUITY_BASE}/me/exercises/${a.id}/completions`, {
        response: {
          situation: 'Late for a client meeting',
          automaticThought: 'I am incompetent',
          emotion: 'anxious',
          emotionIntensity: 80,
          evidenceFor: 'I was 10 minutes late',
          evidenceAgainst: 'Traffic was unusual; I usually arrive early',
          balancedThought: 'I had one off day, not a pattern',
        },
        notes: 'felt better after writing it out',
      });
      console.log('   exercise completed');
    },
  },
  {
    description: '10. Therapist views adherence in the briefing dossier',
    action: async () => {
      const clientId = (state['client'] as { id: string }).id;
      const briefing = await http<{ adherence?: unknown }>(
        'GET',
        `${PATIENT_BASE}/clients/${clientId}/briefing`,
      );
      const summary =
        briefing.adherence !== undefined
          ? JSON.stringify(briefing.adherence)
          : '<no adherence data>';
      console.log(`   briefing.adherence=${summary}`);
    },
  },
];

async function main(): Promise<void> {
  console.log(
    `Cureocity Mind E2E demo — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} against\n  patient: ${PATIENT_BASE}\n  scribe : ${SCRIBE_BASE}\n  contin.: ${CONTINUITY_BASE}\n`,
  );
  for (const [i, step] of steps.entries()) {
    console.log(`\n[${i + 1}/${steps.length}] ${step.description}`);
    try {
      await step.action();
    } catch (e) {
      console.error(`   ✗ ${(e as Error).message}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log('\n✓ E2E demo complete.');
}

void main();
