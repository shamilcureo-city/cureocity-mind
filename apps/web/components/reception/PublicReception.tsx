'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ReceptionRequestInputSchema,
  receptionSlotLabel,
  suggestReceptionFaqs,
  type PublicReception as PublicData,
  type ReceptionRequestKind,
} from '@/lib/reception';
import { receptionFetch, type ReceptionFetch } from './ReceptionWorkspace';
import styles from './PublicReception.module.css';

const requestTypes: Array<{ value: ReceptionRequestKind; label: string }> = [
  { value: 'BOOKING', label: 'Book an appointment' },
  { value: 'RESCHEDULE', label: 'Change an appointment' },
  { value: 'CANCEL', label: 'Cancel an appointment' },
  { value: 'QUESTION', label: 'Ask a question' },
];
const pendingCopy: Record<ReceptionRequestKind, string> = {
  BOOKING:
    'Your appointment is not confirmed yet. The practice will review your request and contact you about the next step.',
  QUESTION:
    'The practice will review your question and contact you using the details you provided.',
  CANCEL:
    'Your appointment has not been cancelled. Wait for the practice to contact you and confirm the change.',
  RESCHEDULE:
    'Your appointment has not moved. Wait for the practice to contact you and confirm a new time.',
};
type FieldErrors = Partial<
  Record<'time' | 'message' | 'name' | 'phone' | 'email' | 'consent', string>
>;

