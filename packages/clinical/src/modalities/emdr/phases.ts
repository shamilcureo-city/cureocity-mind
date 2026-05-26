/**
 * EMDR (Eye Movement Desensitization and Reprocessing) 8-phase protocol.
 * Standard Shapiro protocol used in Indian psychotherapy practice. The
 * PRD (Appendix B in PRD 22.1) is the canonical source; ordering and
 * names below match standard manualized EMDR teaching practice.
 */

export const EMDR_PHASES = [
  'history_taking',
  'preparation',
  'assessment',
  'desensitization',
  'installation',
  'body_scan',
  'closure',
  'reevaluation',
] as const;

export type EmdrPhase = (typeof EMDR_PHASES)[number];

export const EMDR_PHASE_DESCRIPTIONS: Record<EmdrPhase, string> = {
  history_taking:
    'Phase 1 — Gather case history, screen for dissociation / readiness, identify candidate targets.',
  preparation:
    'Phase 2 — Explain EMDR; install safe-place resource; verify dual attention + affect tolerance. GATE before Phase 3.',
  assessment:
    'Phase 3 — For each target: pick image, identify NC + PC, measure VOC (1-7), identify emotion + body sensation, baseline SUDS (0-10).',
  desensitization:
    'Phase 4 — Bilateral stimulation while focusing on target memory; reprocess until SUDS reaches 0 (or ecologically valid floor).',
  installation:
    'Phase 5 — Strengthen the Positive Cognition with bilateral stimulation until VOC reaches 7.',
  body_scan: 'Phase 6 — Scan body for residual tension; if present, reprocess until clear.',
  closure:
    'Phase 7 — Return client to equilibrium (used at end of every session, complete or incomplete).',
  reevaluation:
    'Phase 8 — At the next session: check target stability, gains held, new material surfaced.',
};

export const EMDR_INITIAL_PHASE: EmdrPhase = 'history_taking';

export function nextEmdrPhase(current: EmdrPhase): EmdrPhase | null {
  const idx = EMDR_PHASES.indexOf(current);
  if (idx < 0 || idx === EMDR_PHASES.length - 1) return null;
  return EMDR_PHASES[idx + 1] ?? null;
}

export function isEmdrPhase(value: unknown): value is EmdrPhase {
  return typeof value === 'string' && (EMDR_PHASES as readonly string[]).includes(value);
}
