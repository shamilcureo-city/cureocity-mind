export interface AuthenticatedUser {
  firebaseUid: string;
  email?: string;
  /**
   * Set once the Firebase UID has been resolved to a Psychologist row.
   * Undefined for the brief window between Firebase signup and
   * `POST /psychologists` registration.
   */
  psychologistId?: string;
  /**
   * Role of the resolved Psychologist row, if any. THERAPIST is the
   * default; ADMIN unlocks /api/v1/admin/* routes. Set alongside
   * psychologistId.
   */
  role?: 'THERAPIST' | 'ADMIN';
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
  }
}
