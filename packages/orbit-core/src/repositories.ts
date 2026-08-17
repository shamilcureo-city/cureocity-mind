import type {
  Encounter,
  EncounterId,
  Patient,
  PatientId,
  Practitioner,
  PractitionerId,
} from './domain';

/** Tenant scope is mandatory on patient and encounter reads by design. */
export interface PatientScope {
  practitionerId: PractitionerId;
  organizationId?: string;
}

export interface PatientListQuery extends PatientScope {
  search?: string;
  status?: Patient['status'];
  limit?: number;
  cursor?: PatientId;
}

export interface EncounterListQuery extends PatientScope {
  patientId?: PatientId;
  status?: Encounter['status'];
  limit?: number;
  cursor?: EncounterId;
}

export interface PractitionerRepository {
  findById(id: PractitionerId): Promise<Practitioner | null>;
  findByFirebaseUid(firebaseUid: string): Promise<Practitioner | null>;
}

export interface PatientRepository {
  findById(id: PatientId, scope: PatientScope): Promise<Patient | null>;
  list(query: PatientListQuery): Promise<{ items: Patient[]; nextCursor: PatientId | null }>;
}

export interface EncounterRepository {
  findById(id: EncounterId, scope: PatientScope): Promise<Encounter | null>;
  list(query: EncounterListQuery): Promise<{ items: Encounter[]; nextCursor: EncounterId | null }>;
}