export function PublicReception({
  slug,
  request = receptionFetch,
  preview = false,
}: {
  slug: string;
  request?: ReceptionFetch;
  preview?: boolean;
}) {
  const [data, setData] = useState<PublicData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [question, setQuestion] = useState('');
  const [searched, setSearched] = useState(false);
  const [kind, setKind] = useState<ReceptionRequestKind>('BOOKING');
  const [step, setStep] = useState(0);
  const [date, setDate] = useState('');
  const [startAt, setStartAt] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState<{
    kind: ReceptionRequestKind;
    id: string;
    contact: string;
    time: string;
  } | null>(null);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const shouldFocus = useRef(false);
  const api = `/api/v1/public/reception/${encodeURIComponent(slug)}`;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await request(api, { cache: 'no-store', signal });
      if (!response.ok) {
        if (response.status === 404)
          throw new Error('This reception page is unavailable. Contact the practice directly.');
        throw new Error('Reception could not load. Please try again.');
      }
      const body = (await response.json()) as PublicData;
      if (!signal?.aborted) setData(body);
      return body;
    },
    [api, request],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    setData(null);
    void load(controller.signal)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(
            reason instanceof Error
              ? reason.message
              : 'Reception could not load. Please try again.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!shouldFocus.current) return;
    if (error) errorRef.current?.focus();
    else headingRef.current?.focus();
    shouldFocus.current = false;
  }, [step, error, submitted]);

  async function refresh() {
    setLoading(true);
    setLoadError('');
    try {
      await load();
    } catch (reason) {
      setLoadError(
        reason instanceof Error ? reason.message : 'Reception could not load. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  function moveTo(next: number) {
    shouldFocus.current = true;
    setError('');
    setFieldErrors({});
    if (next < 2) setConsent(false);
    setStep(next);
  }
  function showErrors(fields: FieldErrors, summary = 'Check the highlighted details below.') {
    shouldFocus.current = true;
    setFieldErrors(fields);
    setError(summary);
    if (error === summary) errorRef.current?.focus();
  }
  function askPractice() {
    if (busy) return;
    setKind('QUESTION');
    setMessage(question);
    setConsent(false);
    setSubmitted(null);
    moveTo(0);
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView({ block: 'start' });
  }
  function continueRequest() {
    if (step === 0) {
      const errors: FieldErrors = {};
      if (kind === 'BOOKING' && !data?.slots.some((slot) => slot.startAt === startAt))
        errors.time = 'Choose an available time to continue.';
      if (kind !== 'BOOKING' && !message.trim())
        errors.message =
          kind === 'QUESTION'
            ? 'Write the question you would like the practice to answer.'
            : 'Add the date and time of your existing appointment.';
      if (Object.keys(errors).length) return showErrors(errors);
      moveTo(1);
    } else if (step === 1) {
      const errors: FieldErrors = {};
      if (name.trim().length < 2) errors.name = 'Enter your full name.';
      if (!/^\+[1-9]\d{7,14}$/.test(phone.trim().replace(/[\s()-]/g, '')))
        errors.phone = 'Include your country code, for example +971 50 123 4567.';
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
        errors.email = 'Enter a valid email address or leave this blank.';
      if (Object.keys(errors).length) return showErrors(errors);
      moveTo(2);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step < 2) return continueRequest();
    if (website || !data) return;
    if (!consent)
      return showErrors({ consent: 'Please agree to be contacted about this request.' });
    const payload = {
      kind,
      patientName: name.trim(),
      patientPhone: phone.trim().replace(/[\s()-]/g, ''),
      ...(email.trim() ? { patientEmail: email.trim() } : {}),
      message: message.trim(),
      ...(kind === 'BOOKING' ? { desiredStartAt: startAt } : {}),
      consentContact: consent,
    };
    const fingerprint = JSON.stringify(payload);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    const parsed = ReceptionRequestInputSchema.safeParse({
      ...payload,
      idempotencyKey: retry.current.key,
    });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      if (field === 'patientEmail' || field === 'patientName' || field === 'patientPhone') {
        setStep(1);
        const key = field === 'patientEmail' ? 'email' : field === 'patientName' ? 'name' : 'phone';
        showErrors({ [key]: 'Check this contact detail and try again.' });
      } else showErrors({}, 'Check your request details before sending.');
      return;
    }
    setError('');
    setFieldErrors({});
    setBusy(true);
    try {
      const response = await request(`${api}/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        requestId?: string;
        status?: string;
      } | null;
      if (!response.ok) {
        if (response.status === 404) {
          setData(null);
          setLoadError('This reception page is unavailable. Contact the practice directly.');
        }
        if (response.status === 409) {
          setStartAt('');
          setConsent(false);
          setStep(0);
          await load().catch(() => undefined);
          throw new Error(
            'That time is no longer available. Choose another time; your contact details are saved here.',
          );
        }
        throw new Error(
          response.status === 429
            ? 'Too many requests. Wait a few minutes before trying again.'
            : response.status === 403
              ? 'Your request could not be sent securely. Refresh this page and try again.'
              : response.status >= 500
                ? 'Reception is temporarily unavailable. Your request is not confirmed. Try again shortly or contact the practice.'
                : body?.error ||
                  'Your request could not be sent. Your details are still here; please try again.',
        );
      }
      if (!body?.requestId || body.status !== 'NEW')
        throw new Error(
          'The response could not be verified. Please contact the practice before sending another request.',
        );
      shouldFocus.current = true;
      setSubmitted({
        kind,
        id: body.requestId,
        contact: phone.trim(),
        time: kind === 'BOOKING' ? receptionSlotLabel(startAt, data.timezone) : '',
      });
      retry.current = null;
      setName('');
      setPhone('');
      setEmail('');
      setMessage('');
      setConsent(false);
      setStartAt('');
    } catch (reason) {
      shouldFocus.current = true;
      setError(
        reason instanceof TypeError
          ? 'The connection was interrupted. Your details are still here. Try again to check this request.'
          : reason instanceof Error
            ? reason.message
            : 'Your request could not be sent. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const localDate = (value: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: data?.timezone ?? 'Asia/Dubai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value));
    return ['year', 'month', 'day']
      .map((type) => parts.find((part) => part.type === type)?.value)
      .join('-');
  };
  const dates = [...new Set(data?.slots.map((slot) => localDate(slot.startAt)) ?? [])];
  const selectedDate = dates.includes(date) ? date : (dates[0] ?? '');
  const slots = data?.slots.filter((slot) => localDate(slot.startAt) === selectedDate) ?? [];
  const timezoneLabel =
    data?.timezone === 'Asia/Kolkata' ? 'India time (UTC+5:30)' : 'UAE time (UTC+4)';
  const product = data?.vertical === 'DOCTOR' ? 'Scribe' : 'Mind';
  const faqs = data ? (searched ? suggestReceptionFaqs(question, data.faqs) : data.faqs) : [];
  const steps = [
    kind === 'BOOKING' ? 'Choose a time' : 'Your request',
    'Contact details',
    'Review',
  ];
  const stepTitle =
    step === 0
      ? kind === 'BOOKING'
        ? 'Find a time that works for you'
        : kind === 'QUESTION'
          ? 'What would you like to ask?'
          : kind === 'CANCEL'
            ? 'Which appointment should we cancel?'
            : 'Which appointment would you like to change?'
      : step === 1
        ? 'How can the practice reach you?'
        : 'Check your request';

  return (
    <main className={styles.page}>
      {loading && !data && (
        <p className={styles.loading} role="status">
          Opening reception…
        </p>
      )}
      {loadError && (
        <div className={styles.unavailable} role="alert">
          <h1>Reception is unavailable</h1>
          <p>{loadError}</p>
          <button className={styles.secondary} disabled={loading} onClick={() => void refresh()}>
            {loading ? 'Trying again…' : 'Try again'}
          </button>
        </div>
      )}
      {data && (
        <>
          <header className={styles.practiceHeader}>
            <div className={styles.practiceIdentity}>
              <span className={styles.practiceMark} aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 12h4l2-6 3 12 2-6h3"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div>
                <h1>{data.practiceName}</h1>
                <p>{data.practitionerName}</p>
              </div>
            </div>
            <span className={styles.poweredBy}>Cureocity {product} reception</span>
          </header>
          <div className={styles.layout}>
            <section className={styles.requestPanel} aria-labelledby="public-request-title">
              {!submitted && (
                <nav aria-label="Request progress" className={styles.progress}>
                  <ol>
                    {steps.map((label, index) => (
                      <li
                        key={index}
                        aria-current={step === index ? 'step' : undefined}
                        data-complete={index < step}
                      >
                        {index < step ? (
                          <button
                            type="button"
                            onClick={() => moveTo(index)}
                            disabled={busy}
                            aria-label={`Edit ${label.toLowerCase()}`}
                          >
                            <span aria-hidden="true">✓</span>
                            <span>{label}</span>
                          </button>
                        ) : (
                          <span className={styles.progressItem}>
                            <span aria-hidden="true">{index + 1}</span>
                            <span>{label}</span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
              <div className={styles.formBody}>
                <h2
                  id="public-request-title"
                  className={styles.heading}
                  tabIndex={-1}
                  ref={headingRef}
                >
                  {submitted ? 'Your request is with the practice' : stepTitle}
                </h2>
                {submitted ? (
                  <div role="status" className={styles.receipt}>
                    <span className={styles.receiptStatus}>Waiting for practice review</span>
                    <p className={styles.receiptLead}>
                      {preview
                        ? 'This is a preview request. Nothing was sent to a real practice.'
                        : pendingCopy[submitted.kind]}
                    </p>
                    {preview && <p>{pendingCopy[submitted.kind]}</p>}
                    {submitted.time && (
                      <p>
                        <strong>Requested time</strong>
                        <br />
                        {submitted.time} ({timezoneLabel})
                      </p>
                    )}
                    <p>
                      <strong>Contact number</strong>
                      <br />
                      {submitted.contact}
                    </p>
                    <p className={styles.helper}>
                      No automatic confirmation email or message has been sent.
                    </p>
                    <button
                      className={styles.secondary}
                      onClick={() => {
                        setSubmitted(null);
                        setKind('BOOKING');
                        moveTo(0);
                      }}
                    >
                      Start another request
                    </button>
                  </div>
                ) : (
                  <form onSubmit={submit} noValidate aria-busy={busy}>
                    <p className={styles.intro}>
                      {step === 0
                        ? 'Choose what you need. The practice reviews every request before confirming.'
                        : step === 1
                          ? 'The practice will use these details to follow up. No account needed.'
                          : 'Nothing changes until the practice reviews your request and contacts you.'}
                    </p>
                    {error && (
                      <div className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>
                        {error}
                      </div>
                    )}
                    {step === 0 && (
                      <>
                        <fieldset className={styles.intentGroup}>
                          <legend className={styles.label}>What would you like to do?</legend>
                          <div className={styles.intentChoices}>
                            {requestTypes.map((type) => (
                              <label className={styles.intent} key={type.value}>
                                <input
                                  type="radio"
                                  name="request-kind"
                                  value={type.value}
                                  checked={kind === type.value}
                                  onChange={() => {
                                    setKind(type.value);
                                    setConsent(false);
                                    setError('');
                                    setFieldErrors({});
                                  }}
                                />
                                <span>{type.label}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        {kind === 'BOOKING' && (
                          <div className={styles.timeSection}>
                            <div className={styles.visitDetails}>
                              <span>{data.slotMinutes}-minute appointment</span>
                              <span>
                                {data.mode === 'ONLINE' ? 'Online consultation' : 'In-person visit'}
                              </span>
                            </div>
                            {dates.length ? (
                              <>
                                <label className={styles.field}>
                                  <span className={styles.label}>Choose a day</span>
                                  <select
                                    className={styles.input}
                                    value={selectedDate}
                                    onChange={(event) => {
                                      setDate(event.target.value);
                                      setStartAt('');
                                    }}
                                  >
                                    {dates.map((day) => (
                                      <option key={day} value={day}>
                                        {new Intl.DateTimeFormat('en-GB', {
                                          weekday: 'long',
                                          day: 'numeric',
                                          month: 'long',
                                          timeZone: 'UTC',
                                        }).format(new Date(`${day}T12:00:00Z`))}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <fieldset
                                  className={styles.slotGroup}
                                  aria-describedby={
                                    fieldErrors.time
                                      ? 'reception-time-error'
                                      : 'reception-time-help'
                                  }
                                >
                                  <legend className={styles.label}>
                                    Available times{' '}
                                    <span className={styles.timezone}>{timezoneLabel}</span>
                                  </legend>
                                  <div className={styles.slots}>
                                    {slots.map((slot) => (
                                      <button
                                        className={styles.slot}
                                        type="button"
                                        key={slot.startAt}
                                        aria-pressed={startAt === slot.startAt}
                                        onClick={() => {
                                          setStartAt(slot.startAt);
                                          setFieldErrors((previous) => ({
                                            ...previous,
                                            time: undefined,
                                          }));
                                        }}
                                      >
                                        {new Intl.DateTimeFormat('en-GB', {
                                          timeZone: data.timezone,
                                          hour: 'numeric',
                                          minute: '2-digit',
                                          hour12: true,
                                        }).format(new Date(slot.startAt))}
                                      </button>
                                    ))}
                                  </div>
                                  {fieldErrors.time && (
                                    <p className={styles.fieldError} id="reception-time-error">
                                      {fieldErrors.time}
                                    </p>
                                  )}
                                  <p className={styles.helper} id="reception-time-help">
                                    Times are not reserved until the practice approves.
                                  </p>
                                </fieldset>
                              </>
                            ) : (
                              <div className={styles.notice}>
                                <strong>No available times in the next two weeks</strong>
                                <p>The practice can help you find another option.</p>
                                <button
                                  className={styles.textButton}
                                  type="button"
                                  onClick={() => {
                                    setKind('QUESTION');
                                    setMessage('When is your next available appointment?');
                                    setError('');
                                    setFieldErrors({});
                                  }}
                                >
                                  Ask about availability
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        {(kind === 'CANCEL' || kind === 'RESCHEDULE') && (
                          <p className={styles.notice}>
                            {kind === 'CANCEL'
                              ? 'Your appointment stays booked until the practice confirms your cancellation.'
                              : 'Your current appointment stays booked until the practice confirms a new time.'}
                          </p>
                        )}
                        <label className={styles.field}>
                          <span className={styles.label}>
                            {kind === 'BOOKING' ? (
                              <>
                                A note for reception{' '}
                                <span className={styles.optional}>(optional)</span>
                              </>
                            ) : kind === 'QUESTION' ? (
                              'Your question'
                            ) : (
                              'Existing appointment and requested change'
                            )}
                          </span>
                          <textarea
                            className={styles.input}
                            value={message}
                            onChange={(event) => setMessage(event.target.value)}
                            maxLength={1000}
                            rows={kind === 'BOOKING' ? 2 : 4}
                            aria-invalid={Boolean(fieldErrors.message)}
                            aria-describedby={`reception-message-help${fieldErrors.message ? ' reception-message-error' : ''}`}
                            placeholder={
                              kind === 'BOOKING'
                                ? 'For example, I need step-free access.'
                                : kind === 'QUESTION'
                                  ? 'What would you like to know about the practice?'
                                  : 'Include the appointment date and time. For a new time, tell us what works for you.'
                            }
                          />
                          {fieldErrors.message && (
                            <span className={styles.fieldError} id="reception-message-error">
                              {fieldErrors.message}
                            </span>
                          )}
                          <span className={styles.helper} id="reception-message-help">
                            Appointment details only. Please don’t include symptoms or medical
                            records.
                          </span>
                        </label>
                      </>
                    )}
                    {step === 1 && (
                      <div className={styles.contactFields}>
                        <label className={styles.field}>
                          <span className={styles.label}>Full name</span>
                          <input
                            className={styles.input}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            autoComplete="name"
                            minLength={2}
                            maxLength={120}
                            aria-invalid={Boolean(fieldErrors.name)}
                            aria-describedby={fieldErrors.name ? 'reception-name-error' : undefined}
                          />
                          {fieldErrors.name && (
                            <span className={styles.fieldError} id="reception-name-error">
                              {fieldErrors.name}
                            </span>
                          )}
                        </label>
                        <label className={styles.field}>
                          <span className={styles.label}>Phone number</span>
                          <input
                            className={styles.input}
                            type="tel"
                            value={phone}
                            onChange={(event) => setPhone(event.target.value)}
                            autoComplete="tel"
                            placeholder={
                              data.timezone === 'Asia/Dubai'
                                ? '+971 50 123 4567'
                                : '+91 98765 43210'
                            }
                            maxLength={24}
                            aria-invalid={Boolean(fieldErrors.phone)}
                            aria-describedby={`reception-phone-help${fieldErrors.phone ? ' reception-phone-error' : ''}`}
                          />
                          {fieldErrors.phone && (
                            <span className={styles.fieldError} id="reception-phone-error">
                              {fieldErrors.phone}
                            </span>
                          )}
                          <span className={styles.helper} id="reception-phone-help">
                            Include the country code. The practice will contact you here.
                          </span>
                        </label>
                        <label className={styles.field}>
                          <span className={styles.label}>
                            Email <span className={styles.optional}>(optional)</span>
                          </span>
                          <input
                            className={styles.input}
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            autoComplete="email"
                            maxLength={254}
                            aria-invalid={Boolean(fieldErrors.email)}
                            aria-describedby={
                              fieldErrors.email ? 'reception-email-error' : undefined
                            }
                          />
                          {fieldErrors.email && (
                            <span className={styles.fieldError} id="reception-email-error">
                              {fieldErrors.email}
                            </span>
                          )}
                        </label>
                      </div>
                    )}
                    {step === 2 && (
                      <>
                        <div className={styles.reviewSection}>
                          <div className={styles.reviewHeading}>
                            <h3>Your request</h3>
                            <button
                              className={styles.textButton}
                              type="button"
                              disabled={busy}
                              onClick={() => moveTo(0)}
                            >
                              Edit request
                            </button>
                          </div>
                          <dl className={styles.summary}>
                            <div>
                              <dt>Request</dt>
                              <dd>{requestTypes.find((type) => type.value === kind)?.label}</dd>
                            </div>
                            {kind === 'BOOKING' && (
                              <>
                                <div>
                                  <dt>Time</dt>
                                  <dd>
                                    {receptionSlotLabel(startAt, data.timezone)}
                                    <span className={styles.summaryDetail}>{timezoneLabel}</span>
                                  </dd>
                                </div>
                                <div>
                                  <dt>Visit</dt>
                                  <dd>
                                    {data.slotMinutes} minutes,{' '}
                                    {data.mode === 'ONLINE' ? 'online' : 'in person'}
                                  </dd>
                                </div>
                              </>
                            )}
                            {message.trim() && (
                              <div>
                                <dt>{kind === 'QUESTION' ? 'Question' : 'Your note'}</dt>
                                <dd className={styles.message}>{message.trim()}</dd>
                              </div>
                            )}
                          </dl>
                        </div>
                        <div className={styles.reviewSection}>
                          <div className={styles.reviewHeading}>
                            <h3>Contact details</h3>
                            <button
                              className={styles.textButton}
                              type="button"
                              disabled={busy}
                              onClick={() => moveTo(1)}
                            >
                              Edit contact
                            </button>
                          </div>
                          <dl className={styles.summary}>
                            <div>
                              <dt>Name</dt>
                              <dd>{name.trim()}</dd>
                            </div>
                            <div>
                              <dt>Phone</dt>
                              <dd>{phone.trim()}</dd>
                            </div>
                            {email.trim() && (
                              <div>
                                <dt>Email</dt>
                                <dd>{email.trim()}</dd>
                              </div>
                            )}
                          </dl>
                        </div>
                        <label className={styles.consent}>
                          <input
                            type="checkbox"
                            checked={consent}
                            onChange={(event) => setConsent(event.target.checked)}
                            disabled={busy}
                            aria-invalid={Boolean(fieldErrors.consent)}
                            aria-describedby={
                              fieldErrors.consent ? 'reception-consent-error' : undefined
                            }
                          />
                          <span>
                            I agree that the practice can use these details to contact me about this
                            request.
                          </span>
                        </label>
                        {fieldErrors.consent && (
                          <p className={styles.fieldError} id="reception-consent-error">
                            {fieldErrors.consent}
                          </p>
                        )}
                      </>
                    )}
                    <label className={styles.honeypot} aria-hidden="true">
                      Website
                      <input
                        tabIndex={-1}
                        autoComplete="off"
                        value={website}
                        onChange={(event) => setWebsite(event.target.value)}
                      />
                    </label>
                    <div className={styles.actions}>
                      {step > 0 && (
                        <button
                          className={styles.secondary}
                          type="button"
                          disabled={busy}
                          onClick={() => moveTo(step - 1)}
                        >
                          Back
                        </button>
                      )}
                      <button
                        className={styles.primary}
                        type="submit"
                        disabled={busy || (step === 0 && kind === 'BOOKING' && !dates.length)}
                      >
                        {busy
                          ? 'Sending request…'
                          : step === 0
                            ? 'Continue to contact details'
                            : step === 1
                              ? 'Review request'
                              : kind === 'BOOKING'
                                ? 'Send appointment request'
                                : 'Send request to practice'}
                      </button>
                    </div>
                    <p className={styles.actionNote}>
                      {step < 2
                        ? 'You can check everything before sending.'
                        : 'This is a request, not a confirmed booking or change.'}
                    </p>
                  </form>
                )}
              </div>
            </section>
            <aside className={styles.supportPanel} aria-labelledby="approved-answers-title">
              <h2 id="approved-answers-title">Before you visit</h2>
              <p className={styles.supportIntro}>Useful answers, approved by the practice.</p>
              {data.faqs.length > 3 && (
                <form
                  className={styles.search}
                  onSubmit={(event) => {
                    event.preventDefault();
                    setSearched(true);
                  }}
                >
                  <label className={styles.label} htmlFor="reception-faq-search">
                    Find practice information
                  </label>
                  <div className={styles.searchRow}>
                    <input
                      id="reception-faq-search"
                      className={styles.input}
                      value={question}
                      onChange={(event) => {
                        setQuestion(event.target.value);
                        setSearched(false);
                      }}
                      maxLength={500}
                      placeholder="Location, fees, opening hours…"
                    />
                    <button className={styles.secondary} type="submit">
                      Find
                    </button>
                  </div>
                </form>
              )}
              <div className={styles.faqList} aria-live="polite">
                {faqs.map((faq) => (
                  <details key={faq.id} className={styles.faq}>
                    <summary>
                      {faq.question}
                      <span aria-hidden="true">+</span>
                    </summary>
                    <p>{faq.answer}</p>
                  </details>
                ))}
                {searched && !faqs.length && (
                  <p className={styles.helper}>
                    No approved answer matches that question. You can send it to the practice
                    instead.
                  </p>
                )}
                {!data.faqs.length && (
                  <p className={styles.helper}>
                    Practice information hasn’t been added yet. You can send a question below.
                  </p>
                )}
              </div>
              <div className={styles.askBox}>
                <h3>Need something else?</h3>
                <p>The practice can help with appointment and clinic questions.</p>
                <button className={styles.textButton} onClick={askPractice} disabled={busy}>
                  Ask the practice
                </button>
              </div>
              <p className={styles.boundary}>
                For medical or mental health advice, speak with your practitioner during a
                consultation.
              </p>
            </aside>
          </div>
          <footer className={styles.footer}>
            <p>
              This form is not monitored for emergencies. For urgent help, contact local emergency
              services.
            </p>
            <p>
              Reception for {data.practiceName}, powered by Cureocity {product}.
            </p>
          </footer>
        </>
      )}
    </main>
  );
}
