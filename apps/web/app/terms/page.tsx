import type { Metadata } from 'next';
import { COMPANY_LEGAL_NAME, LegalSection, LegalShell } from '@/components/legal/LegalShell';

export const metadata: Metadata = {
  title: 'Terms of Service — Cureocity Mind',
  description:
    'The terms on which clinicians may use Cureocity Mind, including the clinician’s responsibility for every clinical decision the AI assists with.',
};

/**
 * LEGAL-1 — honest terms of service. The load-bearing clause for a clinical
 * AI product is the one that keeps the human clinician responsible for every
 * clinical decision: the product drafts and suggests; the clinician confirms.
 */
export default function TermsOfService() {
  return (
    <LegalShell
      title="Terms of Service"
      intro={`These terms govern your use of Cureocity Mind, operated by ${COMPANY_LEGAL_NAME}. By creating an account or using the service you agree to them.`}
    >
      <LegalSection heading="Who may use Cureocity Mind">
        <p>
          Cureocity Mind is a professional tool for qualified, registered mental-health clinicians
          and doctors practising in India. You confirm that you hold the registration you provide
          and that you are authorised to create the clinical records you enter.
        </p>
      </LegalSection>

      <LegalSection heading="A copilot, not a clinician — you remain responsible">
        <p>
          Cureocity Mind uses AI to transcribe sessions and to draft notes, suggested diagnoses,
          treatment plans, prescriptions, and other clinical content.{' '}
          <strong>
            These are assistive drafts and suggestions only. AI output can be incomplete or wrong.
            You are the clinician:
          </strong>{' '}
          you must review, verify, and confirm every clinical statement before you rely on it, sign
          it, or share it with a patient. Nothing the AI produces is medical advice or a substitute
          for your professional judgement, and the service is not a medical device intended for
          diagnosis or treatment on its own.
        </p>
      </LegalSection>

      <LegalSection heading="Consent and your patients">
        <p>
          You are responsible for obtaining your patients&apos; informed consent to be recorded and
          to have their data processed as described in our{' '}
          <a href="/privacy" className="text-[var(--color-accent)]">
            Privacy Policy
          </a>
          , and for using the patient-facing sharing features lawfully and appropriately.
        </p>
      </LegalSection>

      <LegalSection heading="Your account">
        <p>
          Keep your credentials secure and do not share your account. You are responsible for
          activity under your account. Tell us promptly if you suspect unauthorised access.
        </p>
      </LegalSection>

      <LegalSection heading="Subscriptions and payment">
        <p>
          Paid plans are billed through Razorpay on the terms shown at checkout. Trial limits, plan
          allowances, and any overage are described on the Plan page in the app. Taxes apply as
          required by law.
        </p>
      </LegalSection>

      <LegalSection heading="Availability and changes">
        <p>
          We work to keep the service reliable but provide it on an &quot;as available&quot; basis
          and may change or discontinue features. We will give reasonable notice of material changes
          that affect you.
        </p>
      </LegalSection>

      <LegalSection heading="Limitation of liability">
        <p>
          To the extent permitted by law, {COMPANY_LEGAL_NAME} is not liable for clinical decisions
          made using the service — those remain your professional responsibility — nor for indirect
          or consequential loss. Nothing in these terms limits liability that cannot be limited by
          law.
        </p>
      </LegalSection>

      <LegalSection heading="Governing law">
        <p>
          These terms are governed by the laws of India, and the courts at our registered place of
          business have exclusive jurisdiction.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
