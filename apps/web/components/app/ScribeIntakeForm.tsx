'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ScribeIntakeVitalsSchema,
  type ScribeIntakeReport,
  type ScribeIntakeVitals,
} from '@/lib/scribe-intake-contracts';
import { Button } from '../ui/Button';
import { CheckboxRow, Input, Select, Textarea } from '../ui/Field';
import { useScribeFetch } from './ScribeTransport';

const VITAL_INPUTS = [
  { key: 'bpSystolic', label: 'BP systolic (mmHg)', min: 20, max: 350, step: 1 },
  { key: 'bpDiastolic', label: 'BP diastolic (mmHg)', min: 10, max: 250, step: 1 },
  { key: 'heartRateBpm', label: 'Pulse (bpm)', min: 10, max: 350, step: 1 },
  { key: 'spo2Pct', label: 'SpO₂ (%)', min: 1, max: 100, step: 0.1 },
  { key: 'tempCelsius', label: 'Temperature (°C)', min: 25, max: 45, step: 0.1 },
  { key: 'weightKg', label: 'Weight (kg)', min: 0.01, max: 1000, step: 0.01 },
] as const;

function emptyReport(): Omit<ScribeIntakeReport, 'acknowledged'> {
  return {
    authorName: '',
    authorRole: 'patient',
    reasonForVisit: '',
    medications: '',
    allergyStatus: 'unknown',
    allergies: '',
    history: '',
    vitals: null,
  };
}

