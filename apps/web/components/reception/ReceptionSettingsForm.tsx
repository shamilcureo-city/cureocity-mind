'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ReceptionSettingsSchema, type ReceptionSettings } from '@/lib/reception';
import styles from './Reception.module.css';
import settingsStyles from './ReceptionSettings.module.css';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const timeLabel = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
type SettingsSection = 'publication' | 'hours' | 'answers';

export function ReceptionSettingsForm({
  initial,
  onSave,
  busy,
  onDirtyChange,
}: {
  initial: ReceptionSettings;
  onSave: (settings: ReceptionSettings) => Promise<void>;
  busy: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [validation, setValidation] = useState('');
  const [invalidSection, setInvalidSection] = useState<SettingsSection>('publication');
  const [openSection, setOpenSection] = useState<SettingsSection | null>(
    initial.enabled ? 'hours' : 'publication',
  );
  const validationRef = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const changedElsewhere = dirty && initial.version !== baseline.version;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty && initial.version !== baseline.version) {
      setDraft(initial);
      setBaseline(initial);
    }
  }, [baseline.version, dirty, initial]);
  useEffect(() => {
    if (validation) validationRef.current?.focus();
  }, [validation]);
  const update = <K extends keyof ReceptionSettings>(key: K, value: ReceptionSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setValidation('');
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !dirty || changedElsewhere) return;
    const result = ReceptionSettingsSchema.safeParse(draft);
    if (!result.success) {
      const field = result.error.issues[0]?.path[0];
      const section =
        field === 'faqs'
          ? 'answers'
          : ['hours', 'timezone', 'slotMinutes', 'mode'].includes(String(field))
            ? 'hours'
            : 'publication';
      setInvalidSection(section);
      setOpenSection(section);
      setValidation(result.error.issues[0]?.message ?? 'Check the reception settings.');
      return;
    }
    setValidation('');
    await onSave(result.data);
  }

  function section(id: SettingsSection, title: string, summary: string, children: ReactNode) {
    const expanded = openSection === id;
    return (
      <section className={settingsStyles.section} aria-labelledby={`settings-${id}-title`}>
        <h2 className={settingsStyles.sectionHeading}>
          <button
            className={settingsStyles.sectionToggle}
            type="button"
            id={`settings-${id}-title`}
            aria-expanded={expanded}
            aria-controls={`settings-${id}-panel`}
            onClick={() => setOpenSection(expanded ? null : id)}
          >
            <span>
              <span className={settingsStyles.sectionName}>{title}</span>
              <span className={settingsStyles.sectionSummary}>{summary}</span>
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d={expanded ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'}
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </h2>
        <div className={settingsStyles.sectionBody} id={`settings-${id}-panel`} hidden={!expanded}>
          {validation && invalidSection === id && (
            <div className={styles.error} role="alert" tabIndex={-1} ref={validationRef}>
              {validation}
            </div>
          )}
          {children}
        </div>
      </section>
    );
  }

  return (
    <form className={`${styles.settings} ${settingsStyles.form}`} onSubmit={save} noValidate>
      <div className={settingsStyles.intro}>
        <h2 className={styles.sectionTitle}>Set up your reception</h2>
        <p className={styles.hint}>
          Control your public page, appointment times and approved answers.
        </p>
      </div>
      <fieldset className={settingsStyles.fields} disabled={busy} aria-label="Reception settings">
        {changedElsewhere && (
          <div className={styles.banner} role="status">
            <strong>Settings changed elsewhere</strong>
            <p>
              Your draft is still here. Discard it to load the latest saved settings before making
              more changes.
            </p>
          </div>
        )}
        {section(
          'publication',
          'Public page',
          draft.enabled === initial.enabled
            ? draft.enabled
              ? 'Public page is on'
              : 'Public page is off'
            : draft.enabled
              ? 'Will accept requests after saving'
              : 'Will stop accepting requests after saving',
          <>
            <p className={styles.sectionIntro}>
              Choose what people can see and request. Every appointment request waits for your
              review.
            </p>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => update('enabled', event.target.checked)}
              />
              <span>
                <strong>Enable public reception</strong>
                <br />
                <span className={styles.subtle}>
                  Your page accepts requests when this is enabled and saved.
                </span>
              </span>
            </label>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Practice or clinic name</span>
                <input
                  className={styles.input}
                  required
                  minLength={2}
                  maxLength={100}
                  value={draft.practiceName}
                  onChange={(event) => update('practiceName', event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Public page address</span>
                <input
                  className={styles.input}
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={draft.slug}
                  placeholder="your-practice"
                  onChange={(event) => update('slug', event.target.value)}
                  aria-describedby="reception-slug-help"
                />
                <span className={styles.hint} id="reception-slug-help">
                  /reception/{draft.slug || 'your-practice'} · lowercase letters, numbers and
                  hyphens
                </span>
              </label>
            </div>
          </>,
        )}

        {section(
          'hours',
          'Appointment hours',
          `${draft.hours.length} opening ${draft.hours.length === 1 ? 'window' : 'windows'} · ${draft.slotMinutes} minutes · ${draft.timezone === 'Asia/Dubai' ? 'UAE time' : 'India time'}`,
          <>
            <p className={styles.sectionIntro}>
              Available times use this timezone and exclude existing appointments. Requests do not
              reserve a time until you approve them.
            </p>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Practice timezone</span>
                <select
                  className={styles.select}
                  value={draft.timezone}
                  onChange={(event) =>
                    update('timezone', event.target.value as ReceptionSettings['timezone'])
                  }
                >
                  <option value="Asia/Dubai">UAE · Dubai (UTC+4)</option>
                  <option value="Asia/Kolkata">India · Kolkata (UTC+5:30)</option>
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Appointment mode</span>
                <select
                  className={styles.select}
                  value={draft.mode}
                  onChange={(event) =>
                    update('mode', event.target.value as ReceptionSettings['mode'])
                  }
                >
                  <option value="IN_PERSON">In person</option>
                  <option value="ONLINE">Online</option>
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Appointment duration</span>
                <select
                  className={styles.select}
                  value={draft.slotMinutes}
                  onChange={(event) =>
                    update(
                      'slotMinutes',
                      Number(event.target.value) as ReceptionSettings['slotMinutes'],
                    )
                  }
                >
                  {[15, 20, 30, 45, 60, 90].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {draft.hours.length === 0 && (
              <p className={styles.banner}>
                No opening hours yet. Add a window before enabling reception.
              </p>
            )}
            {draft.hours.map((hours, index) => (
              <div className={settingsStyles.hours} key={index}>
                <label className={styles.field}>
                  <span className={styles.label}>Day</span>
                  <select
                    className={styles.select}
                    aria-label={`Day for opening window ${index + 1}`}
                    value={hours.weekday}
                    onChange={(event) =>
                      update(
                        'hours',
                        draft.hours.map((value, i) =>
                          i === index ? { ...value, weekday: Number(event.target.value) } : value,
                        ),
                      )
                    }
                  >
                    {weekdays.map((day, weekday) => (
                      <option key={day} value={weekday}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
                {(['startMinute', 'endMinute'] as const).map((key) => (
                  <label className={styles.field} key={key}>
                    <span className={styles.label}>
                      {key === 'startMinute' ? 'Opens' : 'Closes'}
                    </span>
                    <select
                      className={styles.select}
                      aria-label={`${key === 'startMinute' ? 'Opening' : 'Closing'} time for window ${index + 1}`}
                      value={hours[key]}
                      onChange={(event) =>
                        update(
                          'hours',
                          draft.hours.map((value, i) =>
                            i === index ? { ...value, [key]: Number(event.target.value) } : value,
                          ),
                        )
                      }
                    >
                      {[...new Set([...Array.from({ length: 97 }, (_, i) => i * 15), hours[key]])]
                        .sort((a, b) => a - b)
                        .filter((minute) => (key === 'startMinute' ? minute < 1440 : minute > 0))
                        .map((minute) => (
                          <option key={minute} value={minute}>
                            {minute === 1440 ? '24:00 (midnight)' : timeLabel(minute)}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
                <button
                  type="button"
                  className={styles.quiet}
                  aria-label={`Remove opening window ${index + 1}`}
                  onClick={() =>
                    update(
                      'hours',
                      draft.hours.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <div className={styles.saveBar}>
              <button
                type="button"
                className={styles.secondary}
                disabled={draft.hours.length >= 28}
                onClick={() =>
                  update('hours', [
                    ...draft.hours,
                    {
                      weekday:
                        [1, 2, 3, 4, 5, 6, 0].find(
                          (day) => !draft.hours.some((window) => window.weekday === day),
                        ) ?? 1,
                      startMinute: 540,
                      endMinute: 1020,
                    },
                  ])
                }
              >
                Add opening hours
              </button>
            </div>
          </>,
        )}

        {section(
          'answers',
          'Approved answers',
          `${draft.faqs.length} ${draft.faqs.length === 1 ? 'answer' : 'answers'} for practice questions`,
          <>
            <p className={styles.sectionIntro}>
              Write answers about fees, location, preparation and practice policies. Reception shows
              these exact answers. Keep clinical advice and personal information out of this public
              content.
            </p>
            {draft.faqs.length === 0 && (
              <p className={styles.subtle}>
                Add the questions your reception desk hears most often.
              </p>
            )}
            {draft.faqs.map((faq, index) => (
              <div className={settingsStyles.faqEditor} key={faq.id}>
                <label className={styles.field}>
                  <span className={styles.label}>Question {index + 1}</span>
                  <input
                    className={styles.input}
                    required
                    minLength={5}
                    maxLength={160}
                    value={faq.question}
                    onChange={(event) =>
                      update(
                        'faqs',
                        draft.faqs.map((value, i) =>
                          i === index ? { ...value, question: event.target.value } : value,
                        ),
                      )
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Approved answer</span>
                  <textarea
                    className={styles.textarea}
                    required
                    maxLength={1200}
                    rows={3}
                    value={faq.answer}
                    onChange={(event) =>
                      update(
                        'faqs',
                        draft.faqs.map((value, i) =>
                          i === index ? { ...value, answer: event.target.value } : value,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className={styles.quiet}
                  onClick={() =>
                    update(
                      'faqs',
                      draft.faqs.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove question {index + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.secondary}
              disabled={draft.faqs.length >= 20}
              onClick={() =>
                update('faqs', [
                  ...draft.faqs,
                  { id: crypto.randomUUID(), question: '', answer: '' },
                ])
              }
            >
              Add approved answer
            </button>
          </>,
        )}
        <div className={settingsStyles.saveBar}>
          <p className={settingsStyles.saveState} role="status">
            <strong>
              {busy
                ? 'Saving your changes…'
                : dirty
                  ? 'You have unsaved changes'
                  : 'No unsaved changes'}
            </strong>
            <span>
              {dirty
                ? 'Your public page stays unchanged until you save.'
                : 'Changes apply to your public page only after saving.'}
            </span>
          </p>
          <div className={settingsStyles.saveActions}>
            {dirty && (
              <button
                className={styles.quiet}
                type="button"
                onClick={() => {
                  setDraft(initial);
                  setBaseline(initial);
                  setValidation('');
                }}
              >
                Discard changes
              </button>
            )}
            <button
              className={styles.button}
              type="submit"
              disabled={busy || !dirty || changedElsewhere}
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
