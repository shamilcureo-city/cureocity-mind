'use client';
import { useState } from 'react';
import styles from './scribe-landing.module.css';

const DOCUMENTS = {
  Note: {
    heading: 'Consultation note',
    sections: [
      ['Reason for visit', 'Follow-up consultation'],
      ['Discussion', 'Current concerns and progress since the previous visit.'],
      ['Plan', 'Next steps to be confirmed by the treating doctor.'],
    ],
  },
  Prescription: {
    heading: 'Prescription draft',
    sections: [
      ['Medication review', 'Review the medicine, strength and instructions before confirming.'],
      ['Clinician confirmation', 'No medicine is approved in this example.'],
      ['Next step', 'Confirm the prescription in your encounter workspace.'],
    ],
  },
  Documents: {
    heading: 'Patient summary',
    sections: [
      ['Today’s visit', 'A plain-language summary of the approved encounter.'],
      ['Instructions', 'Review the advice and follow-up details before sharing.'],
      ['Other outputs', 'Prepare a referral letter or supporting document.'],
    ],
  },
} as const;

export function ScribeWorkflowPreview() {
  const [active, setActive] = useState<keyof typeof DOCUMENTS>('Note');
  const document = DOCUMENTS[active];
  return (
    <div className={styles.previewWrap}>
      <div className={styles.previewAccent} aria-hidden="true" />
      <div className={styles.preview}>
        <div className={styles.previewHeader}>
          <span className={styles.previewLogo} aria-hidden="true">
            S
          </span>
          <strong>Consultation workspace</strong>
          <span className={styles.previewBadge}>Example</span>
        </div>
        <div className={styles.previewVisit}>
          <div>
            <span className={styles.previewAvatar} aria-hidden="true">
              P
            </span>
            <div>
              <strong>Follow-up consultation</strong>
              <p>Example patient · In-person visit</p>
            </div>
          </div>
          <span className={styles.draftPill}>Draft</span>
        </div>
        <div className={styles.previewTranscript}>
          <div className={styles.transcriptLabel}>
            <span className={styles.waveform} aria-hidden="true">
              {[12, 21, 14, 29, 18, 24, 10].map((height, i) => (
                <i key={i} style={{ height }} />
              ))}
            </span>
            <span>From the conversation</span>
          </div>
          <p>“Let’s go through how you’ve been feeling and agree on the next steps.”</p>
        </div>
        <div className={styles.previewTabs} role="group" aria-label="Choose an example document">
          {(Object.keys(DOCUMENTS) as (keyof typeof DOCUMENTS)[]).map((name) => (
            <button
              type="button"
              key={name}
              aria-pressed={active === name}
              aria-controls="scribe-example-document"
              onClick={() => setActive(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div
          className={styles.previewDocument}
          id="scribe-example-document"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className={styles.documentTitle}>
            <h3>{document.heading}</h3>
            <span>For review</span>
          </div>
          <dl>
            {document.sections.map(([label, content]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{content}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className={styles.previewFooter}>
          <span className={styles.reviewDot} aria-hidden="true" />
          <span>Ready for your review. Never a substitute for it.</span>
        </div>
      </div>
      <p className={styles.previewCaption}>Illustrative preview · No real patient data</p>
    </div>
  );
}
