import type { MindCareRecordDto, MindSessionWork } from '@cureocity/contracts';

export const MIND_WORK_LABELS: Record<MindSessionWork['disposition'], string> = {
  USED: 'Work carried out as planned',
  ADAPTED: 'Work adapted during the visit',
  PAUSED: 'Work started, then paused',
  NOT_USED: 'Planned work was not used',
};

export function formatMindWorkDate(value: string) {
  return `${new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  })} IST`;
}

/** Pure reading projection. Never infer delivery from a guide, score, note or selected cue. */
export function sessionWorkPreparation(record: MindCareRecordDto | null) {
  const work = record?.body.sessionWork;
  if (!record || !work) return null;
  return {
    sessionId: work.sessionId,
    sourceHref: `/app/sessions/${encodeURIComponent(work.sessionId)}`,
    scheduledAt: work.scheduledAt,
    recordVersion: record.version,
    recordSavedAt: record.createdAt,
    disposition: MIND_WORK_LABELS[work.disposition],
    workDone: work.workDone,
    clientResponse: work.clientResponse || 'Not recorded; no response or improvement is inferred.',
  };
}