export function ScribeIntakeForm() {
  const request = useScribeFetch();
  const [grant, setGrant] = useState<{
    psychologistId: string;
    recordId: string;
    token: string;
    generation: number;
  } | null>(null);
  const [report, setReport] = useState(emptyReport);
  const [measuredAt, setMeasuredAt] = useState('');
  const [vitalValues, setVitalValues] = useState<
    Partial<Record<Exclude<keyof ScribeIntakeVitals, 'measuredAt'>, string>>
  >({});
  const hasVitals = Object.values(vitalValues).some((value) => value?.trim());
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeLinkRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const submissionRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const readLink = () => {
      const hash = window.location.hash;
      if (hash === activeLinkRef.current) return;
      activeLinkRef.current = hash;
      generationRef.current += 1;
      submissionRef.current?.abort();
      submissionRef.current = null;
      setGrant(null);
      setReport(emptyReport());
      setMeasuredAt('');
      setVitalValues({});
      setChecked(false);
      setBusy(false);
      setDone(false);
      setError(null);
      const params = new URLSearchParams(hash.slice(1));
      const psychologistId = params.get('owner');
      const recordId = params.get('record');
      const token = params.get('token');
      if (psychologistId && recordId && token)
        setGrant({ psychologistId, recordId, token, generation: generationRef.current });
      else setError('Open the complete private link from your clinic, including the part after #.');
      // No network lookup: a link holder cannot read patient identity or chart data.
    };
    readLink();
    window.addEventListener('hashchange', readLink);
    window.addEventListener('popstate', readLink);
    return () => {
      window.removeEventListener('hashchange', readLink);
      window.removeEventListener('popstate', readLink);
      generationRef.current += 1;
      activeLinkRef.current = null;
      submissionRef.current?.abort();
      submissionRef.current = null;
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const hash = activeLinkRef.current;
    // Check the URL as well as React state: a submit can precede the queued hashchange event.
    if (
      !grant ||
      !checked ||
      submissionRef.current ||
      grant.generation !== generationRef.current ||
      hash !== window.location.hash
    )
      return;
    const generation = generationRef.current;
    const controller = new AbortController();
    submissionRef.current = controller;
    const ownsAttempt = () =>
      generationRef.current === generation &&
      submissionRef.current === controller &&
      !controller.signal.aborted &&
      activeLinkRef.current === hash &&
      window.location.hash === hash;
    setBusy(true);
    setError(null);
    try {
      const measuredDate = new Date(measuredAt);
      if (hasVitals && !Number.isFinite(measuredDate.getTime()))
        throw new Error('Enter when the readings were measured.');
      const vitals = hasVitals
        ? ScribeIntakeVitalsSchema.safeParse({
            measuredAt: measuredDate.toISOString(),
            ...Object.fromEntries(
              Object.entries(vitalValues)
                .filter(([, value]) => value?.trim())
                .map(([key, value]) => [key, Number(value)]),
            ),
          })
        : null;
      if (vitals && !vitals.success)
        throw new Error(vitals.error.issues[0]?.message ?? 'Check the vital readings.');
      const response = await request('/api/v1/scribe-intake/submit', {
        method: 'POST',
        credentials: 'omit',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          psychologistId: grant.psychologistId,
          recordId: grant.recordId,
          token: grant.token,
          report: { ...report, vitals: vitals?.success ? vitals.data : null, acknowledged: true },
        }),
      });
      if (!ownsAttempt()) return;
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Could not submit. Contact your clinic if this continues.');
      }
      setDone(true);
      setGrant(null);
      setReport(emptyReport());
      setMeasuredAt('');
      setVitalValues({});
      setChecked(false);
      setBusy(false);
      submissionRef.current = null;
      activeLinkRef.current = '';
      window.history.replaceState(null, '', window.location.pathname);
    } catch (reason) {
      if (ownsAttempt()) setError((reason as Error).message);
    } finally {
      if (ownsAttempt()) {
        submissionRef.current = null;
        setBusy(false);
      }
    }
  }
  if (done)
    return (
      <div role="status" className="rounded-xl border p-6">
        <h1 className="font-serif text-2xl">Submitted for doctor review</h1>
        <p className="mt-3">
          Your information was sent. This is not medical advice or confirmation that a doctor has
          read it. For urgent concerns, contact your clinic or local emergency service.
        </p>
      </div>
    );
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="space-y-4 rounded-2xl border border-[var(--color-line)] bg-white p-6"
    >
      <h1 className="font-serif text-2xl">Before your visit</h1>
      <p className="text-sm">
        Submit information only for the patient this link was issued for. The doctor will review it;
        nothing is automatically entered into the clinical chart. Do not use this form for
        emergencies.
      </p>
      <label className="block text-sm">
        Your name
        <Input
          autoComplete="name"
          value={report.authorName}
          maxLength={100}
          onChange={(event) => setReport({ ...report, authorName: event.target.value })}
          required
        />
      </label>
      <label className="block text-sm">
        You are submitting as
        <Select
          value={report.authorRole}
          onChange={(event) =>
            setReport({
              ...report,
              authorRole: event.target.value as ScribeIntakeReport['authorRole'],
            })
          }
        >
          <option value="patient">Patient</option>
          <option value="caregiver">Caregiver</option>
          <option value="staff">Clinic staff</option>
        </Select>
      </label>
      <label className="block text-sm">
        Reason for visit
        <Textarea
          value={report.reasonForVisit}
          maxLength={2000}
          onChange={(event) => setReport({ ...report, reasonForVisit: event.target.value })}
          required
        />
      </label>
      <label className="block text-sm">
        Medicines currently being taken (name and dose, if known)
        <Textarea
          value={report.medications}
          maxLength={2000}
          onChange={(event) => setReport({ ...report, medications: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        Known allergies
        <Select
          value={report.allergyStatus}
          onChange={(event) =>
            setReport({
              ...report,
              allergyStatus: event.target.value as ScribeIntakeReport['allergyStatus'],
              allergies: '',
            })
          }
        >
          <option value="unknown">Unknown / not sure</option>
          <option value="none_reported">No allergies known to me</option>
          <option value="reported">There are known allergies</option>
        </Select>
      </label>
      {report.allergyStatus === 'reported' && (
        <label className="block text-sm">
          Allergy details
          <Textarea
            value={report.allergies}
            maxLength={1000}
            required
            onChange={(event) => setReport({ ...report, allergies: event.target.value })}
          />
        </label>
      )}
      <label className="block text-sm">
        Relevant history or readings (include date, unit and source if known)
        <Textarea
          value={report.history}
          maxLength={3000}
          onChange={(event) => setReport({ ...report, history: event.target.value })}
        />
      </label>
      <fieldset className="space-y-3 rounded-xl border border-[var(--color-line)] p-4">
        <legend className="px-1 text-sm font-medium">Optional measured readings</legend>
        <p className="text-xs">
          Enter only measured values, with their units and measurement time. The doctor must check
          these self-reported readings; they are not added to the chart automatically.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {VITAL_INPUTS.map((field) => (
            <label key={field.key} className="text-sm">
              {field.label}
              <Input
                type="number"
                min={field.min}
                max={field.max}
                step={field.step}
                value={vitalValues[field.key] ?? ''}
                onChange={(event) =>
                  setVitalValues({ ...vitalValues, [field.key]: event.target.value })
                }
              />
            </label>
          ))}
        </div>
        <label className="block text-sm">
          Measured date and time (your local time)
          <Input
            type="datetime-local"
            required={hasVitals}
            value={measuredAt}
            onChange={(event) => setMeasuredAt(event.target.value)}
          />
        </label>
      </fieldset>
      <CheckboxRow
        id="intake-acknowledgement"
        checked={checked}
        onChange={setChecked}
        label="I am authorised to send this information to the clinic for this patient’s visit."
        description="I understand it is self-reported, needs doctor review, and is not monitored for emergencies."
      />
      {error && (
        <p role="alert" className="text-sm text-[var(--color-warn)]">
          {error}
        </p>
      )}
      <Button type="submit" disabled={!grant || !checked || busy}>
        {busy ? 'Submitting…' : 'Submit once for doctor review'}
      </Button>
    </form>
  );
}
