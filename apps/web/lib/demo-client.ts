import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import {
  CaseFormulationV1Schema,
  ClinicalReportV1Schema,
  ClinicalTreatmentPlanSchema,
  InitialAssessmentBriefV1Schema,
  IntakeNoteV1Schema,
  PENDING_SECTION_CONFIRMATIONS,
  SafetyPlanV1Schema,
  SpeakerSegmentSchema,
  TherapyNoteV1Schema,
  TherapyScriptV1Schema,
  type CaseFormulationV1,
  type ClinicalReportV1,
  type ClinicalSectionConfirmations,
  type ClinicalTreatmentPlan,
  type InitialAssessmentBriefV1,
  type IntakeNoteV1,
  type SafetyPlanV1,
  type Speaker,
  type SpeakerSegment,
  type TherapyNoteV1,
  type TherapyScriptV1,
} from '@cureocity/contracts';
import { INSTRUMENTS, scoreInstrument } from '@cureocity/clinical';
import { prisma } from './prisma';
import { writeAudit } from './audit';
import { encryptForTenant } from './tenant-crypto';
import { buildProgressReport } from './progress-report';

/**
 * Sprint 48 → SL-demo rework — Demo showcase client.
 *
 * A single deterministic fabricator that lets a trialing therapist
 * one-click seed (or remove) a clearly-badged "Example" client. The case
 * is deliberately COMPLEX so the full system shows itself in minute one:
 *
 *   - Six sessions, each with its OWN note, Pass-3 report, and diarized
 *     code-mix transcript (every report evidence quote appears verbatim
 *     in a transcript — the citation trail is real).
 *   - Comorbidity: moderate depression (6A70.1, primary) + GAD (6B00),
 *     tracked with PHQ-9 AND GAD-7.
 *   - A real setback: a layoff round at T2 spikes PHQ-9 to 19, surfaces
 *     passive ideation (medium crisis flag on that session's report), and
 *     produces a collaborative SafetyPlan — resolved by T3.
 *   - Versioned thinking: plan v1 → v2 (sleep + worry goals added after
 *     the setback), formulation v1 → v2 (the "workload eases" prediction
 *     NOT_MATCHING → revised), agreements every session with follow-ups
 *     marked the following week, an alliance arc that dips at T2.
 *   - Endgame: PHQ-9 4 + GAD-7 4 (remission on both), homework in mixed
 *     states, one OPEN durability item, report-5 plan-as-diff +
 *     formulation-as-diff suggestions awaiting the therapist's call.
 *
 * Design rules:
 *   - No LLM calls. Every fabricated body is deterministic and
 *     validated through the real Zod schemas at build time so drift
 *     fails loudly in CI.
 *   - No `[mock]` prefix anywhere. That tag is reserved for mock LLM
 *     output (and stripped by share-snapshots before sending) — demo
 *     content is real content from the fixture, not from a mock pass.
 *   - Idempotent on POST: a second call returns the existing demo
 *     client. Removal is a hard delete in FK-safe order inside one
 *     transaction (several session-referencing tables have no cascade).
 *   - The treatment episode stays OPEN so the Journey hub shows
 *     `DISCHARGE_READY`. A DISCHARGED episode would flip the hub to
 *     terminal and hide the "consider discharge" next-best-action.
 *   - PHQ-9 final score is 4 (not 5) because remission is <= 4 per
 *     packages/clinical/src/instruments/change-score.ts.
 */

const DEMO_NAME = 'Ananya Iyer';
const DEMO_PRIMARY_LANGUAGE = 'en';
const DEMO_SESSION_INTERVAL_DAYS = 7;
/**
 * PHQ-9 arc with a real setback: 18 (intake) → 15 → 19 (layoff week — the
 * deterioration a linear demo would hide) → 9 → 4 (remission). Administered
 * at intake, T1, T2, T4, T5.
 */
const PHQ9_SCORES: ReadonlyArray<number> = [18, 15, 19, 9, 4];
/** Comorbid GAD-7 arc: 15 (intake) → 11 (T3) → 4 (T5, remission). */
const GAD7_SCORES: ReadonlyArray<number> = [15, 11, 4];

export interface CreateDemoClientResult {
  clientId: string;
  /** True when a new client was created; false when an existing demo was returned. */
  created: boolean;
}

export interface RemoveDemoClientResult {
  /** True when a demo row was deleted. */
  removed: boolean;
  clientId: string | null;
}

/**
 * Find the (single) demo client for this therapist, if any.
 */
export async function findDemoClient(psychologistId: string): Promise<{ id: string } | null> {
  return prisma.client.findFirst({
    where: { psychologistId, isDemo: true, deletedAt: null },
    select: { id: true },
  });
}

/**
 * Seed the showcase arc. Idempotent — returns the existing demo row
 * unchanged on a second call.
 */
