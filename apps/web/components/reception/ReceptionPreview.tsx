'use client';

import { useCallback, useRef, useState } from 'react';
import {
  ReceptionActionSchema,
  ReceptionRequestInputSchema,
  ReceptionSettingsSchema,
  receptionSlots,
  type PublicReception as PublicData,
  type ReceptionRequestView,
  type ReceptionSettings,
  type ReceptionVertical,
  type ReceptionWorkspace as WorkspaceData,
} from '@/lib/reception';
import { ReceptionWorkspace, type ReceptionFetch } from './ReceptionWorkspace';
import { PublicReception } from './PublicReception';
import styles from './Reception.module.css';

function fixture(vertical: ReceptionVertical): WorkspaceData {
  const doctor = vertical === 'DOCTOR';
  const settings: ReceptionSettings = {
    version: 1,
    enabled: true,
    slug: doctor ? 'demo-grove-clinic' : 'demo-grove-practice',
    practiceName: doctor ? 'Grove Family Clinic' : 'Grove Therapy Practice',
    timezone: doctor ? 'Asia/Dubai' : 'Asia/Kolkata',
    mode: doctor ? 'IN_PERSON' : 'ONLINE',
    slotMinutes: doctor ? 30 : 60,
    hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })),
    faqs: [
      {
        id: 'location',
        question: 'Where is the practice?',
        answer: doctor
          ? 'Our fictional preview clinic is in Al Safa, Dubai. The reception team shares arrival instructions when confirming an appointment.'
          : 'This fictional preview practice offers online sessions. The team shares joining details when confirming your session.',
      },
      {
        id: 'prepare',
        question: 'How should I prepare for my first appointment?',
        answer:
          'Please have your appointment details ready. If you have questions about what to bring, send the reception team a request before your visit.',
      },
      {
        id: 'fees',
        question: 'What are the appointment fees?',
        answer:
          'The reception team confirms the fee before your appointment is booked. Send a question if you would like to check the current fee.',
      },
      {
        id: 'change',
        question: 'Can I change or cancel an appointment?',
        answer:
          'Choose a reschedule or cancellation request on this page. The team will contact you to verify your details and confirm any changes.',
      },
    ],
  };
  const now = new Date();
  const slot = receptionSlots(settings, [], now)[0];
  const make = (
    id: string,
    kind: ReceptionRequestView['kind'],
    name: string,
    message: string,
    minutesAgo: number,
  ): ReceptionRequestView => ({
    id,
    kind,
    status: 'NEW',
    patientName: name,
    patientPhone: doctor ? '+971500000001' : '+919000000001',
    patientEmail: `${id}@example.test`,
    message,
    desiredStartAt: kind === 'BOOKING' ? (slot?.startAt ?? null) : null,
    createdAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    updatedAt: now.toISOString(),
    appointmentId: null,
    sessionId: null,
    clientId: null,
    events: [],
  });
  return {
    settings,
    vertical,
    practitionerName: doctor ? 'Dr Leena Rao (fictional)' : 'Leena Rao (fictional)',
    clients: [
      { id: 'fictional-asha', name: 'Asha Menon (fictional)' },
      { id: 'fictional-samir', name: 'Samir Khan (fictional)' },
    ],
    requests: [
      make(
        'preview-asha',
        'BOOKING',
        'Asha Menon',
        'I would prefer a morning appointment. Please call to confirm.',
        8,
      ),
      make(
        'preview-samir',
        'RESCHEDULE',
        'Samir Khan',
        'Could we move my Friday afternoon appointment to next week?',
        36,
      ),
      make(
        'preview-noor',
        'QUESTION',
        'Noor Ali',
        'Is there step-free access to the practice?',
        90,
      ),
    ],
  };
}

