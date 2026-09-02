import { describe, expect, it } from 'vitest';
import { ShareInputSchema } from '@cureocity/contracts';
import { buildShareDeliveryInput } from './share-delivery-input';

const clientId = 'c123456789012345678901234';
const sessionId = 'c223456789012345678901234';
const assignmentId = 'c323456789012345678901234';
const idempotencyKey = '123e4567-e89b-42d3-a456-426614174000';

const actualCallerPayloads = [
  {
    clientId,
    channels: ['PORTAL_LINK'],
    idempotencyKey,
    artefact: { artefactType: 'AFTER_VISIT_SUMMARY', sessionId },
  },
  {
    clientId,
    channels: ['PORTAL_LINK'],
    idempotencyKey,
    artefact: { artefactType: 'RX_PAD', sessionId },
  },
  {
    clientId,
    channels: ['PORTAL_LINK'],
    idempotencyKey,
    artefact: { artefactType: 'CHRONIC_PROGRESS_REPORT', clientId },
  },
  {
    clientId,
    channels: ['EMAIL'],
    idempotencyKey,
    artefact: { artefactType: 'INSTRUMENT_CHECKIN', clientId, instrumentKey: 'PHQ9' },
  },
  {
    clientId,
    channels: ['PORTAL_LINK'],
    idempotencyKey,
    artefact: { artefactType: 'HOMEWORK', assignmentId },
  },
] as const;

describe('real direct share caller payloads', () => {
  it.each(actualCallerPayloads)('passes the authoritative ShareInputSchema', (payload) => {
    const actual = buildShareDeliveryInput(payload);
    expect(ShareInputSchema.parse(actual)).toEqual(actual);
  });

  it('preserves both Doctor AVS and signed Rx artefact behavior', () => {
    expect(
      actualCallerPayloads.slice(0, 2).map((payload) => payload.artefact.artefactType),
    ).toEqual(['AFTER_VISIT_SUMMARY', 'RX_PAD']);
  });
});
