import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_FIELD_ERASURE_MANIFEST,
  DPDP_ERASURE_MANIFEST,
  type DpdpErasureDisposition,
} from './dpdp-erasure-manifest';

const schema = readFileSync(resolve(process.cwd(), '../../prisma/schema.prisma'), 'utf8');
const implementation = readFileSync(resolve(process.cwd(), 'lib/dpdp-erasure.ts'), 'utf8');

function schemaModels(): Map<string, Map<string, string>> {
  const models = new Map<string, Map<string, string>>();
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{\n([\s\S]*?)^\}/gm)) {
    const fields = new Map<string, string>();
    for (const line of match[2]!.split('\n')) {
      const field = line.trim().match(/^(\w+)\s+([\w]+)(?:\[\]|\?)?/);
      if (field && !line.trim().startsWith('@@')) fields.set(field[1]!, field[2]!);
    }
    models.set(match[1]!, fields);
  }
  return models;
}

function clientLinkedModels(): Set<string> {
  const models = schemaModels();
  // Seed every scalar client/session pointer before traversing relations. A
  // direct scalar-only model (Appointment) can itself own PHI children
  // (AppointmentReminderDelivery), so discovery must run to a fixed point.
  const linked = new Set<string>(['Client']);
  for (const [model, fields] of models) {
    if (fields.has('clientId') || fields.has('sessionId')) linked.add(model);
  }
  const queue = [...linked];
  while (queue.length > 0) {
    const model = queue.shift()!;
    for (const target of models.get(model)?.values() ?? []) {
      if (models.has(target) && target !== 'Psychologist' && !linked.has(target)) {
        linked.add(target);
        queue.push(target);
      }
    }
  }
  linked.delete('Client');
  // Audit rows intentionally have no FK so they remain append-only proof.
  linked.add('AuditLog');
  // The reminder outbox is introduced by the appointment-lifecycle stream.
  // Keep it fail-closed while this branch is integrated with that schema.
  linked.add('AppointmentReminderDelivery');
  return linked;
}

const allowedClientNonIdentifyingFields = new Set([
  'id',
  'psychologistId',
  'status',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'isDemo',
]);
const relationTypes = new Set(schemaModels().keys());

const validDispositions: readonly DpdpErasureDisposition[] = [
  'DELETE',
  'REDACT',
  'RETAIN_LEGAL_PROOF',
  'RETAIN_NON_PHI',
];

