import type { PsychologistStatus } from '@prisma/client';

export function practitionerAccountStatusCopy(status: PsychologistStatus) {
  switch (status) {
    case 'PENDING_VERIFICATION':
      return {
        title: 'Your account is awaiting approval',
        description:
          'A practice administrator needs to review and activate your account before you can use the clinical workspace.',
        nextStep:
          'Contact your practice administrator or support to check which registration details are needed. Once your account is approved, select Check again.',
      };
    case 'SUSPENDED':
      return {
        title: 'Your account access is paused',
        description: 'Clinical workspace access is currently suspended for this account.',
        nextStep:
          'Contact your practice administrator or support to review the restriction. Signing in again or changing your plan will not remove it.',
      };
    case 'OFFBOARDED':
      return {
        title: 'Your account is closed',
        description: 'This account no longer has access to the clinical workspace.',
        nextStep:
          'If this is unexpected, contact your practice administrator or support. Reopening an account requires an administrator review.',
      };
    default:
      // Active users are redirected by the server page. Unknown future states
      // must never imply approval or grant access from a client-side view.
      return {
        title: 'Account access needs a review',
        description: 'We cannot open the clinical workspace for this account.',
        nextStep: 'Contact your practice administrator or support to check your account access.',
      };
  }
}