export function ReceptionPreview() {
  const [vertical, setVertical] = useState<ReceptionVertical>('DOCTOR');
  const [view, setView] = useState<'workspace' | 'public'>('workspace');
  const store = useRef<WorkspaceData>(fixture('DOCTOR'));
  const idempotency = useRef(new Map<string, string>());
  const calendar = useRef<Array<{ startAt: Date; endAt: Date }>>([]);

  // Explicit in-memory transport: no global fetch replacement and no external APIs.
  const request = useCallback<ReceptionFetch>(async (input, init) => {
    const data = store.current;
    const method = init?.method ?? 'GET';
    const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));
    const publicData = (): PublicData => ({
      practiceName: data.settings.practiceName,
      practitionerName: data.practitionerName,
      vertical: data.vertical,
      slug: data.settings.slug,
      timezone: data.settings.timezone,
      mode: data.settings.mode,
      slotMinutes: data.settings.slotMinutes,
      faqs: data.settings.faqs,
      slots: receptionSlots(data.settings, calendar.current),
    });
    if (input === '/api/v1/reception' && method === 'GET') return json(data);
    if (input === '/api/v1/reception' && method === 'PUT') {
      const parsed = ReceptionSettingsSchema.safeParse(JSON.parse(String(init?.body)));
      if (!parsed.success) return json({ error: parsed.error.issues[0]?.message }, 400);
      if (parsed.data.version !== data.settings.version)
        return json({ error: 'Settings changed. Refresh before saving again.' }, 409);
      data.settings = { ...parsed.data, version: parsed.data.version + 1 };
      return json(data.settings);
    }
    if (input.startsWith('/api/v1/reception/requests/') && method === 'PATCH') {
      const item = data.requests.find((value) => value.id === input.split('/').at(-1));
      const parsed = ReceptionActionSchema.safeParse(JSON.parse(String(init?.body)));
      if (!item || !parsed.success)
        return json({ error: 'This preview request could not be found.' }, 404);
      if (parsed.data.action === 'ERASE') {
        data.requests = data.requests.filter((value) => value.id !== item.id);
        return json({ erased: true });
      }
      if (item.status !== 'NEW')
        return json({ error: 'This request has already been handled.' }, 409);
      if (parsed.data.action === 'APPROVE_BOOKING') {
        const action = parsed.data;
        if (
          item.kind !== 'BOOKING' ||
          !data.clients.some((client) => client.id === action.clientId)
        )
          return json({ error: 'Choose an existing record before approving.' }, 400);
        if (!publicData().slots.some((slot) => slot.startAt === item.desiredStartAt))
          return json(
            {
              error:
                'That time is no longer available. Contact the person to arrange another time.',
            },
            409,
          );
        item.status = 'BOOKED';
        item.clientId = action.clientId;
        item.appointmentId = `preview-appointment-${item.id}`;
        item.sessionId = `preview-session-${item.id}`;
        calendar.current.push({
          startAt: new Date(item.desiredStartAt!),
          endAt: new Date(
            new Date(item.desiredStartAt!).getTime() + data.settings.slotMinutes * 60_000,
          ),
        });
      } else if (parsed.data.action === 'DECLINE') item.status = 'DECLINED';
      else if (item.kind !== 'BOOKING') item.status = 'RESOLVED';
      else return json({ error: 'Review this appointment request before closing it.' }, 400);
      item.updatedAt = new Date().toISOString();
      item.events.push({
        id: crypto.randomUUID(),
        action: parsed.data.action,
        createdAt: item.updatedAt,
      });
      return json(item);
    }
    if (input.startsWith('/api/v1/public/reception/')) {
      if (!data.settings.enabled)
        return json({ error: 'This preview reception page is disabled.' }, 404);
      if (method === 'GET') return json(publicData());
      if (method === 'POST' && input.endsWith('/requests')) {
        const parsed = ReceptionRequestInputSchema.safeParse(JSON.parse(String(init?.body)));
        if (!parsed.success) return json({ error: parsed.error.issues[0]?.message }, 400);
        const payload = parsed.data;
        const existing = idempotency.current.get(payload.idempotencyKey);
        if (existing) return json({ requestId: existing, status: 'NEW' });
        if (
          payload.kind === 'BOOKING' &&
          !publicData().slots.some((slot) => slot.startAt === payload.desiredStartAt)
        )
          return json({ error: 'That time is no longer available. Choose another time.' }, 409);
        const id = crypto.randomUUID();
        data.requests.unshift({
          id,
          kind: payload.kind,
          status: 'NEW',
          patientName: payload.patientName,
          patientPhone: payload.patientPhone,
          patientEmail: payload.patientEmail ?? null,
          message: payload.message,
          desiredStartAt: payload.desiredStartAt ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          appointmentId: null,
          sessionId: null,
          clientId: null,
          events: [],
        });
        idempotency.current.set(payload.idempotencyKey, id);
        return json({ requestId: id, status: 'NEW' });
      }
    }
    return json({ error: 'This action is unavailable in the local preview.' }, 404);
  }, []);

  return (
    <>
      <div className={styles.previewShell}>
        <div className={styles.previewBar}>
          <p>
            <strong>Reception preview</strong>
            <span className={styles.subtle}>
              Fictional data only. No bookings or messages leave this browser.
            </span>
          </p>
          <label>
            <span className={styles.label}>Product</span>
            <select
              className={styles.select}
              value={vertical}
              onChange={(event) => {
                const value = event.target.value as ReceptionVertical;
                store.current = fixture(value);
                idempotency.current.clear();
                calendar.current = [];
                setVertical(value);
              }}
            >
              <option value="DOCTOR">Cureocity Scribe</option>
              <option value="THERAPIST">Cureocity Mind</option>
            </select>
          </label>
          <label>
            <span className={styles.label}>View</span>
            <select
              className={styles.select}
              value={view}
              onChange={(event) => setView(event.target.value as 'workspace' | 'public')}
            >
              <option value="workspace">Practice workspace</option>
              <option value="public">Public receptionist</option>
            </select>
          </label>
        </div>
      </div>
      {view === 'workspace' ? (
        <ReceptionWorkspace
          key={`${vertical}-workspace`}
          vertical={vertical}
          request={request}
          preview
        />
      ) : (
        <PublicReception
          key={`${vertical}-public`}
          slug={store.current.settings.slug}
          request={request}
          preview
        />
      )}
    </>
  );
}