describe('schema-complete DPDP erasure manifest', () => {
  it('fails closed when a client/session-linked relation or artifact is added', () => {
    expect(new Set(Object.keys(DPDP_ERASURE_MANIFEST))).toEqual(clientLinkedModels());
    for (const entry of Object.values(DPDP_ERASURE_MANIFEST)) {
      expect(validDispositions).toContain(entry.disposition);
      expect(entry.operation).not.toHaveLength(0);
      expect(entry.retentionClass).not.toHaveLength(0);
    }
  });

  it('fails closed when an identifying Client scalar is added', () => {
    const clientFields = schemaModels().get('Client')!;
    const identifying = [...clientFields]
      .filter(
        ([name, type]) => !allowedClientNonIdentifyingFields.has(name) && !relationTypes.has(type),
      )
      .map(([name]) => name)
      .sort();
    expect(Object.keys(CLIENT_FIELD_ERASURE_MANIFEST).sort()).toEqual(identifying);
    expect(
      Object.values(CLIENT_FIELD_ERASURE_MANIFEST).every((action) => action === 'REDACT'),
    ).toBe(true);
  });

  it('covers every item in the independent reviewer checklist', () => {
    const reviewerModels = [
      'ClientNomination',
      'ClientGrievance',
      'Consent',
      'ClientPushSubscription',
      'ClientClaimToken',
      'SafetyPlan',
      'CaseFormulation',
      'CaseConsult',
      'ClientConceptualMap',
      'InstrumentResponse',
      'SessionAgreement',
      'MoodLog',
      'JournalEntry',
      'MedicationOrder',
      'ClinicalOrder',
      'Differential',
      'ClinicalReading',
      'TherapyNote',
      'NoteSignatureVersion',
      'AppointmentReminderDelivery',
    ];
    expect(reviewerModels.every((model) => model in DPDP_ERASURE_MANIFEST)).toBe(true);
    expect(CLIENT_FIELD_ERASURE_MANIFEST).toMatchObject({
      clientFirebaseUid: 'REDACT',
      dateOfBirth: 'REDACT',
      preferredModality: 'REDACT',
      allergies: 'REDACT',
      carriedQuestions: 'REDACT',
      abhaAddress: 'REDACT',
      preferredLanguage: 'REDACT',
      spokenLanguages: 'REDACT',
    });
  });

  it('documents bounded legal-proof retention and external object deletion', () => {
    expect(DPDP_ERASURE_MANIFEST.AuditLog).toMatchObject({
      disposition: 'RETAIN_LEGAL_PROOF',
      retentionClass: 'SECURITY_AND_DSR_PROOF',
    });
    expect(DPDP_ERASURE_MANIFEST.Consent.disposition).toBe('RETAIN_LEGAL_PROOF');
    expect(DPDP_ERASURE_MANIFEST.ClientErasureRequest.disposition).toBe('RETAIN_LEGAL_PROOF');
    expect(DPDP_ERASURE_MANIFEST.AudioChunk.operation).toContain('object-deletion outbox');
  });

  it('persists hashed request proof and a durable external-object deletion outbox', () => {
    const request = schemaModels().get('ClientErasureRequest');
    expect(request?.has('reasonHashHex')).toBe(true);
    expect(request?.has('resolutionNotesHashHex')).toBe(true);
    const outbox = schemaModels().get('ErasureObjectDeletionTask');
    expect(outbox).toBeDefined();
    expect(outbox?.has('objectKey')).toBe(true);
    expect(outbox?.has('status')).toBe(true);
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../../prisma/migrations/20260915000000_schema_complete_dpdp_erasure/migration.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('erasure_object_deletion_tasks');
    expect(migration).toContain('reasonHashHex');
  });

  it('deletes required FK children before their deleted parents', () => {
    const deleteOrder = new Map<string, number>();
    for (const [index, match] of [
      ...implementation.matchAll(/await tx\.(\w+)\.deleteMany/g),
    ].entries()) {
      deleteOrder.set(match[1]!, index);
    }
    for (const [childModel, body] of schema.matchAll(/^model\s+(\w+)\s*\{\n([\s\S]*?)^\}/gm)) {
      const child = childModel![0]!.toLowerCase() + childModel!.slice(1);
      const childOrder = deleteOrder.get(child);
      if (childOrder === undefined) continue;
      for (const relation of body!.matchAll(
        /^\s*\w+\s+(\w+)\??\s+@relation\([^\n]*fields:\s*\[[^\]]+\]/gm,
      )) {
        const parentModel = relation[1]!;
        const parent = parentModel[0]!.toLowerCase() + parentModel.slice(1);
        const parentOrder = deleteOrder.get(parent);
        if (parentOrder !== undefined) {
          expect(childOrder, `${childModel} must be deleted before ${parentModel}`).toBeLessThan(
            parentOrder,
          );
        }
      }
    }
  });

  it('deletes appointment reminder delivery identifiers before redacting appointments', () => {
    expect(DPDP_ERASURE_MANIFEST.AppointmentReminderDelivery).toMatchObject({
      disposition: 'DELETE',
      retentionClass: 'ERASE_ON_FULFILMENT',
    });
    const reminder = implementation.indexOf('appointment_reminder_deliveries');
    const appointment = implementation.indexOf('tx.appointment.updateMany');
    expect(reminder).toBeGreaterThan(0);
    expect(reminder).toBeLessThan(appointment);
  });

  it('fixes signed-note erasure forward without changing the applied migration checksum', () => {
    const appliedMigration = readFileSync(
      resolve(
        process.cwd(),
        '../../prisma/migrations/20260914000000_dpdp_signed_note_erasure/migration.sql',
      ),
      'utf8',
    );
    const forwardMigration = readFileSync(
      resolve(
        process.cwd(),
        '../../prisma/migrations/20260915000000_schema_complete_dpdp_erasure/migration.sql',
      ),
      'utf8',
    );

    expect(createHash('sha256').update(appliedMigration).digest('hex')).toBe(
      'e73be432262810fe09588b77dfdb73f06fe6915bf78c696d1f82e526bf0da8b7',
    );
    expect(forwardMigration).toContain('CREATE OR REPLACE FUNCTION redact_client_signed_note_phi(');
    expect(forwardMigration).toContain('SECURITY DEFINER');
    expect(forwardMigration).toContain('UPDATE "therapy_notes"');
    expect(forwardMigration).toContain('UPDATE "note_signature_versions"');
    expect(forwardMigration).toContain(`"content" = '{}'::jsonb`);

    const rawPhiAndCredentialFields = [
      'rxPad',
      'signCredentialId',
      'signClientDataJsonB64u',
      'signAuthenticatorDataB64u',
      'signSignatureB64u',
      'signPayload',
      'medicalSigningCredentialId',
      'medicalSigningCredentialSnapshot',
    ];
    for (const field of rawPhiAndCredentialFields) {
      expect(forwardMigration.match(new RegExp(`"${field}" = NULL`, 'g'))).toHaveLength(2);
    }
    expect(forwardMigration).toContain(
      'REVOKE ALL ON FUNCTION redact_client_signed_note_phi(TEXT, TEXT) FROM PUBLIC',
    );
    expect(forwardMigration).not.toContain(
      'GRANT EXECUTE ON FUNCTION redact_client_signed_note_phi(TEXT, TEXT)',
    );
    expect(forwardMigration).toContain('"contentHashHex"');
    expect(forwardMigration).toContain('"signChallengeHashHex"');
    expect(DPDP_ERASURE_MANIFEST.TherapyNote.operation).toContain('redact');
    expect(DPDP_ERASURE_MANIFEST.NoteSignatureVersion.operation).toContain('redact');
  });
});
