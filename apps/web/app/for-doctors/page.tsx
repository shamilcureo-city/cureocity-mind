import type { Metadata } from 'next';
import Link from 'next/link';
import { ScribeWorkflowPreview } from './ScribeWorkflowPreview';
import { DirhamSymbol } from './DirhamSymbol';
import { SCRIBE_UAE_PLANS, scribeEnquiryHref } from './pricing';
import styles from './scribe-landing.module.css';

export const metadata: Metadata = {
  title: 'Cureocity Scribe | AI consultation notes for UAE doctors',
  description:
    'Give your patients your attention. Draft, review and organise consultation notes, prescriptions and patient documents with Cureocity Scribe. UAE monthly plans: AED 500 for 200 consultations or AED 750 for 500 consultations.',
  alternates: { canonical: 'https://scribe.cureocity.in/' },
  openGraph: {
    title: 'Cureocity Scribe | More attention for your patients',
    description:
      'A doctor-led consultation workflow for UAE practices. Notes, prescription drafts and patient documents, with clear monthly pricing in dirhams.',
    url: 'https://scribe.cureocity.in/',
    siteName: 'Cureocity Scribe',
    locale: 'en_AE',
    type: 'website',
  },
};

function Brand() {
  return (
    <a href="#top" className={styles.brand} aria-label="Cureocity Scribe home">
      <span className={styles.brandMark} aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M5 17h6l3-8 4 15 3-10 2 3h4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>
        Cureocity <strong>Scribe</strong>
      </span>
    </a>
  );
}
function Check() {
  return (
    <svg className={styles.check} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="m5 10 3 3 7-7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const WORKFLOW = [
  {
    title: 'Be present in the conversation.',
    body: 'Confirm patient consent, check your microphone and start the consultation. Scribe builds a transcript and structured note while you speak.',
    label: 'Consult',
  },
  {
    title: 'Make the note your own.',
    body: 'Compare the draft with the transcript. Edit the details, confirm the prescription and apply your clinical judgement before signing.',
    label: 'Review',
  },
  {
    title: 'Finish with clear next steps.',
    body: 'Prepare patient instructions and supporting documents from the approved encounter. Review each output before sharing or downloading.',
    label: 'Complete',
  },
];
const FEATURES = [
  {
    title: 'A note you can actually review',
    body: 'Structured clinical sections, editable drafts and transcript comparison keep the important details within reach.',
    icon: 'note',
  },
  {
    title: 'Your consultation, more useful outputs',
    body: 'Prepare prescription drafts, referral letters and patient summaries without starting from a blank page.',
    icon: 'documents',
  },
  {
    title: 'Continuity between visits',
    body: 'Bring previous signed encounters and intake information into your preparation for the next patient.',
    icon: 'continuity',
  },
  {
    title: 'A workflow that feels like yours',
    body: 'Use personal note layouts and document templates, with support for in-person and teleconsultation workflows.',
    icon: 'practice',
  },
] as const;
function FeatureIcon({ kind }: { kind: (typeof FEATURES)[number]['icon'] }) {
  const paths = {
    note: 'M7 4h10l3 3v15H7V4Zm4 6h5m-5 4h5m-5 4h3',
    documents: 'M9 8h12v16H9V8ZM5 19H3V3h12v2m-2 8h4m-4 4h4',
    continuity: 'M5 9a9 9 0 1 1-1 8M5 3v6h6m3-2v7l4 2',
    practice: 'M4 6h20M4 14h20M4 22h20M9 3v6m10 2v6M11 19v6',
  };
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d={paths[kind]}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
const FAQS = [
  {
    question: 'What does one credit include?',
    answer:
      'One credit is one consultation. Essential includes 200 credits for one month; Plus includes 500 credits for one month. Ask our team about usage terms, unused credits and any applicable taxes before activating your plan.',
  },
  {
    question: 'Can I use Scribe for online consultations?',
    answer:
      'Scribe includes a teleconsultation workflow as well as in-person capture. Your microphone, call setup and patient consent need to be checked before each recording.',
  },
  {
    question: 'Does Scribe make clinical decisions or sign prescriptions?',
    answer:
      'No. AI-generated notes, prescriptions and documents are drafts for your review. You remain responsible for diagnosis, treatment decisions, corrections and clinical approval.',
  },
  {
    question: 'Will it work with the languages used in my clinic?',
    answer:
      'Tell us which languages and language combinations you use. We will help you evaluate your workflow before patient use. Language availability does not guarantee transcription accuracy, and clinical details always need review.',
  },
  {
    question: 'What should my UAE clinic check before using it?',
    answer:
      'Before using real patient data, review the consent process, data-processing locations, retention arrangements and your clinic’s applicable requirements with our team. This page does not claim UAE data residency or regulatory approval.',
  },
  {
    question: 'How do I activate a monthly plan?',
    answer:
      'Choose “Request Essential” or “Request Plus” to email our team. We will confirm the plan, usage terms and any applicable taxes before activation. This page does not take payment or change an existing subscription.',
  },
];

export default function ForDoctorsLanding() {
  return (
    <div className={styles.page} id="top">
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.nav}`}>
          <Brand />
          <nav className={styles.desktopLinks} aria-label="Main navigation">
            <a href="#workflow">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#questions">Questions</a>
          </nav>
          <div className={styles.navActions}>
            <Link href="https://scribe.cureocity.in/login" className={styles.signIn}>
              Sign in
            </Link>
            <a href="#pricing" className={styles.smallButton}>
              View plans
            </a>
          </div>
        </div>
        <nav className={styles.mobileLinks} aria-label="Page sections">
          <a href="#workflow">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#questions">Questions</a>
        </nav>
      </header>
      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`${styles.container} ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <p className={styles.location}>
                <span aria-hidden="true" />
                For doctors and clinics in the UAE
              </p>
              <h1 id="hero-title">Your attention belongs with your patient.</h1>
              <p className={styles.heroDescription}>
                Let Scribe help with the documentation. Turn your consultation into a structured
                note, prescription draft and clear next steps—all ready for your review.
              </p>
              <div className={styles.actions}>
                <a href="#pricing" className={styles.primaryButton}>
                  Find your monthly plan
                </a>
                <a href="#workflow" className={styles.textLink}>
                  Explore the workflow <span aria-hidden="true">↗</span>
                </a>
              </div>
              <p className={styles.heroNote}>
                <Check />
                AI-assisted documentation. Doctor-led care.
              </p>
            </div>
            <ScribeWorkflowPreview />
          </div>
          <div className={`${styles.container} ${styles.contextStrip}`}>
            <span>Built around the consultation</span>
            <span>In-person visits</span>
            <span>Teleconsultations</span>
            <span>Your review comes first</span>
          </div>
        </section>
        <section id="workflow" className={styles.section} aria-labelledby="workflow-title">
          <div className={styles.container}>
            <div className={styles.sectionHeading}>
              <h2 id="workflow-title">From the first word to the final review.</h2>
              <p>
                A connected workspace for the work around your consultation. You bring the clinical
                judgement. Scribe helps organise the details.
              </p>
            </div>
            <ol className={styles.steps}>
              {WORKFLOW.map((step, index) => (
                <li key={step.label}>
                  <div className={styles.stepLabel}>
                    <span>{index + 1}</span>
                    {step.label}
                  </div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <section
          className={`${styles.section} ${styles.features}`}
          aria-labelledby="features-title"
        >
          <div className={`${styles.container} ${styles.featureLayout}`}>
            <div className={styles.featureIntro}>
              <span className={styles.sectionTag}>The Scribe workspace</span>
              <h2 id="features-title">Less starting over. More moving forward.</h2>
              <p>
                Keep the note, the prescription draft and the patient handover connected to the same
                encounter.
              </p>
              <a href={scribeEnquiryHref()} className={styles.textLink}>
                Discuss your clinic’s workflow <span aria-hidden="true">↗</span>
              </a>
            </div>
            <div className={styles.featureGrid}>
              {FEATURES.map((feature) => (
                <article key={feature.title} className={styles.feature}>
                  <FeatureIcon kind={feature.icon} />
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section
          id="pricing"
          className={`${styles.section} ${styles.pricing}`}
          aria-labelledby="pricing-title"
        >
          <div className={styles.container}>
            <div className={`${styles.sectionHeading} ${styles.pricingHeading}`}>
              <div>
                <span className={styles.sectionTag}>Monthly plans · UAE dirhams</span>
                <h2 id="pricing-title">Simple pricing for your practice.</h2>
              </div>
              <p>
                Two monthly options. One clear measure.
                <br />
                <strong>1 credit = 1 consultation.</strong>
              </p>
            </div>
            <div className={styles.planGrid}>
              {SCRIBE_UAE_PLANS.map((plan) => (
                <article
                  className={`${styles.plan} ${plan.id === 'plus' ? styles.plusPlan : ''}`}
                  key={plan.id}
                  aria-labelledby={`plan-${plan.id}`}
                >
                  <div className={styles.planTop}>
                    <h3 id={`plan-${plan.id}`}>{plan.name}</h3>
                    <span>{plan.label}</span>
                  </div>
                  <p className={styles.planDescription}>{plan.description}</p>
                  <div className={styles.price}>
                    <span className={styles.priceAmount}>
                      <span className={styles.srOnly}>AED </span>
                      <DirhamSymbol className={styles.dirham} />
                      <span>{plan.priceAed}</span>
                    </span>
                    <span className={styles.pricePeriod}>/ month</span>
                  </div>
                  <p className={styles.credits}>
                    <strong>{plan.credits} credits</strong>
                    <span>{plan.credits} consultations for 1 month</span>
                  </p>
                  <ul className={styles.planFeatures}>
                    <li>
                      <Check />
                      Consultation transcript and note drafts
                    </li>
                    <li>
                      <Check />
                      Prescription and patient-document drafts
                    </li>
                    <li>
                      <Check />
                      Doctor review and personal templates
                    </li>
                  </ul>
                  <a
                    className={plan.id === 'plus' ? styles.primaryButton : styles.secondaryButton}
                    href={scribeEnquiryHref(plan)}
                  >
                    Request {plan.name}
                  </a>
                </article>
              ))}
            </div>
            <p className={styles.pricingNote}>
              Plan requests open an email to our team. Usage terms and any applicable taxes are
              confirmed before activation. No payment is taken on this page.
            </p>
          </div>
        </section>
        <section
          className={`${styles.section} ${styles.reviewSection}`}
          aria-labelledby="review-title"
        >
          <div className={`${styles.container} ${styles.reviewLayout}`}>
            <div>
              <span className={styles.sectionTag}>Clinical responsibility stays with you</span>
              <h2 id="review-title">
                Helpful drafts.
                <br />
                Your final word.
              </h2>
            </div>
            <div className={styles.reviewPoints}>
              <article>
                <Check />
                <div>
                  <h3>Consent before capture</h3>
                  <p>Confirm the patient’s consent before recording or AI processing.</p>
                </div>
              </article>
              <article>
                <Check />
                <div>
                  <h3>Review before approval</h3>
                  <p>
                    Check the transcript, correct the clinical details and approve the final note
                    and prescription.
                  </p>
                </div>
              </article>
              <article>
                <Check />
                <div>
                  <h3>Assess the fit for your clinic</h3>
                  <p>
                    Discuss your language needs and data-handling requirements before using real
                    patient information.
                  </p>
                </div>
              </article>
            </div>
          </div>
        </section>
        <section
          id="questions"
          className={`${styles.section} ${styles.faqSection}`}
          aria-labelledby="faq-title"
        >
          <div className={`${styles.container} ${styles.faqLayout}`}>
            <div>
              <h2 id="faq-title">A few things worth knowing.</h2>
              <p>
                Have a question about your practice?
                <br />
                <a href={scribeEnquiryHref()} className={styles.textLink}>
                  Talk to our team
                </a>
              </p>
            </div>
            <div className={styles.faqs}>
              {FAQS.map((faq) => (
                <details key={faq.question}>
                  <summary>
                    {faq.question}
                    <span aria-hidden="true">+</span>
                  </summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        <section className={styles.finalCta} aria-labelledby="cta-title">
          <div className={`${styles.container} ${styles.finalCtaInner}`}>
            <div>
              <h2 id="cta-title">
                Make room for the patient.
                <br />
                Start with Scribe.
              </h2>
              <p>Let’s find the right workflow for your UAE practice.</p>
            </div>
            <a href={scribeEnquiryHref()} className={styles.primaryButton}>
              Talk to our team
            </a>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerTop}`}>
          <Brand />
          <nav aria-label="Footer navigation">
            <a href="#pricing">Pricing</a>
            <Link href="https://scribe.cureocity.in/privacy">Privacy</Link>
            <Link href="https://scribe.cureocity.in/terms">Terms</Link>
            <a href={scribeEnquiryHref()}>Contact</a>
          </nav>
        </div>
        <div className={`${styles.container} ${styles.footerBottom}`}>
          <p>© 2026 Cureocity. Scribe for doctors.</p>
          <p>AI assists. Your clinical judgement leads.</p>
        </div>
      </footer>
    </div>
  );
}