export async function createDemoClient(
  psychologistId: string,
  actorPsychologistId: string,
): Promise<CreateDemoClientResult> {
  const existing = await findDemoClient(psychologistId);
  if (existing) {
    return { clientId: existing.id, created: false };
  }

  // Backdate sessions weekly so they don't show up on the Today
  // screen. The latest session ends ~7 days before now; the intake is
  // ~5 weeks back.
  const now = new Date();
  const sessionDates: Date[] = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - DEMO_SESSION_INTERVAL_DAYS * (6 - i));
    d.setHours(10, 0, 0, 0);
    return d;
  });

  const intakeAt = sessionDates[0]!;
  const treatmentDates = sessionDates.slice(1);

  // ------------------------------------------------------------------
  // 1. Validate every fabricated body BEFORE opening the transaction
  //    so a schema drift fails loudly without leaving partial rows.
  // ------------------------------------------------------------------
  const intakeBody: IntakeNoteV1 = IntakeNoteV1Schema.parse(buildIntakeNote());
  const initialBrief: InitialAssessmentBriefV1 = InitialAssessmentBriefV1Schema.parse(
    buildInitialAssessmentBrief(),
  );
  const treatmentBodies: TherapyNoteV1[] = buildTreatmentNotes().map((n) =>
    TherapyNoteV1Schema.parse(n),
  );
  const planV1Body: ClinicalTreatmentPlan = ClinicalTreatmentPlanSchema.parse(buildTreatmentPlan());
  const planV2Body: ClinicalTreatmentPlan =
    ClinicalTreatmentPlanSchema.parse(buildTreatmentPlanV2());
  const reportBodies: ClinicalReportV1[] = buildClinicalReports(planV1Body, planV2Body).map((r) =>
    ClinicalReportV1Schema.parse(r),
  );
  const scriptBody: TherapyScriptV1 = TherapyScriptV1Schema.parse(buildTherapyScript());
  const formulationV1Body: CaseFormulationV1 =
    CaseFormulationV1Schema.parse(buildCaseFormulationV1());
  const formulationV2Body: CaseFormulationV1 =
    CaseFormulationV1Schema.parse(buildCaseFormulationV2());
  const safetyPlanBody: SafetyPlanV1 = SafetyPlanV1Schema.parse(buildSafetyPlan());
  const transcripts = buildTranscripts();
  for (const t of transcripts) SpeakerSegmentSchema.array().parse(t.segments);
  if (treatmentBodies.length !== 5 || reportBodies.length !== 5 || transcripts.length !== 6) {
    throw new Error(
      '[demo-client] arc fixtures out of shape (want 5 notes, 5 reports, 6 transcripts)',
    );
  }

  // Score every administration through the real scorer so the
  // responses / score / severity tuple is internally consistent and
  // the Progress Report builder sees the same trend the UI shows.
  const phq9 = INSTRUMENTS.PHQ9;
  const scoredPhq9 = PHQ9_SCORES.map((target) => {
    const responses = phq9ResponsesForScore(target);
    const result = scoreInstrument(phq9, responses, 'en');
    if (result.score !== target) {
      throw new Error(`[demo-client] PHQ-9 fixture for target ${target} scored ${result.score}`);
    }
    return { target, responses, result };
  });
  const gad7 = INSTRUMENTS.GAD7;
  const scoredGad7 = GAD7_SCORES.map((target) => {
    const responses = gad7ResponsesForScore(target);
    const result = scoreInstrument(gad7, responses, 'en');
    if (result.score !== target) {
      throw new Error(`[demo-client] GAD-7 fixture for target ${target} scored ${result.score}`);
    }
    return { target, responses, result };
  });

  // PII is envelope-encrypted only. Encrypt outside the tx (may auto-provision
  // the tenant DEK). Empty phone round-trips to '' so ShareModal still greys
  // out WhatsApp + Email, leaving PORTAL_LINK as the demoable channel.
  const fullNameEncrypted = await encryptForTenant(psychologistId, DEMO_NAME);
  const contactPhoneEncrypted = await encryptForTenant(psychologistId, '');

  const clientId = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        psychologistId,
        fullNameEncrypted,
        contactPhoneEncrypted,
        contactEmailEncrypted: null,
        dateOfBirth: null,
        presentingConcerns:
          'Persistent low mood and loss of interest with constant work-related worry, sleep disruption, and a recent sharp dip after a layoff round at work.',
        preferredModality: 'CBT',
        preferredLanguage: DEMO_PRIMARY_LANGUAGE,
        spokenLanguages: ['en', 'hi'],
        status: 'ACTIVE',
        isDemo: true,
      },
      select: { id: true },
    });

    // PROD5 — grant the three scribe consents so the therapist's dry run
    // starts without extra ticks (the demo client is a fixture, not a
    // person; /start now refuses sessions missing CROSS_BORDER_PROCESSING).
    await tx.consent.createMany({
      data: (['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'] as const).map(
        (scope) => ({
          clientId: client.id,
          psychologistId,
          scope,
          status: 'GRANTED' as const,
          scriptVersion: 'v1.0',
          capturedVia: 'IN_PERSON' as const,
          grantedAt: intakeAt,
          notes: 'Demo fixture — synthetic client, seeded at onboarding',
        }),
      ),
    });

    const episode = await tx.treatmentEpisode.create({
      data: {
        clientId: client.id,
        psychologistId,
        status: 'OPEN',
        openedAt: intakeAt,
      },
      select: { id: true },
    });

    // Problem list (POMR) — the Plan of care's first section: named
    // problems with status, one resolved mid-arc.
    await tx.problemListItem.createMany({
      data: [
        {
          clientId: client.id,
          psychologistId,
          title: 'Depressed mood with withdrawal from valued activity',
          detail: 'Four months of low mood and anhedonia; activity re-engagement is the lever.',
          status: 'ACTIVE' as const,
          createdAt: intakeAt,
        },
        {
          clientId: client.id,
          psychologistId,
          title: 'Generalised worry across work, family and health domains',
          detail: 'Cross-domain worry persisting at lower intensity as mood lifts; GAD-7 tracked.',
          status: 'ACTIVE' as const,
          createdAt: intakeAt,
        },
        {
          clientId: client.id,
          psychologistId,
          title: 'Sleep-onset disruption maintaining next-day appraisal',
          detail: 'Resolved with the fixed sleep window after the layoff-week collapse.',
          status: 'RESOLVED' as const,
          resolvedAt: sessionDates[4]!,
          createdAt: intakeAt,
        },
      ],
    });

    // ---------- INTAKE SESSION ----------
    const intakeSession = await tx.session.create({
      data: {
        clientId: client.id,
        psychologistId,
        modality: 'INTAKE',
        kind: 'INTAKE',
        status: 'COMPLETED',
        scheduledAt: intakeAt,
        startedAt: intakeAt,
        endedAt: new Date(intakeAt.getTime() + 50 * 60 * 1000),
        language: DEMO_PRIMARY_LANGUAGE,
        spokenLanguages: transcripts[0]!.spokenLanguages,
      },
      select: { id: true },
    });

    const intakeDraft = await tx.noteDraft.create({
      data: {
        sessionId: intakeSession.id,
        status: 'COMPLETED',
        content: intakeBody as unknown as Prisma.InputJsonValue,
        riskSeverity: 'LOW',
        transcript: transcripts[0]!.transcript,
        speakerSegments: transcripts[0]!.segments as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    await tx.therapyNote.create({
      data: {
        sessionId: intakeSession.id,
        draftId: intakeDraft.id,
        version: 'V1',
        content: intakeBody as unknown as Prisma.InputJsonValue,
        signedAt: new Date(intakeAt.getTime() + 60 * 60 * 1000),
        signedBy: psychologistId,
      },
    });

    // Initial Assessment Brief on the intake — Pass 3 output for INTAKE
    // sessions stores InitialAssessmentBriefV1 in `body`.
    await tx.clinicalReport.create({
      data: {
        sessionId: intakeSession.id,
        clientId: client.id,
        psychologistId,
        status: 'COMPLETED',
        body: initialBrief as unknown as Prisma.InputJsonValue,
        confirmations: PENDING_SECTION_CONFIRMATIONS as unknown as Prisma.InputJsonValue,
        createdAt: new Date(intakeAt.getTime() + 55 * 60 * 1000),
      },
    });

    // ---------- TREATMENT SESSIONS ----------
    // Each session carries ITS OWN note, report, transcript, alliance read
    // and agreements — the six-week arc reads as an evolving case, not a
    // copy-pasted one: setup → layoff setback (medium crisis + safety plan)
    // → stabilisation (plan v2 + formulation v2) → traction → remission.
    const firstTreatmentDate = treatmentDates[0]!;
    // The alliance dips exactly when the case does (T2, the layoff week).
    const allianceArc = ['FLAT', 'ROUGH', 'GOOD', 'STRONG', 'STRONG'] as const;
    const riskArc = ['NONE', 'MEDIUM', 'NONE', 'NONE', 'NONE'] as const;
    const treatmentSessionIds: string[] = [];
    const treatmentReportIds: string[] = [];

    for (let i = 0; i < treatmentDates.length; i++) {
      const date = treatmentDates[i]!;
      const transcript = transcripts[i + 1]!;
      const noteBody = treatmentBodies[i]!;
      const session = await tx.session.create({
        data: {
          clientId: client.id,
          psychologistId,
          modality: 'CBT',
          kind: 'TREATMENT',
          status: 'COMPLETED',
          scheduledAt: date,
          startedAt: date,
          endedAt: new Date(date.getTime() + 50 * 60 * 1000),
          language: DEMO_PRIMARY_LANGUAGE,
          spokenLanguages: transcript.spokenLanguages,
          allianceRating: allianceArc[i],
        },
        select: { id: true },
      });
      treatmentSessionIds.push(session.id);

      const draft = await tx.noteDraft.create({
        data: {
          sessionId: session.id,
          status: 'COMPLETED',
          content: noteBody as unknown as Prisma.InputJsonValue,
          riskSeverity: riskArc[i],
          transcript: transcript.transcript,
          speakerSegments: transcript.segments as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      await tx.therapyNote.create({
        data: {
          sessionId: session.id,
          draftId: draft.id,
          version: 'V1',
          content: noteBody as unknown as Prisma.InputJsonValue,
          signedAt: new Date(date.getTime() + 60 * 60 * 1000),
          signedBy: psychologistId,
        },
      });

      // Clinical report per session; only the first carries the ACCEPTED
      // confirmations (where diagnosis + plan were locked in).
      const confirmations: ClinicalSectionConfirmations =
        i === 0
          ? buildAcceptedConfirmations(firstTreatmentDate, psychologistId)
          : PENDING_SECTION_CONFIRMATIONS;

      const report = await tx.clinicalReport.create({
        data: {
          sessionId: session.id,
          clientId: client.id,
          psychologistId,
          status: 'COMPLETED',
          body: reportBodies[i]! as unknown as Prisma.InputJsonValue,
          confirmations: confirmations as unknown as Prisma.InputJsonValue,
          createdAt: new Date(date.getTime() + 55 * 60 * 1000),
        },
        select: { id: true },
      });
      treatmentReportIds.push(report.id);
    }

    const firstTreatmentSessionId = treatmentSessionIds[0]!;
    const firstTreatmentReportId = treatmentReportIds[0]!;

    // Confirmed diagnoses — the comorbid pair, both active: moderate
    // depression (primary) + generalised anxiety disorder (secondary),
    // locked in from the first treatment report.
    const confirmedAtT1 = new Date(firstTreatmentDate.getTime() + 30 * 60 * 1000);
    const diagnosis = await tx.clientDiagnosis.create({
      data: {
        clientId: client.id,
        psychologistId,
        sessionId: firstTreatmentSessionId,
        clinicalReportId: firstTreatmentReportId,
        icd11Code: '6A70.1',
        icd11Label: 'Single episode depressive disorder, moderate, without psychotic symptoms',
        confidence: 0.78,
        supportingEvidence: reportBodies[0]!.diagnosisCandidates[0]!
          .supportingEvidence as unknown as Prisma.InputJsonValue,
        isPrimary: true,
        confirmedAt: confirmedAtT1,
        confirmedByPsychologistId: psychologistId,
      },
      select: { id: true },
    });
    await tx.clientDiagnosis.create({
      data: {
        clientId: client.id,
        psychologistId,
        sessionId: firstTreatmentSessionId,
        clinicalReportId: firstTreatmentReportId,
        icd11Code: '6B00',
        icd11Label: 'Generalised anxiety disorder',
        confidence: 0.61,
        supportingEvidence: reportBodies[0]!.diagnosisCandidates[1]!
          .supportingEvidence as unknown as Prisma.InputJsonValue,
        isPrimary: false,
        confirmedAt: confirmedAtT1,
        confirmedByPsychologistId: psychologistId,
      },
    });

    // Treatment plan v1 (confirmed T1) → superseded by v2 at T3, which
    // added the sleep + worry goals after the layoff-week collapse. The
    // version history is the point: plans that never change are plans
    // nobody is using.
    const planV2ConfirmedAt = new Date(treatmentDates[2]!.getTime() + 40 * 60 * 1000);
    await tx.treatmentPlan.create({
      data: {
        clientId: client.id,
        psychologistId,
        sourceSessionId: firstTreatmentSessionId,
        sourceClinicalReportId: firstTreatmentReportId,
        version: 1,
        body: planV1Body as unknown as Prisma.InputJsonValue,
        confirmedAt: confirmedAtT1,
        confirmedByPsychologistId: psychologistId,
        supersededAt: planV2ConfirmedAt,
      },
    });
    const plan = await tx.treatmentPlan.create({
      data: {
        clientId: client.id,
        psychologistId,
        sourceSessionId: treatmentSessionIds[2]!,
        sourceClinicalReportId: treatmentReportIds[2]!,
        version: 2,
        body: planV2Body as unknown as Prisma.InputJsonValue,
        confirmedAt: planV2ConfirmedAt,
        confirmedByPsychologistId: psychologistId,
      },
      select: { id: true },
    });

    // Per-goal progress on the ACTIVE plan (v2): activities + sleep
    // achieved; the score goal and the worry window still in progress.
    const goalStatuses = ['ACHIEVED', 'IN_PROGRESS', 'ACHIEVED', 'IN_PROGRESS'] as const;
    for (let g = 0; g < goalStatuses.length; g++) {
      await tx.treatmentGoalProgress.create({
        data: {
          treatmentPlanId: plan.id,
          goalIndex: g,
          status: goalStatuses[g]!,
          updatedByPsychologistId: psychologistId,
        },
      });
    }

    // The living formulation — v1 (T1, breakup-centric) superseded by v2
    // (T3): the layoff week disproved v1's "workload eases → mood lifts"
    // prediction, so the formulation was revised. That supersession IS the
    // demo: the record thinks in versions, not overwrites.
    const formulationV2At = new Date(treatmentDates[2]!.getTime() + 45 * 60 * 1000);
    await tx.caseFormulation.create({
      data: {
        clientId: client.id,
        psychologistId,
        sourceSessionId: firstTreatmentSessionId,
        version: 1,
        body: formulationV1Body as unknown as Prisma.InputJsonValue,
        confirmedAt: new Date(firstTreatmentDate.getTime() + 35 * 60 * 1000),
        supersededAt: formulationV2At,
      },
    });
    await tx.caseFormulation.create({
      data: {
        clientId: client.id,
        psychologistId,
        sourceSessionId: treatmentSessionIds[2]!,
        version: 2,
        body: formulationV2Body as unknown as Prisma.InputJsonValue,
        confirmedAt: formulationV2At,
      },
    });

    // Safety plan — built collaboratively in the layoff-week session (T2)
    // when passive ideation surfaced. Still active; the crisis resolved but
    // the plan stays on the record.
    await tx.safetyPlan.create({
      data: {
        clientId: client.id,
        psychologistId,
        sourceSessionId: treatmentSessionIds[1]!,
        language: 'en',
        body: safetyPlanBody as unknown as Prisma.InputJsonValue,
        confirmedAt: new Date(treatmentDates[1]!.getTime() + 45 * 60 * 1000),
        confirmedByPsychologistId: psychologistId,
      },
    });

    // ---------- Instrument trends ----------
    // PHQ-9 at intake, T1, T2 (the 19 spike), T4, T5; GAD-7 at intake,
    // T3, T5. Final scores 4 + 4 hit both remission bands so the Journey
    // hub flips to DISCHARGE_READY — but the trend the therapist scrolls
    // is honest: it went UP before it came down.
    const phq9SessionIds: (string | null)[] = [
      intakeSession.id,
      treatmentSessionIds[0]!,
      treatmentSessionIds[1]!,
      treatmentSessionIds[3]!,
      treatmentSessionIds[4]!,
    ];
    const phq9Dates = [
      intakeAt,
      treatmentDates[0]!,
      treatmentDates[1]!,
      treatmentDates[3]!,
      treatmentDates[4]!,
    ];
    for (let i = 0; i < scoredPhq9.length; i++) {
      const { responses, result } = scoredPhq9[i]!;
      await tx.instrumentResponse.create({
        data: {
          clientId: client.id,
          psychologistId,
          sessionId: phq9SessionIds[i] ?? null,
          instrumentKey: 'PHQ9',
          language: 'en',
          responses: responses as unknown as Prisma.InputJsonValue,
          score: result.score,
          severity: result.severityKey,
          administeredAt: phq9Dates[i]!,
          administeredByPsychologistId: psychologistId,
          administrationMode: 'CLINICIAN',
        },
      });
    }
    const gad7SessionIds = [intakeSession.id, treatmentSessionIds[2]!, treatmentSessionIds[4]!];
    const gad7Dates = [intakeAt, treatmentDates[2]!, treatmentDates[4]!];
    for (let i = 0; i < scoredGad7.length; i++) {
      const { responses, result } = scoredGad7[i]!;
      await tx.instrumentResponse.create({
        data: {
          clientId: client.id,
          psychologistId,
          sessionId: gad7SessionIds[i]!,
          instrumentKey: 'GAD7',
          language: 'en',
          responses: responses as unknown as Prisma.InputJsonValue,
          score: result.score,
          severity: result.severityKey,
          administeredAt: gad7Dates[i]!,
          administeredByPsychologistId: psychologistId,
          administrationMode: 'CLINICIAN',
        },
      });
    }

    // ---------- Therapy script cache row ----------
    await tx.therapyScript.create({
      data: {
        clientId: client.id,
        psychologistId,
        therapyName: scriptBody.therapyName,
        language: scriptBody.language,
        // Deterministic cache key derived from the demo identity.
        cacheKey: deterministicScriptCacheKey(client.id, scriptBody.therapyName),
        body: scriptBody as unknown as Prisma.InputJsonValue,
        sourceTreatmentPlanId: plan.id,
        sourcePrimaryDiagnosisId: diagnosis.id,
      },
    });

    // ---------- Assessment items (the running differential ledger) ----------
    // Three questions asked and CLOSED with findings across the arc, one
    // still OPEN — the ledger shows its lifecycle, not just its end state.
    await tx.assessmentItem.createMany({
      data: [
        {
          clientId: client.id,
          psychologistId,
          episodeId: episode.id,
          kind: 'ASSESSMENT_GAP',
          question: 'Confirm no episodes of elevated mood lasting >= 4 days.',
          rationale:
            'Rule out bipolar spectrum before committing to single-episode depressive disorder.',
          icd11Code: '6A70.1',
          status: 'CLOSED',
          sourceSessionId: intakeSession.id,
          addressedSessionId: firstTreatmentSessionId,
          resolutionNote: 'No history of hypomanic / manic episodes by detailed timeline.',
          closedAt: new Date(firstTreatmentDate.getTime() + 60 * 60 * 1000),
        },
        {
          clientId: client.id,
          psychologistId,
          episodeId: episode.id,
          kind: 'ASSESSMENT_GAP',
          question: 'Screen alcohol use — any change alongside the low mood?',
          rationale:
            'Substance use both mimics and maintains depressive presentations; cheap to rule out early.',
          status: 'CLOSED',
          sourceSessionId: firstTreatmentSessionId,
          addressedSessionId: treatmentSessionIds[1]!,
          resolutionNote:
            'AUDIT-C-style screen negative: 1-2 drinks socially about once a month, no increase during the episode.',
          closedAt: new Date(treatmentDates[1]!.getTime() + 60 * 60 * 1000),
        },
        {
          clientId: client.id,
          psychologistId,
          episodeId: episode.id,
          kind: 'ASSESSMENT_GAP',
          question: 'Does the worry persist across domains once mood lifts, or is it work-bound?',
          rationale:
            'Differentiates comorbid GAD from anxious distress within the depressive episode — changes the maintenance-phase target.',
          icd11Code: '6B00',
          status: 'CLOSED',
          sourceSessionId: firstTreatmentSessionId,
          addressedSessionId: treatmentSessionIds[2]!,
          resolutionNote:
            'Worry narrows with mood improvement but persists across domains (job, sister’s visa, father’s health) at lower intensity. Keep 6B00 active; GAD-7 tracked.',
          closedAt: new Date(treatmentDates[2]!.getTime() + 60 * 60 * 1000),
        },
        {
          clientId: client.id,
          psychologistId,
          episodeId: episode.id,
          kind: 'INSTRUMENT',
          question: 'Re-administer PHQ-9 and GAD-7 at session 8 to confirm sustained remission.',
          rationale:
            'Both instruments in remission range at the latest administration. Confirm durability over a further 2 weeks before discharge.',
          status: 'OPEN',
          sourceSessionId: treatmentSessionIds.at(-1)!,
        },
      ],
    });

    // ---------- Session agreements (the loop, visible across the arc) ----------
    // Every session leaves agreements in the client's words; the NEXT
    // session marks the follow-up. The last session's pair stays unmarked —
    // that's what the therapist's Prepare card will read back.
    const agreementRows: {
      sessionIndex: number;
      speaker: 'CLIENT' | 'THERAPIST';
      text: string;
      followUp?: 'DONE' | 'PARTLY' | 'NOT_YET';
    }[] = [
      {
        sessionIndex: 0,
        speaker: 'CLIENT',
        text: 'Three activities this week: Tuesday walk after standup, call Meera on Thursday, Saturday walk with Rahul.',
        followUp: 'PARTLY',
      },
      {
        sessionIndex: 0,
        speaker: 'THERAPIST',
        text: 'Write down the Sunday-evening thought once, as it happens — exact words.',
        followUp: 'DONE',
      },
      {
        sessionIndex: 1,
        speaker: 'CLIENT',
        text: 'One ten-minute walk every day, even on the worst day. That is the whole plan this week.',
        followUp: 'DONE',
      },
      {
        sessionIndex: 1,
        speaker: 'THERAPIST',
        text: 'One-line message midweek — just how sleep went.',
        followUp: 'DONE',
      },
      {
        sessionIndex: 2,
        speaker: 'CLIENT',
        text: 'Worries go on the list, and the list waits till 6pm.',
        followUp: 'PARTLY',
      },
      {
        sessionIndex: 2,
        speaker: 'THERAPIST',
        text: 'Keep the sleep window: screens away by 11, lights out by 11:30.',
        followUp: 'DONE',
      },
      {
        sessionIndex: 3,
        speaker: 'CLIENT',
        text: 'Badminton on Saturday — and I tell the group I am coming, so it is harder to cancel.',
        followUp: 'DONE',
      },
      {
        sessionIndex: 4,
        speaker: 'CLIENT',
        text: "I'll go to badminton on Saturday even if I don't feel like it — mood follows action.",
      },
      {
        sessionIndex: 4,
        speaker: 'THERAPIST',
        text: 'Bring the thought record for the Sunday-evening dread; we review it first thing.',
      },
    ];
    for (const a of agreementRows) {
      const madeAt = treatmentDates[a.sessionIndex]!;
      const nextDate = treatmentDates[a.sessionIndex + 1] ?? null;
      await tx.sessionAgreement.create({
        data: {
          sessionId: treatmentSessionIds[a.sessionIndex]!,
          clientId: client.id,
          psychologistId,
          speaker: a.speaker,
          text: a.text,
          followUp: a.followUp ?? null,
          followUpAt: a.followUp && nextDate ? new Date(nextDate.getTime() + 20 * 60 * 1000) : null,
          createdAt: new Date(madeAt.getTime() + 45 * 60 * 1000),
        },
      });
    }

    // ---------- Homework (real assignment rows, mixed statuses) ----------
    await tx.exerciseAssignment.createMany({
      data: [
        {
          clientId: client.id,
          psychologistId,
          source: 'THERAPY_SCRIPT' as const,
          customDescription:
            'Three planned activities this week, with mood (0-10) noted just before and after each.',
          assignedAt: new Date(firstTreatmentDate.getTime() + 50 * 60 * 1000),
          status: 'COMPLETED' as const,
          completedAt: treatmentDates[1]!,
        },
        {
          clientId: client.id,
          psychologistId,
          source: 'THERAPY_SCRIPT' as const,
          customDescription:
            'Worry-postponement window: 20 minutes at 6pm; worries parked to the list until then.',
          assignedAt: new Date(treatmentDates[2]!.getTime() + 50 * 60 * 1000),
          status: 'COMPLETED' as const,
          completedAt: treatmentDates[3]!,
        },
        {
          clientId: client.id,
          psychologistId,
          source: 'CATALOG' as const,
          exerciseId: 'cbt_thought_record_5col',
          therapistNote: 'One five-column record on the Sunday-evening dread.',
          assignedAt: new Date(treatmentDates[3]!.getTime() + 50 * 60 * 1000),
          status: 'IN_PROGRESS' as const,
        },
        {
          clientId: client.id,
          psychologistId,
          source: 'THERAPY_SCRIPT' as const,
          customDescription:
            'Draft your relapse-prevention card: the three earliest warning signs and the first two moves.',
          assignedAt: new Date(treatmentDates[4]!.getTime() + 50 * 60 * 1000),
          dueAt: new Date(treatmentDates[4]!.getTime() + 7 * 24 * 60 * 60 * 1000),
          status: 'PENDING' as const,
        },
      ],
    });

    return client.id;
  });

  // ---------- Patient-share row carrying the Progress Report ----------
  // buildProgressReport reads from the DB, so it has to run AFTER the
  // transaction commits — the instrument rows must be visible.
  const reportBuild = await buildProgressReport({
    clientId,
    psychologistId,
    intro:
      'A quick recap of what we have been tracking together. Bring any questions to our next session.',
  });
  const shareToken = generateShareToken();
  await prisma.patientShare.create({
    data: {
      clientId,
      psychologistId,
      sessionId: null,
      artefactType: 'PROGRESS_REPORT',
      // We persist the report with the clientId as the artefactId — the
      // patient-share table doesn't have a dedicated ProgressReport
      // model; the snapshot IS the artefact.
      artefactId: clientId,
      channel: 'PORTAL_LINK',
      status: 'SENT',
      shareToken,
      language: DEMO_PRIMARY_LANGUAGE,
      snapshot: reportBuild.snapshot as unknown as Prisma.InputJsonValue,
      subject: reportBuild.subject,
      toContact: null,
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: actorPsychologistId,
    action: 'DEMO_CLIENT_CREATED',
    targetType: 'Client',
    targetId: clientId,
    metadata: { isDemo: true },
  });

  return { clientId, created: true };
}

/**
 * Hard-delete the demo client in FK-safe order. Mirrors
 * `cleanupLegacySeedRows` in `prisma/seed.ts`. Several session-
 * referencing tables have no `onDelete: Cascade`, so the order
 * matters.
 */
export async function removeDemoClient(
  psychologistId: string,
  actorPsychologistId: string,
): Promise<RemoveDemoClientResult> {
  const existing = await findDemoClient(psychologistId);
  if (!existing) {
    return { removed: false, clientId: null };
  }
  const clientId = existing.id;

  await prisma.$transaction(async (tx) => {
    const sessionIds = (
      await tx.session.findMany({ where: { clientId }, select: { id: true } })
    ).map((s) => s.id);
    const therapyNoteIds = (
      await tx.therapyNote.findMany({
        where: { sessionId: { in: sessionIds } },
        select: { id: true },
      })
    ).map((n) => n.id);
    const treatmentPlanIds = (
      await tx.treatmentPlan.findMany({ where: { clientId }, select: { id: true } })
    ).map((p) => p.id);

    // Leaves first.
    await tx.treatmentGoalProgress.deleteMany({
      where: { treatmentPlanId: { in: treatmentPlanIds } },
    });
    await tx.noteEdit.deleteMany({ where: { therapyNoteId: { in: therapyNoteIds } } });

    await tx.therapyScript.deleteMany({ where: { clientId } });
    await tx.therapyNote.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.noteDraft.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.clientDiagnosis.deleteMany({ where: { clientId } });
    await tx.treatmentPlan.deleteMany({ where: { clientId } });
    await tx.clinicalReport.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.patientShare.deleteMany({ where: { clientId } });
    await tx.instrumentResponse.deleteMany({ where: { clientId } });
    await tx.safetyPlan.deleteMany({ where: { clientId } });
    await tx.preSessionBrief.deleteMany({ where: { clientId } });
    await tx.clientConceptualMap.deleteMany({ where: { clientId } });
    await tx.assessmentItem.deleteMany({ where: { clientId } });
    await tx.sessionAgreement.deleteMany({ where: { clientId } });
    await tx.caseFormulation.deleteMany({ where: { clientId } });
    await tx.sessionProblemLink.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.problemListItem.deleteMany({ where: { clientId } });
    await tx.exerciseAssignment.deleteMany({ where: { clientId } });
    await tx.treatmentEpisode.deleteMany({ where: { clientId } });
    await tx.consent.deleteMany({ where: { clientId } });
    await tx.audioChunk.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.geminiCallLog.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await tx.session.deleteMany({ where: { clientId } });
    await tx.client.delete({ where: { id: clientId } });

    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId,
        action: 'DEMO_CLIENT_REMOVED',
        targetType: 'Client',
        targetId: clientId,
        metadata: { isDemo: true },
      },
      tx,
    );
  });

  return { removed: true, clientId };
}

// ============================================================================
// Fabrication helpers — deterministic content validated through the real
// schemas in createDemoClient(). Edit copy here, schema drift is caught
// at parse time so partial rows can't land.
// ============================================================================

function buildIntakeNote(): IntakeNoteV1 {
  return {
    version: 'V1',
    linkedEvidence: [],
    presentingConcerns:
      'Ananya, a 29-year-old software engineer in Bengaluru, presents with a four-month period of persistent low mood, anhedonia, and concentration difficulty that has begun to affect her work performance. She booked the session after a conversation with a close friend who had been through therapy.',
    historyOfPresentingIllness:
      'Onset four months ago following an extended performance-review cycle at work; precipitant subjectively absent but timing aligns with a relationship breakup. Course is gradual worsening rather than episodic. Severity: subjectively "8 out of 10 on the heaviest days." Triggers: Sunday evenings, performance reviews, family calls about marriage. Alleviators: time with one friend, running, weekend trips — but engagement with each has reduced over the last month.',
    pastPsychiatricHistory:
      'No prior diagnoses, no prior therapy, no psychiatric medication. No hospitalisations. Has not seen a psychiatrist.',
    familyHistory:
      'Mother treated for depression in her 40s with an SSRI for ~18 months, full recovery. No other psychiatric history known. Maternal grandmother had a stroke in her 60s.',
    socialHistory:
      'Currently single, lives alone in a rented flat in HSR Layout. Family of origin in Chennai, parents and one younger sister, calls weekly. Educated through B.Tech (NIT, 2018). Works full-time as a senior engineer at a mid-stage startup; manager is supportive. One close friend in Bengaluru, a small wider circle. No substance use beyond occasional social alcohol (1-2 drinks once a month). Sleep schedule has shifted later in the last two months.',
    mentalStatusExam:
      'Appearance: well-groomed, casually dressed. Behaviour: cooperative, eye contact briefly avoidant. Speech: normal rate, slightly soft volume. Mood: "low, flat." Affect: constricted, congruent. Thought process: linear, goal-directed. Thought content: negative self-evaluations ("I am letting everyone down"), no delusional content. Perception: no abnormal perceptions. Cognition: alert, oriented, attention mildly reduced. Insight: good. Judgement: good.',
    workingHypothesis:
      'Working hypothesis is a single episode of moderate depressive disorder (ICD-11 6A70.1), with possible adjustment context. Differential to clarify next session: bipolar spectrum (no obvious history but worth confirming), generalised anxiety co-occurrence (worry content present), persistent depressive disorder (timeline not yet long enough by definition).',
    immediatePlan:
      'Administer PHQ-9 and GAD-7 next session as a baseline. Provide psychoeducation on the moderate depression model. Confirm no active safety concerns; collaborate on a low-burden between-session goal (one 20-minute walk). Schedule weekly CBT sessions for the next 6-8 weeks pending confirmation of working hypothesis.',
    riskFlags: {
      severity: 'low',
      indicators: [],
      details:
        'No passive or active suicidal ideation reported. No intent, plan, means, or history. Subjective wish that "things were lighter" but explicitly distinct from a wish to be dead. Re-screen each session via PHQ-9 item 9.',
    },
  };
}

function buildInitialAssessmentBrief(): InitialAssessmentBriefV1 {
  return {
    version: 'V1',
    language: 'en',
    workingHypothesis:
      'A single episode of moderate depressive disorder (ICD-11 6A70.1), with the presenting picture more consistent with depression than with a primary anxiety disorder. Pending differential: bipolar spectrum (no evidence yet), persistent depressive disorder (duration threshold not met).',
    differential: [
      {
        icd11Code: '6A70.1',
        icd11Label: 'Single episode depressive disorder, moderate, without psychotic symptoms',
        confidence: 0.7,
        supportingEvidence: [
          {
            quote:
              'I just feel flat most of the time, even on the weekends I used to look forward to.',
            speaker: 'client',
            startMs: 0,
          },
          {
            quote: "I can't seem to focus at work for more than ten minutes at a stretch.",
            speaker: 'client',
            startMs: 0,
          },
        ],
        gapsToFill: [
          'Confirm duration of low mood is between 2 weeks and 12 months for single-episode',
          'Confirm anhedonia or low mood present most of the day, nearly every day',
        ],
      },
      {
        icd11Code: '6B00',
        icd11Label: 'Generalised anxiety disorder',
        confidence: 0.25,
        supportingEvidence: [
          {
            quote: 'My head is constantly on the next thing I am dropping.',
            speaker: 'client',
            startMs: 0,
          },
        ],
        gapsToFill: [
          'Administer GAD-7 to quantify worry burden',
          'Confirm worry across multiple domains, not solely work-related',
        ],
      },
    ],
    assessmentGaps: [
      {
        question: 'Confirm no episodes of elevated mood lasting >= 4 days.',
        rationale: 'Rules out bipolar spectrum before committing to a treatment direction.',
        purpose: 'differentiate',
        targets: ['6A70.1', '6A60'],
      },
      {
        question: 'Establish baseline PHQ-9 and GAD-7 next session.',
        rationale: 'Anchors the measurement-based-care arc and reliable-change tracking.',
        purpose: 'context',
        targets: [],
      },
    ],
    formulation:
      'Ananya presents with a four-month period of moderate low mood, anhedonia, and concentration impairment, in the context of relationship change and work-pressure cycles. No prior episodes; family history of treated depression. No active safety concerns. Working hypothesis is a single moderate depressive episode; bipolar spectrum and GAD co-occurrence to be ruled out at the next session.',
    recommendedTherapies: [
      {
        name: 'Behavioural Activation',
        rationale:
          'First-line evidence for moderate depression, requires low cognitive load early in the episode, and matches her presenting withdrawal from previously valued activities.',
        evidenceSummary:
          'Meta-analyses (Mazzucchelli et al., 2009; Cuijpers et al., 2014) place BA in the first tier for adult depression with effect sizes comparable to CBT.',
        whenInPlan: 'Engagement & psychoeducation',
      },
    ],
    recommendedInstruments: ['PHQ9', 'GAD7'],
    crisisFlags: [],
  };
}

/**
 * Five DISTINCT session notes telling the arc: setup → layoff setback (the
 * medium-risk session) → stabilisation → traction → remission. A therapist
 * clicking through sessions reads an evolving case, not a copy-pasted one.
 */
function buildTreatmentNotes(): TherapyNoteV1[] {
  const none = { severity: 'none' as const, indicators: [] };
  return [
    {
      version: 'V1',
      linkedEvidence: [],
      modality: 'CBT',
      summary:
        'First treatment session. Mapped the Sunday-evening maintaining cycle in her own words, introduced the CBT model, and agreed a first behavioural-activation plan. Engaged but guarded; comorbid worry burden is real (GAD-7 15 at intake) and tracked separately.',
      subjective:
        'Reports the week was "the usual grey." Worry threads: the Monday review meeting, family calls that land on marriage, a sense of being the only one in the team not moving forward. Weekends flat; skipped badminton for the sixth week. Sleep onset ~1am.',
      objective:
        'On time, well-groomed. Affect constricted, brightens briefly when describing the badminton group. PHQ-9 15 today (down from 18 at intake). Thought content: comparison-based self-criticism; no perceptual disturbance. No SI on direct screen.',
      assessment:
        'Presentation consistent with a moderate depressive episode with comorbid generalised worry (6B00 tracked with GAD-7). The Sunday-evening cycle — week-preview trigger → "falling behind" appraisal → heaviness → cancelling plans → no disconfirming evidence — mapped collaboratively and landed; she named the loop herself by the end.',
      plan: 'Behavioural activation phase 1: three anchored activities this week. Psychoeducation handout shared. Confirm diagnosis pair + treatment plan v1. Baseline instruments recorded; PHQ-9 weekly for now.',
      riskFlags: none,
      phaseHints: [
        {
          phase: 'Engagement & psychoeducation',
          confidence: 0.9,
          rationale: 'First treatment session; model landed, first activation plan agreed.',
        },
      ],
      topics: [
        {
          title: 'The Sunday-evening cycle',
          points: [
            'Trigger: the week coming into view on Sunday evening',
            'Appraisal: "I am falling behind everyone at work"',
            'Response: cancelling plans, staying in, late scrolling',
          ],
        },
        {
          title: 'First activation plan',
          points: [
            'Tuesday walk after standup; Thursday call with Meera; Saturday walk with Rahul',
            'Mood (0-10) noted before and after each',
          ],
        },
      ],
    },
    {
      version: 'V1',
      linkedEvidence: [],
      modality: 'CBT',
      summary:
        'Layoff round announced at work this week. Mood and sleep dipped sharply, activities lapsed, and passive ideation surfaced ("what is the point") — no intent, no plan, no means. Safety plan built together in session; activation paused in favour of stabilisation.',
      subjective:
        'Layoffs announced Tuesday; two people on her team let go. Sleep 4-5 hours since. Walks stopped mid-week ("it felt pointless"). On direct questioning: "Some nights I think, what is the point of all this. Not that I would do anything — it just feels pointless." Denies intent, plan, means, or rehearsal. Wants to keep working on this.',
      objective:
        'Visibly exhausted, tearful once mid-session, composed by close. PHQ-9 19 today — above intake. Item-9 endorsed at passive level on direct screen; risk assessment completed in session. Protective factors current and engaged: sister (daily contact this week), close friend, future-oriented statements.',
      assessment:
        'Acute stressor-driven deterioration on top of the existing moderate episode — not a failure of the approach, but the "workload eases → mood lifts" hypothesis is now in doubt. Risk: passive ideation without intent/plan/means, engaged help-seeking, strong protective factors — managed as outpatient with a collaborative safety plan and midweek check-in.',
      plan: 'Safety plan completed and shared to her phone. Activation reduced to ONE daily anchor (ten-minute walk). Sleep window agreed. Midweek one-line check-in message. Review in one week; escalate on any intent, plan, or means.',
      riskFlags: {
        severity: 'medium',
        indicators: [
          'Passive ideation: "what is the point" — no intent, plan, means, or rehearsal',
          'Sleep 4-5 hours for five consecutive nights',
          'Acute stressor: layoff round at work',
        ],
        details:
          'Full risk assessment in session: passive ideation only, credibly denied intent/plan/means, no history of self-harm, protective factors engaged. Safety plan v1 confirmed and shared. Re-screen item 9 next session.',
      },
      phaseHints: [
        {
          phase: 'Engagement & psychoeducation',
          confidence: 0.7,
          rationale: 'Acute stressor interrupts the activation phase; stabilisation first.',
        },
      ],
      topics: [
        {
          title: 'The layoff week',
          points: [
            'Two teammates let go Tuesday; her role safe "for now"',
            'Sleep collapsed to 4-5 hours; activities stopped mid-week',
          ],
        },
        {
          title: 'Safety planning',
          points: [
            'Warning signs, internal coping, and contacts agreed together',
            'Plan shared to her phone before leaving the room',
          ],
        },
      ],
    },
    {
      version: 'V1',
      linkedEvidence: [],
      modality: 'CBT',
      summary:
        'Stabilising. Sleep back to ~6.5 hours with the fixed window; no ideation since the layoff week. Worry is now the louder signal — worry-postponement started, plan updated to v2 (sleep + worry goals added), and the formulation revised: the "workload eases" prediction did not match.',
      subjective:
        'Daily ten-minute walks held all seven days — "it was the only rule, so I kept it." Sleep window kept 5 of 7 nights. Worry list content: job security, her sister\'s visa renewal, her father\'s blood-pressure report. "The mood is a bit better but my head will not stop planning for disasters."',
      objective:
        'Steadier. Affect reactive and appropriate. GAD-7 11 today (from 15 at intake). PHQ-9 item-9 screen clear; no ideation reported since the layoff week. Engaged actively in revising the formulation — corrected the therapist twice, which is the alliance recovering.',
      assessment:
        'The layoff week disconfirmed the v1 hypothesis that mood would lift when work quietened — mood dipped WITH workload flat, driven by threat appraisal rather than load. Formulation revised to v2 (threat-of-loss appraisal + short sleep as amplifier). Worry generalises across domains at lower intensity — 6B00 stays active; worry-postponement is the right tool for the maintenance phase.',
      plan: 'Plan v2 confirmed: sleep goal + worry-postponement goal added. Worry window 20 minutes at 6pm. Sleep window continues. Re-administer GAD-7 in two sessions; PHQ-9 next session.',
      riskFlags: none,
      phaseHints: [
        {
          phase: 'Active treatment',
          confidence: 0.8,
          rationale:
            'Stabilised post-stressor; active-phase tools (worry postponement) introduced.',
        },
      ],
      topics: [
        {
          title: 'What the setback taught the formulation',
          points: [
            'Mood dipped with workload unchanged — threat appraisal, not load, drives the loop',
            'Short sleep amplifies next-day appraisal',
          ],
        },
        {
          title: 'Worry postponement',
          points: ['Worries parked to a list until the 6pm window', 'List reviewed in session'],
        },
      ],
    },
    {
      version: 'V1',
      linkedEvidence: [],
      modality: 'CBT',
      summary:
        'Re-activation is holding: badminton twice, walks daily, and one difficult work conversation handled with a thought record instead of a night of rumination. PHQ-9 9 — first reliable improvement from baseline.',
      subjective:
        'Went back to badminton Saturday AND Wednesday — "I told the group I was coming, so I could not cancel." Used the thought record after the Monday review: caught "I am about to be found out," wrote the evidence column, "and it just… deflated." Sunday evening still heavy but shorter.',
      objective:
        'Brighter, spontaneous humour twice. PHQ-9 9 today — a 9-point drop from intake baseline (reliable improvement threshold is 5). Sleep 6-7 hours. Worry window kept 5 of 7 days.',
      assessment:
        "Clear treatment response on the primary episode. The activity-mood link is now HER evidence, not the therapist's claim — she cited the badminton effect unprompted. Residual: Sunday-evening appraisal (shorter but present), cross-domain worry at lower intensity.",
      plan: 'Maintain activation anchors. One thought record per week on the strongest appraisal. Continue worry window. PHQ-9 + GAD-7 next session; if both hold, open the relapse-prevention conversation.',
      riskFlags: none,
      phaseHints: [
        {
          phase: 'Active treatment',
          confidence: 0.9,
          rationale: 'Reliable improvement reached; consolidation is in sight.',
        },
      ],
      topics: [
        {
          title: 'The badminton experiment',
          points: [
            'Pre-commitment to the group made cancelling harder',
            'Mood after: 6/10 vs 3/10 before — her own data',
          ],
        },
        {
          title: 'Thought record on the review meeting',
          points: ['"I am about to be found out" → evidence column → belief dropped 80% → 35%'],
        },
      ],
    },
    {
      version: 'V1',
      linkedEvidence: [],
      modality: 'CBT',
      summary:
        'PHQ-9 4 and GAD-7 4 — both in remission range, with reliable improvement from baseline on each. Session focused on relapse prevention: earliest warning signs, the first two moves, and what she keeps from the work. Review-and-discharge conversation opened for session eight.',
      subjective:
        '"It is the Monday review I replay at night now, not the breakup" — and even that, she says, is quieter. Badminton three weeks straight: "They keep asking me to come back on Saturdays, and I have gone three weeks straight." Sleep steady. Sunday evenings "normal-person dread, not the pit."',
      objective:
        'Relaxed, future-oriented. PHQ-9 4, GAD-7 4 — remission bands on both, sustained sleep and activity. Item-9 clear for four consecutive weeks.',
      assessment:
        'Remission reached on both tracked instruments with the behavioural scaffolding intact — the right moment to consolidate rather than extend. Residual vulnerability: appraisal-driven rumination under evaluation pressure; the relapse-prevention card targets exactly that trigger.',
      plan: 'Draft relapse-prevention card as homework. Taper conversation opened: review at session eight with both instruments; if remission holds, move to fortnightly then discharge with the Progress Report shared. Keep Saturday badminton as the standing anchor.',
      riskFlags: none,
      phaseHints: [
        {
          phase: 'Consolidation & relapse-prevention',
          confidence: 0.85,
          rationale: 'Both instruments in remission; consolidation phase entered.',
        },
      ],
      topics: [
        {
          title: 'What she keeps',
          points: [
            'Mood follows action — the badminton evidence',
            'The 6pm worry window',
            'The five-column record for evaluation weeks',
          ],
        },
        {
          title: 'Relapse-prevention card',
          points: [
            'Earliest signs: cancelling plans twice in a row, sleep past 1am, Sunday pit returning',
            'First two moves: tell someone, book the anchor activity',
          ],
        },
      ],
    },
  ];
}

/**
 * Five DISTINCT Pass-3 reports across the arc. Report 2 carries the medium
 * passive-SI crisis flag (the layoff week); report 5 carries the
 * formulation-as-diff suggestions AND a plan-as-diff suggestion — the
 * decision surfaces demo on real, session-specific material.
 */
function buildClinicalReports(
  planV1: ClinicalTreatmentPlan,
  planV2: ClinicalTreatmentPlan,
): ClinicalReportV1[] {
  const depressionCandidate = (confidence: number) => ({
    icd11Code: '6A70.1',
    icd11Label: 'Single episode depressive disorder, moderate, without psychotic symptoms',
    confidence,
    supportingEvidence: [
      {
        quote: 'The weekends used to be the thing I looked forward to. Now they feel flat.',
        speaker: 'client' as const,
        startMs: 0,
      },
      {
        quote: 'I can barely concentrate at work for ten minutes.',
        speaker: 'client' as const,
        startMs: 0,
      },
    ],
    gapsToFill: [],
  });
  const gadCandidate = (confidence: number) => ({
    icd11Code: '6B00',
    icd11Label: 'Generalised anxiety disorder',
    confidence,
    supportingEvidence: [
      {
        quote: 'My head will not stop planning for disasters, even when the day went fine.',
        speaker: 'client' as const,
        startMs: 0,
      },
    ],
    gapsToFill: [],
  });
  const baTherapy = {
    name: 'Behavioural Activation',
    rationale: 'Matches her withdrawal pattern; the activity-mood link is the lever.',
    evidenceSummary: 'First-line evidence for moderate depression; effect sizes comparable to CBT.',
    whenInPlan: 'Active treatment',
  };
  const restructuring = {
    name: 'Cognitive Restructuring',
    rationale: 'For the evaluation-driven appraisals once activation has stabilised.',
    evidenceSummary: 'Core CBT component, robust evidence across adult depression.',
    whenInPlan: 'Active treatment',
  };
  const worryTools = {
    name: 'Worry Postponement + Stimulus Control',
    rationale: 'Targets the cross-domain worry that persists as mood lifts (6B00).',
    evidenceSummary: 'Established GAD component treatment; reduces worry frequency and duration.',
    whenInPlan: 'Active treatment',
  };
  return [
    {
      version: 'V1',
      language: 'en',
      modality: 'CBT',
      diagnosisCandidates: [depressionCandidate(0.78), gadCandidate(0.61)],
      primaryDiagnosisIndex: 0,
      assessmentGaps: [
        {
          question: 'Screen alcohol use — any change alongside the low mood?',
          rationale: 'Substance use both mimics and maintains depressive presentations.',
          purpose: 'safety',
          targets: [],
        },
        {
          question: 'Does the worry persist across domains, or is it bound to work topics?',
          rationale: 'Differentiates comorbid GAD from anxious distress within the episode.',
          purpose: 'differentiate',
          targets: ['6B00'],
        },
      ],
      formulation:
        'Moderate depressive episode with comorbid generalised worry, maintained by a Sunday-evening appraisal loop ("falling behind") and withdrawal from valued activity. Behavioural activation begun; comorbidity tracked with GAD-7.',
      treatmentPlan: planV1,
      planSuggestions: [],
      formulationSuggestions: [],
      recommendedTherapies: [baTherapy, restructuring],
      crisisFlags: [],
    },
    {
      version: 'V1',
      language: 'en',
      modality: 'CBT',
      diagnosisCandidates: [depressionCandidate(0.8), gadCandidate(0.61)],
      primaryDiagnosisIndex: 0,
      assessmentGaps: [
        {
          question: 'Re-screen PHQ-9 item 9 and sleep at the next session.',
          rationale: 'Passive ideation surfaced this week under an acute stressor.',
          purpose: 'safety',
          targets: [],
        },
      ],
      formulation:
        'Acute deterioration under a layoff round: sleep collapse and threat-of-loss appraisal drove the loop harder while workload itself was unchanged. Passive ideation without intent, plan, or means; protective factors engaged; safety plan completed in session.',
      treatmentPlan: planV1,
      planSuggestions: [],
      formulationSuggestions: [],
      recommendedTherapies: [baTherapy],
      crisisFlags: [
        {
          kind: 'suicidal_ideation',
          severity: 'medium',
          indicators: [
            {
              quote:
                'Some nights I think, what is the point of all this. Not that I would do anything — it just feels pointless.',
              speaker: 'client',
              startMs: 0,
            },
          ],
          recommendedAction:
            'Complete a collaborative safety plan in session (done); reduce activation load to one daily anchor; midweek check-in; re-screen item 9 next session; escalate on any intent, plan, or means.',
        },
      ],
    },
    {
      version: 'V1',
      language: 'en',
      modality: 'CBT',
      diagnosisCandidates: [depressionCandidate(0.82), gadCandidate(0.66)],
      primaryDiagnosisIndex: 0,
      assessmentGaps: [
        {
          question: 'Confirm worry breadth beyond job security as mood improves.',
          rationale: 'Cross-domain persistence keeps 6B00 active and shapes the maintenance phase.',
          purpose: 'differentiate',
          targets: ['6B00'],
        },
      ],
      formulation:
        'Stabilised post-stressor. The layoff week disconfirmed the "workload eases → mood lifts" hypothesis: the driver is threat appraisal amplified by short sleep, not load. Formulation revised; sleep and worry goals added to the plan (v2).',
      treatmentPlan: planV2,
      planSuggestions: [],
      formulationSuggestions: [],
      recommendedTherapies: [baTherapy, worryTools],
      crisisFlags: [],
    },
    {
      version: 'V1',
      language: 'en',
      modality: 'CBT',
      diagnosisCandidates: [depressionCandidate(0.84), gadCandidate(0.62)],
      primaryDiagnosisIndex: 0,
      assessmentGaps: [
        {
          question: 'Durability of activation under normal work stress over the next fortnight.',
          rationale: 'First reliable improvement reached; consolidation needs a durability window.',
          purpose: 'confirm',
          targets: ['6A70.1'],
        },
      ],
      formulation:
        'Clear treatment response: reliable improvement on PHQ-9 (18 → 9), activation self-sustaining (pre-commitment strategy hers, not prescribed), first successful cognitive restructuring on the evaluation appraisal.',
      treatmentPlan: planV2,
      planSuggestions: [],
      formulationSuggestions: [],
      recommendedTherapies: [baTherapy, restructuring, worryTools],
      crisisFlags: [],
    },
    {
      version: 'V1',
      language: 'en',
      modality: 'CBT',
      diagnosisCandidates: [depressionCandidate(0.84), gadCandidate(0.6)],
      primaryDiagnosisIndex: 0,
      assessmentGaps: [
        {
          question: 'Re-administer PHQ-9 and GAD-7 at session 8 to confirm sustained remission.',
          rationale:
            'Both instruments in remission range; durability over 2 further weeks gates discharge.',
          purpose: 'confirm',
          targets: ['6A70.1', '6B00'],
        },
      ],
      formulation:
        'Remission on both tracked instruments with behavioural scaffolding intact. Residual vulnerability is appraisal-driven rumination under evaluation pressure — the relapse-prevention card targets that trigger specifically.',
      treatmentPlan: planV2,
      // Plan-as-diff: the AI proposes an edit to the ACTIVE plan, not a new
      // plan — the therapist decides on the Review board.
      planSuggestions: [
        {
          type: 'ADJUST_DURATION',
          rationale:
            'Remission reached at session 6 of a 12-session plan — review at session 8 and consider tapering to fortnightly.',
          goal: null,
          goalIndex: null,
          expectedDurationSessions: 10,
          modality: null,
        },
      ],
      // Formulation-as-diff: evidence-anchored updates the Close surface
      // offers; accepting one versions the living formulation.
      formulationSuggestions: [
        {
          target: 'PERPETUATING',
          action: 'REVISE',
          text: 'Evening rumination now centres on work appraisal rather than the relationship — the maintaining loop has narrowed.',
          evidenceQuote: 'It is the Monday review I replay at night now, not the breakup.',
          cycleRole: null,
        },
        {
          target: 'PROTECTIVE',
          action: 'ADD',
          text: 'Saturday badminton group re-established as a reliable behavioural-activation anchor.',
          evidenceQuote:
            'They keep asking me to come back on Saturdays, and I have gone three weeks straight.',
          cycleRole: null,
        },
      ],
      recommendedTherapies: [baTherapy, restructuring],
      crisisFlags: [],
    },
  ];
}

/**
 * The living formulation, v1 — the breakup-centric first read, confirmed at
 * T1. Its "workload eases → mood lifts" prediction FAILED at the layoff
 * week, which is exactly why v2 exists: superseded, not overwritten.
 */
function buildCaseFormulationV1(): CaseFormulationV1 {
  return {
    version: 'V1',
    narrative:
      'A moderate depressive episode precipitated by a relationship ending, maintained by evening rumination and withdrawal from valued activity. Initial read: the work pressure is situational and mood should ease as the review cycle passes.',
    cycle: [
      { role: 'TRIGGER', text: 'Sunday evening; the week ahead comes into view', breaking: false },
      { role: 'THOUGHT', text: '"I am falling behind everyone at work"', breaking: false },
      { role: 'FEELING', text: 'Low, heavy, drained before the week starts', breaking: false },
      { role: 'BEHAVIOUR', text: 'Cancels plans, stays in, scrolls late', breaking: true },
    ],
    fivePs: {
      predisposing: ['High self-standards tied to career progress since college'],
      precipitating: ['Relationship ended four months ago'],
      perpetuating: ['Evening rumination', 'Withdrawal from valued activities'],
      protective: ['Sister she trusts and talks to weekly', 'One close friend in Bengaluru'],
    },
    predictions: [
      {
        text: 'If work quietens after the review cycle, mood lifts on its own.',
        status: 'TO_TEST',
      },
    ],
  };
}

/**
 * The living formulation, v2 (ACTIVE) — revised at T3 after the layoff week
 * disproved v1's prediction: the driver is threat-of-loss APPRAISAL amplified
 * by short sleep, not workload. NOTE: deliberately does NOT contain the two
 * pending report-5 suggestions (badminton protective factor, narrowed
 * rumination) — those wait on the Close surface for the therapist to accept,
 * and `isSuggestionApplied` would hide them if they were already here.
 */
function buildCaseFormulationV2(): CaseFormulationV1 {
  return {
    version: 'V1',
    narrative:
      'A moderate depressive episode with comorbid generalised worry, precipitated by a relationship ending and re-triggered by a layoff round. The maintaining driver is a threat-of-loss appraisal ("I am falling behind / about to be found out") amplified by short sleep — NOT workload itself: the layoff week disproved the workload hypothesis with mood dipping while load was flat. Withdrawal removes the evidence that would disconfirm the appraisal; behavioural activation re-opens the loop.',
    cycle: [
      { role: 'TRIGGER', text: 'Sunday evening; the week ahead comes into view', breaking: false },
      { role: 'THOUGHT', text: '"I am falling behind everyone at work"', breaking: false },
      { role: 'FEELING', text: 'Low, heavy, drained before the week starts', breaking: false },
      { role: 'BEHAVIOUR', text: 'Cancels plans, stays in, scrolls late', breaking: true },
      {
        role: 'CONSEQUENCE',
        text: 'No disconfirming evidence — the appraisal survives another week',
        breaking: false,
      },
    ],
    fivePs: {
      predisposing: [
        'High self-standards tied to career progress since college',
        'Family template linking worth to achievement',
      ],
      precipitating: [
        'Relationship ended four months ago',
        'Missed promotion cycle at work',
        'Layoff round at work (re-trigger)',
      ],
      perpetuating: [
        'Evening rumination loop',
        'Withdrawal from valued activities',
        'Short sleep amplifying next-day threat appraisal',
      ],
      protective: [
        'Sister she trusts and talks to weekly',
        'Manager advocated for her role in the layoff round',
      ],
    },
    predictions: [
      {
        text: 'If work quietens after the review cycle, mood lifts on its own.',
        status: 'NOT_MATCHING',
      },
      {
        text: 'If Saturday activity holds for three weeks, PHQ-9 stays in remission at the next administration.',
        status: 'HOLDING',
      },
    ],
  };
}

function buildTreatmentPlan(): ClinicalTreatmentPlan {
  return {
    modality: 'CBT',
    phaseSequence: [
      'Engagement & psychoeducation',
      'Active treatment',
      'Consolidation & relapse-prevention',
    ],
    goals: [
      {
        description: 'Re-engage with three previously valued activities each week.',
        measure: 'Self-report log; activity count >= 3 for 4 consecutive weeks.',
        interventions: ['Behavioural activation', 'Activity scheduling'],
      },
      {
        description:
          'Reduce PHQ-9 from moderate range to minimal range and sustain for two administrations.',
        measure: 'PHQ-9 score <= 4 at two consecutive administrations >= 2 weeks apart.',
        interventions: ['Cognitive restructuring', 'Thought records'],
      },
    ],
    expectedDurationSessions: 12,
  };
}

/**
 * Plan v2 — confirmed at T3 after the layoff-week collapse: keeps the v1
 * goals and adds the sleep + worry goals the setback showed were missing.
 */
function buildTreatmentPlanV2(): ClinicalTreatmentPlan {
  const v1 = buildTreatmentPlan();
  return {
    ...v1,
    goals: [
      ...v1.goals,
      {
        description: 'Restore sleep to at least 6.5 hours with a fixed wind-down window.',
        measure: 'Sleep diary: >= 6.5h average across a week, window kept 5 of 7 nights.',
        interventions: ['Sleep window', 'Stimulus control'],
      },
      {
        description: 'Contain worry to one daily 20-minute postponement window.',
        measure: 'Worry-postponement log kept 5 of 7 days for 3 consecutive weeks.',
        interventions: ['Worry postponement'],
      },
    ],
  };
}

/**
 * Safety plan built collaboratively in the layoff-week session (T2) when
 * passive ideation surfaced. Contacts are descriptors, not real numbers —
 * except Tele-MANAS and iCall, which are the real national services.
 */
function buildSafetyPlan(): SafetyPlanV1 {
  return {
    version: 'V1',
    language: 'en',
    warningSigns: [
      'The "what is the point" thought appearing more than once a day',
      'Sleep under 5 hours two nights in a row',
      'Skipping the daily anchor walk three days running',
    ],
    internalCoping: [
      'Ten-minute walk, headphones, the usual loop around the block',
      'Slow breathing: 4 in, 6 out, ten rounds',
      'Shower and change clothes — breaks the evening spiral',
    ],
    socialDistractions: [
      { name: 'Evening call with Meera (sister)', contact: 'Usual 8pm slot' },
      { name: 'Badminton group chat', contact: 'Saturday morning games' },
    ],
    helpContacts: [
      { name: 'Meera', relationship: 'Sister', contact: 'Saved in phone favourites' },
      { name: 'Rahul', relationship: 'Close friend', contact: 'WhatsApp, knows to pick up' },
    ],
    professionals: [
      {
        name: 'Dr. Priya Menon (therapist)',
        contact: 'Clinic booking line',
        availability: 'Mon-Sat',
      },
      { name: 'Tele-MANAS', contact: '14416', availability: '24x7, free' },
      { name: 'iCall', contact: '9152987821', availability: 'Mon-Sat 10am-8pm' },
    ],
  };
}

// ============================================================================
// Transcripts — six sessions of diarized, code-mix-aware dialogue. Every
// evidence quote cited in the reports appears VERBATIM in a transcript, so
// the citation trail a therapist follows is real. Timings are synthesized
// (reading-pace estimates), content is fabricated fixture material.
// ============================================================================

interface DemoTranscript {
  transcript: string;
  segments: SpeakerSegment[];
  spokenLanguages: string[];
}

function makeTranscript(
  rows: [Speaker, string, string?][],
  spokenLanguages: string[],
): DemoTranscript {
  let clock = 4000;
  const segments: SpeakerSegment[] = rows.map(([speaker, text, language]) => {
    const startMs = clock;
    const endMs = startMs + 2500 + text.length * 55;
    clock = endMs + 900;
    return { speaker, startMs, endMs, text, language: language ?? 'en' };
  });
  const transcript = rows
    .map(([speaker, text]) => `${speaker === 'therapist' ? 'Therapist' : 'Client'}: ${text}`)
    .join('\n');
  return { transcript, segments, spokenLanguages };
}

function buildTranscripts(): DemoTranscript[] {
  const T = 'therapist' as const;
  const C = 'client' as const;
  return [
    // ---- Intake ----
    makeTranscript(
      [
        [
          T,
          'Before we start — everything here stays between us, with the exceptions we covered in the consent. What brings you in now, after four months of this?',
        ],
        [
          C,
          'A friend who did therapy pushed me, honestly. I kept saying I would manage. But the weekends used to be the thing I looked forward to. Now they feel flat.',
        ],
        [
          C,
          'I can barely concentrate at work for ten minutes. I read the same Slack thread four times.',
        ],
        [T, 'When did the flatness start, as best you can place it?'],
        [
          C,
          'Around March. The breakup was in February, and then the review cycle started right after. It is hard to say which one did it.',
        ],
        [T, 'Tell me about the worry side. You mentioned your head is always on the next thing.'],
        [
          C,
          'My head is constantly on the next thing I am dropping. Work, mostly. But also my sister’s visa thing, my father’s BP report. It rotates.',
        ],
        [
          C,
          'Har call pe shaadi ki baat aa jaati hai — every call with my parents lands on marriage. I have stopped picking up sometimes.',
          'mixed',
        ],
        [T, 'How is sleep through all this?'],
        [
          C,
          'One a.m., sometimes two. I am tired but I keep scrolling. Mornings are the worst part of the day.',
        ],
        [T, 'Anyone in the family who has been through something like this?'],
        [
          C,
          'My mother, in her forties. She took medication for a year or so. Nobody really talked about it. She "pushed through," that is the family version.',
        ],
        [
          T,
          'I have to ask directly, and it is a routine question: any thoughts of death, or of harming yourself?',
        ],
        [C, 'No. I wish things were lighter, but not like that. Nothing like that.'],
        [
          T,
          'Thank you for being straight with me. Next time I want to put numbers on the mood and the worry — two short questionnaires — and then we plan properly.',
        ],
      ],
      ['en', 'hi'],
    ),
    // ---- T1 — mapping the cycle ----
    makeTranscript(
      [
        [
          T,
          'Your PHQ-9 today is fifteen — down a little from eighteen at intake. Walk me through a Sunday evening. Minute by minute.',
        ],
        [
          C,
          'Around six or seven the week just... arrives. Calendar, standup, the review thread. And there is this one thought that sits on my chest.',
        ],
        [T, 'Say it the way it sounds in your head.'],
        [C, 'I am falling behind everyone at work. Everyone. My batch, my team, the juniors.'],
        [T, 'And when that thought lands, what happens in the body?'],
        [
          C,
          'Heavy. Drained before Monday even starts. And then I cancel whatever I had — badminton, dinner plans — and just stay in and scroll.',
        ],
        [
          T,
          'Here is the trap in that loop: staying in feels like rest, but it also means the "falling behind" thought never gets tested against anything. It survives another week, unchallenged.',
        ],
        [C, 'That is... accurate. It is a subscription I keep renewing.'],
        [
          T,
          'That is the best description of a maintaining cycle I have heard this month. So we start small: three activities this week, planned, with mood noted before and after. Not to feel great — to collect evidence.',
        ],
        [
          C,
          'Three activities this week: Tuesday walk after standup, call Meera on Thursday, Saturday walk with Rahul.',
        ],
        [
          T,
          'And one more thing — when the Sunday thought comes, write it down once, exact words. Just catch it in the wild.',
        ],
        [C, 'Okay. I can do that much.'],
      ],
      ['en'],
    ),
    // ---- T2 — the layoff week ----
    makeTranscript(
      [
        [T, 'You look exhausted. What happened this week?'],
        [
          C,
          'They announced layoffs on Tuesday. Two people from my team. My role is safe "for now" — that is the exact phrase my manager used.',
        ],
        [
          C,
          'I have slept maybe four, five hours a night since. The walks stopped on Wednesday. It felt pointless.',
        ],
        [T, 'Pointless how? I want to understand that word.'],
        [
          C,
          'Some nights I think, what is the point of all this. Not that I would do anything — it just feels pointless.',
        ],
        [
          T,
          'I hear you, and I am glad you said it plainly. I need to ask some direct questions now, the same ones I would ask anyone. Have you had thoughts of ending your life?',
        ],
        [C, 'Not of ending it. More like... wanting to not have to do this. If that makes sense.'],
        [
          T,
          'It makes sense, and the difference matters. Any thoughts of a method, or a plan, or anything you have done to prepare?',
        ],
        [
          C,
          'No. Nothing like that. It scared me a bit that the thought even came, which is why I told you.',
        ],
        [T, 'Telling me was exactly right. Who knows about the layoffs at home?'],
        [
          C,
          'Meera. She has called every day this week. Bas thak gayi hoon — I am just tired, that is what I keep telling her.',
          'mixed',
        ],
        [
          T,
          'We are going to build a safety plan together, now, in the next twenty minutes. Not because I think you are in danger tonight — because the week showed us the early-warning signs, and I want them written down while they are fresh.',
        ],
        [C, 'Okay. What goes in it?'],
        [
          T,
          'Three things: the signs that the spiral is starting, what you do first, and who you call. And this week we drop the three activities — one ten-minute walk a day, that is all. The bar is on the floor on purpose.',
        ],
        [
          C,
          'One ten-minute walk every day, even on the worst day. That is the whole plan this week.',
        ],
        [
          T,
          'And message me midweek — one line, just how sleep went. We meet again in a week, sooner if any of the plan’s warning signs show up.',
        ],
      ],
      ['en', 'hi'],
    ),
    // ---- T3 — stabilisation, revision ----
    makeTranscript(
      [
        [
          T,
          'Your one-line message said "5 hours, then 6, then 6.5." How did the week actually go?',
        ],
        [
          C,
          'Better. The walk happened all seven days — it was the only rule, so I kept it. No more of the pointless thoughts since that week.',
        ],
        [
          T,
          'I want to revisit something. At the start we assumed that once the review cycle passed and work quietened, the mood would lift on its own. The layoff week broke that theory — your workload did not change that week. What changed?',
        ],
        [
          C,
          'The threat changed. Even with the same tasks, everything felt like evidence about whether I am worth keeping.',
        ],
        [
          T,
          'So the driver is not the amount of work — it is the appraisal of threat, and it burns hotter when you have slept five hours. That changes what we target: sleep window stays, and we add a worry tool.',
        ],
        [
          C,
          'My head will not stop planning for disasters, even when the day went fine. Job, my sister’s visa, my father’s BP. It rotates at eleven p.m.',
        ],
        [
          T,
          'That rotation gets a container. A twenty-minute worry window at six p.m. Worries that show up earlier go on a list — the list waits for the window. At eleven p.m. the answer is: already handled at six.',
        ],
        [C, 'Worries go on the list, and the list waits till 6pm.'],
        [
          T,
          'Exactly that. And the sleep window holds: screens away by eleven, lights out by eleven-thirty. I am also updating our plan on record — sleep and worry are now goals, not side effects.',
        ],
        [C, 'Good. It should say that somewhere official.'],
      ],
      ['en'],
    ),
    // ---- T4 — traction ----
    makeTranscript(
      [
        [
          T,
          'Your score today is nine — that is a nine-point drop from where we started. What did you do differently this fortnight?',
        ],
        [
          C,
          'I went back to badminton. Saturday AND Wednesday. I told the group I was coming, so I could not cancel. That trick works on me.',
        ],
        [
          T,
          'You invented pre-commitment on your own. What was the mood before and after Saturday?',
        ],
        [
          C,
          'Three out of ten before. Six after. It annoys me that it works, honestly. It feels too simple.',
        ],
        [
          T,
          'Simple is not the same as easy — you did six weeks of work to make it possible. What about the Monday review meeting?',
        ],
        [
          C,
          'I used the sheet. Caught the thought — "I am about to be found out" — wrote the evidence column, and it just deflated. My rating on believing it went from eighty percent to thirty-five.',
        ],
        [T, 'And Sunday evenings?'],
        [
          C,
          'Still heavy. But it is an hour now, not the whole evening. I make the Monday list and it shrinks.',
        ],
        [
          T,
          'Next week: badminton on Saturday, same pre-commitment trick, and one more thought record if the review appraisal shows up.',
        ],
        [C, 'Badminton on Saturday — and I tell the group I am coming, so it is harder to cancel.'],
      ],
      ['en'],
    ),
    // ---- T5 — remission + relapse prevention ----
    makeTranscript(
      [
        [
          T,
          'Four on the PHQ-9 and four on the GAD-7. Both in the remission range. How does that land when you hear it?',
        ],
        [
          C,
          'Weird. Good-weird. Three months ago I could not read one page. Yesterday I ran a design review and enjoyed it.',
        ],
        [T, 'What is left, honestly? I do not want a tidy ending.'],
        [
          C,
          'It is the Monday review I replay at night now, not the breakup. But quieter. And Sunday evening is normal-person dread, not the pit.',
        ],
        [T, 'And the badminton group?'],
        [
          C,
          'They keep asking me to come back on Saturdays, and I have gone three weeks straight. It is on my calendar like a meeting I refuse to cancel.',
        ],
        [
          T,
          'Then today we build your relapse-prevention card. If this comes back, what would you see FIRST — before the mood itself?',
        ],
        [
          C,
          'Cancelling plans twice in a row. Sleep sliding past one a.m. And the Sunday pit coming back full size.',
        ],
        [T, 'And the first two moves when you see any of those?'],
        [
          C,
          'Tell someone — Meera, probably. And book the anchor activity before I can talk myself out of it.',
        ],
        [
          T,
          'That is the card. Draft it properly as homework. At session eight we re-run both questionnaires — if they hold, we talk about moving to fortnightly, and what discharge looks like.',
        ],
        [C, 'I’ll go to badminton on Saturday even if I don’t feel like it — mood follows action.'],
        [
          T,
          'Bring the thought record for the Sunday-evening dread too; we review it first thing. And Ananya — you did the work here. The evidence in your log is yours.',
        ],
      ],
      ['en'],
    ),
  ];
}

function buildTherapyScript(): TherapyScriptV1 {
  return {
    version: 'V1',
    language: 'en',
    therapyName: 'Behavioural Activation',
    openingScript:
      'Let us spend a moment on what felt different this past week. Where did you notice even a small lift, however brief?',
    mainExercise: {
      steps: [
        {
          id: 'review-activity-log',
          purpose: 'Reconnect activity to mood and notice the moments that already worked.',
          therapistSays:
            'You logged a few activities this week. Pick the one that surprised you most — either because it felt better than expected, or because it took less effort than you thought it would.',
          listenFor:
            'Specific examples of activities that produced even a small mood lift, and the conditions around them (time of day, company, beforehand state).',
          branches: [
            {
              ifClientSays: 'Nothing really helped.',
              thenDo:
                "Acknowledge gently, then ask: 'Was there a moment that was less heavy than another?' — we are looking for variability, not perfection.",
            },
            {
              ifClientSays: 'The morning walk helped most.',
              thenDo:
                "Build the next week's plan around that specific anchor — same time, same route, same friend if possible. Concreteness drives adherence.",
            },
          ],
        },
        {
          id: 'plan-next-week',
          purpose: 'Set 3 concrete activities for next week tied to the anchor we just found.',
          therapistSays:
            'Let us pick three small activities for next week. Concrete: a time, a place, a person if relevant. Easy enough you can do them on a heavier day.',
          listenFor:
            'Whether the activities are tied to specific anchors. Watch for over-ambition (a sign of catching up rather than engagement).',
          branches: [],
        },
      ],
    },
    adaptationCues: [
      'If the client gets stuck on negative self-talk, pause activation and run one thought-record.',
      'If the client reports flat affect throughout, check sleep and PHQ-9 trend before adding more activities.',
    ],
    closingScript:
      'Before you go: pick one of the three activities we just planned that you are most confident about, and tell me when you will do it.',
    homework: {
      description:
        'Complete three planned activities this week; note your mood (0-10) just before and just after each one.',
      deliveryNotes:
        'Use the WhatsApp link the therapist shares; one row per activity; reply with the mood numbers — no narrative needed.',
    },
    riskWatchpoints: [
      'Any new passive suicidal ideation, even fleeting',
      'Sleep collapse (< 4 hours) for two nights in a row',
    ],
    estimatedDurationMin: 45,
  };
}

function buildAcceptedConfirmations(
  confirmedAt: Date,
  psychologistId: string,
): ClinicalSectionConfirmations {
  const iso = new Date(confirmedAt.getTime() + 30 * 60 * 1000).toISOString();
  const accepted = {
    status: 'ACCEPTED' as const,
    confirmedAt: iso,
    confirmedByPsychologistId: psychologistId,
    reason: null,
    edits: null,
  };
  return {
    diagnosis: accepted,
    gaps: accepted,
    formulation: accepted,
    plan: accepted,
    therapies: accepted,
    crisis: accepted,
  };
}

/**
 * Build a PHQ-9 item map that sums to the target score with item 9
 * (suicidality) held at 0, so the demo doesn't fire spurious crisis
 * audits. Distribution is the smallest set of "moderate-day" answers
 * that hit the target; severity bands are derived by the real scorer
 * downstream.
 */
function phq9ResponsesForScore(target: number): Record<string, number> {
  if (target < 0 || target > 24) {
    throw new Error(`[demo-client] PHQ-9 target out of range: ${target}`);
  }
  // Items 1..8 each accept 0..3; item 9 stays 0.
  const responses: Record<string, number> = {};
  let remaining = target;
  for (let i = 1; i <= 8; i++) {
    const v = Math.min(3, remaining);
    responses[`phq9_${i}`] = v;
    remaining -= v;
  }
  responses.phq9_9 = 0;
  if (remaining !== 0) {
    throw new Error(`[demo-client] PHQ-9 target ${target} could not be allocated`);
  }
  return responses;
}

/**
 * GAD-7 counterpart: 7 items, each 0..3 (max 21). Same fill strategy as the
 * PHQ-9 helper; severity bands derived by the real scorer downstream.
 */
function gad7ResponsesForScore(target: number): Record<string, number> {
  if (target < 0 || target > 21) {
    throw new Error(`[demo-client] GAD-7 target out of range: ${target}`);
  }
  const responses: Record<string, number> = {};
  let remaining = target;
  for (let i = 1; i <= 7; i++) {
    const v = Math.min(3, remaining);
    responses[`gad7_${i}`] = v;
    remaining -= v;
  }
  if (remaining !== 0) {
    throw new Error(`[demo-client] GAD-7 target ${target} could not be allocated`);
  }
  return responses;
}

function deterministicScriptCacheKey(clientId: string, therapyName: string): string {
  // 64-char hex SHA-256 of the demo identity tuple; matches the
  // (clientId, cacheKey) uniqueness invariant on TherapyScript.
  return createHash('sha256').update(`${clientId}:demo:${therapyName}`).digest('hex');
}

function generateShareToken(): string {
  // 22-char base64url (~128 bits of entropy) — matches Sprint 15 shape.
  return randomBytes(16).toString('base64url').slice(0, 22);
}
