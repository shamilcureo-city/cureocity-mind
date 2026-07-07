import type { Metadata } from 'next';
import {
  COMPANY_LEGAL_NAME,
  GRIEVANCE_EMAIL,
  LegalSection,
  LegalShell,
} from '@/components/legal/LegalShell';

export const metadata: Metadata = {
  title: 'Privacy Policy — Cureocity Mind',
  description:
    'How Cureocity Mind collects, processes, secures, and shares data, and your rights under India’s Digital Personal Data Protection Act, 2023.',
};

/**
 * LEGAL-1 — an honest privacy notice. Two corrections vs the old login copy
 * ("we never share your data", which was false): (1) we DO share data with
 * named sub-processors to deliver the service, listed below; (2) we describe
 * the DPDP rights and the grievance channel. The sub-processor list must stay
 * in lock-step with the actual integrations (packages/notifications,
 * packages/llm, billing, hosting).
 */
export default function PrivacyPolicy() {
  return (
    <LegalShell
      title="Privacy Policy"
      intro={`This notice explains what personal data ${COMPANY_LEGAL_NAME} ("we") processes when a therapist or doctor uses Cureocity Mind, why, who we share it with to run the service, and the rights you have under India's Digital Personal Data Protection Act, 2023 (DPDP).`}
    >
      <LegalSection heading="Who is responsible for your data">
        <p>
          {COMPANY_LEGAL_NAME} is the data fiduciary for account data of the clinicians who sign up.
          For the clinical records a clinician creates about their patients, the clinician is the
          fiduciary and we act as their data processor, handling that data only on their
          instructions and to provide the service.
        </p>
      </LegalSection>

      <LegalSection heading="What we process, and why">
        <p>
          <strong>Account data</strong> — name, email, phone, professional registration details, and
          billing information — to create and secure your account and take payment.
        </p>
        <p>
          <strong>Clinical data you create</strong> — session audio you record, the transcripts and
          notes generated from it, diagnoses, treatment plans, questionnaire scores, and messages
          shared with patients — to provide the documentation and measurement-based-care features.
          Session audio is processed to produce a transcript and is retained only as long as needed
          to generate and let you review the note.
        </p>
        <p>
          <strong>Usage and diagnostic data</strong> — logs and error reports — to keep the service
          reliable and secure.
        </p>
      </LegalSection>

      <LegalSection heading="Who we share it with (sub-processors)">
        <p>
          We do not sell your data or use it for advertising. We do share it with the service
          providers below strictly to operate Cureocity Mind. Each is bound by contract to protect
          it and use it only for the service:
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Google Cloud (Vertex AI, Gemini)</strong> — transcription and clinical drafting.
            Audio transcription runs in the <strong>asia-south1 (Mumbai)</strong> region for data
            residency.
          </li>
          <li>
            <strong>Google Firebase</strong> — sign-in and authentication.
          </li>
          <li>
            <strong>Neon</strong> — the managed PostgreSQL database that stores your records.
          </li>
          <li>
            <strong>Vercel</strong> — application hosting and delivery.
          </li>
          <li>
            <strong>WATI</strong> (WhatsApp), <strong>SendGrid</strong> (email), and{' '}
            <strong>Twilio</strong> (SMS/voice) — to deliver the patient-facing content you choose
            to share.
          </li>
          <li>
            <strong>Razorpay</strong> — to process subscription payments.
          </li>
          <li>
            <strong>Sentry</strong> — application error monitoring.
          </li>
        </ul>
        <p>
          Some of these providers may process data outside India. Where that happens we rely on the
          cross-border processing consent you give at sign-up and on contractual safeguards, and you
          may withdraw that consent (which may limit some features).
        </p>
      </LegalSection>

      <LegalSection heading="How we protect it">
        <p>
          Access is restricted to your own tenant — one clinician cannot see another&apos;s records.
          Sensitive patient identifiers are encrypted at rest, traffic is encrypted in transit, and
          patient-facing links use unguessable tokens and are excluded from search engines. Every
          material action is written to an audit log.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights under the DPDP Act">
        <p>You have the right to:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>access a summary of the personal data we process about you;</li>
          <li>correct or complete inaccurate or incomplete data;</li>
          <li>
            request erasure of your data (we act on it unless we must retain something to meet a
            legal obligation);
          </li>
          <li>withdraw a consent you previously gave; and</li>
          <li>nominate another person to exercise these rights on your behalf.</li>
        </ul>
        <p>
          Clinicians can exercise access, correction, and erasure for their patients&apos; records
          from within the app. For your own account data, contact our Grievance Officer at{' '}
          <a href={`mailto:${GRIEVANCE_EMAIL}`} className="text-[var(--color-accent)]">
            {GRIEVANCE_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Changes to this notice">
        <p>
          We will update this page when our processing changes and revise the effective date above.
          Material changes to how we use your data will be notified in the app.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
