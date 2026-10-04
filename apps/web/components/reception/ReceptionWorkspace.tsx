'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  receptionSlotLabel,
  ReceptionSettingsSchema,
  type ReceptionAction,
  type ReceptionRequestView,
  type ReceptionSettings,
  type ReceptionVertical,
  type ReceptionWorkspace as WorkspaceData,
} from '@/lib/reception';
import { ReceptionSettingsForm } from './ReceptionSettingsForm';
import {
  parseReceptionActionReceipt,
  reconcileReceptionReceipt,
} from '@/lib/reception-workspace-state';
import styles from './Reception.module.css';

export type ReceptionFetch = (input: string, init?: RequestInit) => Promise<Response>;
export const receptionFetch: ReceptionFetch = (input, init) => fetch(input, init);
const kindLabels = {
  BOOKING: 'Appointment request',
  CANCEL: 'Cancellation request',
  RESCHEDULE: 'Reschedule request',
  QUESTION: 'Question',
};
const statusLabels = {
  NEW: 'Needs review',
  BOOKED: 'Booked',
  DECLINED: 'Declined',
  RESOLVED: 'Resolved',
};

async function responseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || fallback;
}

export function ReceptionWorkspace({
  vertical,
  request = receptionFetch,
  preview = false,
}: {
  vertical: ReceptionVertical;
  request?: ReceptionFetch;
  preview?: boolean;
}) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [tab, setTab] = useState<'requests' | 'settings'>('requests');
  const [filter, setFilter] = useState<'NEW' | 'BOOKED' | 'DONE' | 'ALL'>('NEW');
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mobileDetail, setMobileDetail] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState('');
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaveRevision, setSettingsSaveRevision] = useState(0);
  const lastRequestButton = useRef<HTMLButtonElement | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const accessDenied = useRef(false);
  const patient = vertical === 'DOCTOR' ? 'patient' : 'client';
  const product = vertical === 'DOCTOR' ? 'Scribe' : 'Mind';

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await request('/api/v1/reception', { cache: 'no-store', signal });
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          accessDenied.current = true;
          setData(null);
        }
        throw new Error(await responseError(response, 'Reception could not load. Try again.'));
      }
      const body = (await response.json()) as WorkspaceData;
      if (!signal?.aborted && !accessDenied.current) {
        setData(body);
        setSelectedId((current) =>
          body.requests.some((item) => item.id === current)
            ? current
            : (body.requests.find((item) => item.status === 'NEW')?.id ??
              body.requests[0]?.id ??
              ''),
        );
      }
    },
    [request],
  );

  useEffect(() => {
    const controller = new AbortController();
    accessDenied.current = false;
    setData(null);
    setError('');
    setLoading(true);
    void load(controller.signal)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : 'Reception could not load. Try again.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load]);

  async function refresh() {
    setError('');
    setRefreshWarning('');
    setLoading(true);
    accessDenied.current = false;
    try {
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Reception could not load. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(settings: ReceptionSettings) {
    if (accessDenied.current) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await request('/api/v1/reception', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          accessDenied.current = true;
          setData(null);
        }
        throw new Error(
          await responseError(
            response,
            'Settings could not be saved. Your changes are still here.',
          ),
        );
      }
      const savedResult = ReceptionSettingsSchema.safeParse(await response.json());
      if (!savedResult.success || savedResult.data.version <= settings.version) {
        throw new Error(
          'The save response could not be verified. Use Try again to reload saved settings; your draft is preserved.',
        );
      }
      const saved = savedResult.data;
      if (!accessDenied.current)
        setData((current) => (current ? { ...current, settings: saved } : null));
      setSettingsSaveRevision((version) => version + 1);
      setSettingsDirty(false);
      setNotice(
        preview
          ? 'Preview settings saved in this browser session only.'
          : 'Reception settings saved.',
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Settings could not be saved. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: ReceptionAction) {
    if (accessDenied.current) return;
    setBusy(true);
    setError('');
    setNotice('');
    setRefreshWarning('');
    try {
      const response = await request(`/api/v1/reception/requests/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action),
      });
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          accessDenied.current = true;
          setData(null);
        }
        throw new Error(
          await responseError(
            response,
            'This request could not be updated. Refresh and try again.',
          ),
        );
      }
      let result: ReceptionRequestView | { erased: true };
      try {
        result = parseReceptionActionReceipt(id, action, await response.json());
      } catch {
        setData(null);
        throw new Error(
          'The update response could not be verified. Refresh to check the request before acting again.',
        );
      }
      setData((current) => (current ? reconcileReceptionReceipt(current, id, result) : null));
      if ('erased' in result) setMobileDetail(false);
      else {
        setFilter(action.action === 'APPROVE_BOOKING' ? 'BOOKED' : 'DONE');
        setSelectedId(id);
      }
      setNotice(
        action.action === 'ERASE'
          ? 'Enquiry deleted. Its contact details and message have been removed. Calendar appointments and patient or client records are unchanged.'
          : action.action === 'APPROVE_BOOKING'
            ? `Appointment booked${preview ? ' in the preview' : ''}. Contact the ${patient} to confirm the details; no message has been sent.`
            : action.action === 'DECLINE'
              ? 'Request declined. No message has been sent.'
              : 'Request marked resolved. No appointment has been changed and no message has been sent.',
      );
      // The receipt confirms the mutation even if refreshing the rest of the inbox fails.
      try {
        await load();
      } catch {
        setRefreshWarning(
          'Your change was saved. Other requests could not refresh; try Refresh when your connection returns.',
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'This request could not be updated. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const requests =
    data?.requests.filter(
      (item) =>
        (filter === 'ALL' ||
          (filter === 'DONE'
            ? ['DECLINED', 'RESOLVED'].includes(item.status)
            : item.status === filter)) &&
        `${item.patientName} ${item.patientPhone} ${kindLabels[item.kind]}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    ) ?? [];
  const selected = requests.find((item) => item.id === selectedId) ?? requests[0];
  const loadedPending = data?.requests.filter((item) => item.status === 'NEW').length ?? 0;
  const pending = data?.pendingCount ?? loadedPending;

  useEffect(() => {
    if (tab === 'requests' && mobileDetail && window.matchMedia('(max-width: 760px)').matches) {
      document.getElementById('request-detail-heading')?.focus();
    }
  }, [mobileDetail, selected?.id, tab]);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <p className={styles.product}>Cureocity {product}</p>
          <h1 className={styles.heading}>Reception</h1>
          <p className={styles.lede}>
            {data
              ? `${pending} ${pending === 1 ? 'request needs' : 'requests need'} your review.`
              : 'Your practice’s appointment requests and enquiries.'}
          </p>
        </div>
        <div className={styles.headerActions}>
          {data && (
            <span className={styles.deskStatus} data-enabled={data.settings.enabled}>
              <span aria-hidden="true" />
              {data.settings.enabled ? 'Accepting requests' : 'Reception paused'}
            </span>
          )}
          {data?.settings.enabled && !preview && (
            <a
              className={styles.secondary}
              href={`/reception/${data.settings.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              Open public page <span className={styles.subtle}>(new tab)</span>
            </a>
          )}
          <button
            className={styles.quiet}
            disabled={loading || busy || settingsDirty}
            title={settingsDirty ? 'Save or discard settings changes before refreshing' : undefined}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
      </header>
      {error && (
        <div className={styles.error} role="alert">
          <strong>Reception needs attention</strong>
          <p>{error}</p>
          <button
            className={styles.secondary}
            onClick={() => void refresh()}
            disabled={loading || busy}
          >
            Try again
          </button>
        </div>
      )}
      {notice && (
        <div className={styles.success} role="status" tabIndex={-1} ref={noticeRef}>
          {notice}
        </div>
      )}
      {refreshWarning && (
        <p className={styles.banner} role="status">
          {refreshWarning}
        </p>
      )}
      {loading && !data && (
        <p className={styles.empty} role="status">
          Loading reception…
        </p>
      )}
      {data && (
        <>
          {!data.settings.enabled && (
            <div className={styles.banner}>
              <strong>Public reception is off</strong>
              <p>Set your opening hours and approved answers, then enable reception in Settings.</p>
            </div>
          )}
          <div className={styles.tabs} aria-label="Reception views">
            <button
              className={styles.tab}
              aria-pressed={tab === 'requests'}
              disabled={busy}
              onClick={() => setTab('requests')}
            >
              Requests <span className={styles.count}>{pending}</span>
            </button>
            <button
              className={styles.tab}
              aria-pressed={tab === 'settings'}
              disabled={busy}
              onClick={() => setTab('settings')}
            >
              Settings {settingsDirty && <span className={styles.count}>Unsaved</span>}
            </button>
          </div>
          <div hidden={tab !== 'settings'}>
            <ReceptionSettingsForm
              key={settingsSaveRevision}
              initial={data.settings}
              onSave={saveSettings}
              busy={busy}
              onDirtyChange={setSettingsDirty}
            />
          </div>
          {tab === 'requests' && pending > loadedPending && (
            <div className={styles.banner} role="status">
              <strong>
                {loadedPending} of {pending} requests needing review are loaded
              </strong>
              <p>
                Review the oldest requests first. Then select Refresh to load the next pending
                requests. Search only covers the requests currently loaded.
              </p>
              <button
                className={styles.quiet}
                disabled={loading || busy || settingsDirty}
                onClick={() => void refresh()}
              >
                Refresh pending requests
              </button>
            </div>
          )}
          {tab === 'requests' && data.hasMoreHistory && (
            <div className={styles.banner}>
              <strong>Older completed requests are not loaded</strong>
              <p>
                History is limited to the latest 200 completed requests on refresh. Booked, Closed
                and All filters, and search, only cover loaded requests. Older history cannot be
                searched from this inbox.
              </p>
            </div>
          )}
          {tab === 'requests' && (
            <div className={styles.inbox} data-mobile-detail={mobileDetail && !!selected}>
              <section className={styles.listPane} aria-label="Reception request list">
                <div className={styles.inboxIntro}>
                  <h2 id="reception-inbox-title" tabIndex={-1}>
                    Request inbox
                  </h2>
                  <span>{requests.length} shown</span>
                </div>
                <label className={styles.inboxSearch}>
                  <span className={styles.srOnly}>Search loaded requests</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.7" />
                    <path
                      d="m16 16 5 5"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                  <input
                    disabled={busy}
                    value={search}
                    placeholder="Search loaded requests"
                    aria-describedby="reception-search-scope"
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setMobileDetail(false);
                    }}
                  />
                </label>
                <p
                  className={styles.hint}
                  id="reception-search-scope"
                  style={{ margin: '6px 16px' }}
                >
                  Search loaded requests by name or phone. Pending requests are oldest first.
                </p>
                <div className={styles.filters}>
                  {(
                    [
                      ['NEW', 'Needs review'],
                      ['BOOKED', 'Booked'],
                      ['DONE', 'Closed'],
                      ['ALL', 'All'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      className={styles.filter}
                      key={value}
                      aria-pressed={filter === value}
                      disabled={busy}
                      onClick={() => {
                        setFilter(value);
                        setMobileDetail(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {requests.length === 0 ? (
                  <div className={styles.empty}>
                    <strong>
                      {search
                        ? 'No matching requests'
                        : filter === 'NEW'
                          ? pending > 0
                            ? 'More requests are waiting'
                            : 'You’re up to date'
                          : 'No requests here'}
                    </strong>
                    <p>
                      {search
                        ? 'Try a different name or phone number.'
                        : filter === 'NEW'
                          ? pending > 0
                            ? 'Select Refresh to load the next requests needing review.'
                            : 'New appointment requests and enquiries will appear here for your review.'
                          : 'Choose another filter to see more requests.'}
                    </p>
                    {search && (
                      <button className={styles.secondary} onClick={() => setSearch('')}>
                        Clear search
                      </button>
                    )}
                  </div>
                ) : (
                  <ul className={styles.requestList}>
                    {requests.map((item) => (
                      <li key={item.id}>
                        <button
                          className={styles.requestRow}
                          aria-pressed={selected?.id === item.id}
                          disabled={busy}
                          onClick={(event) => {
                            lastRequestButton.current = event.currentTarget;
                            setSelectedId(item.id);
                            setNotice('');
                            setMobileDetail(true);
                          }}
                        >
                          <span className={styles.rowHeading}>
                            <strong>{item.patientName}</strong>
                            <span
                              className={styles.status}
                              data-status={item.status === 'NEW' ? 'PENDING' : item.status}
                            >
                              {statusLabels[item.status]}
                            </span>
                          </span>
                          <span className={styles.rowMeta}>
                            {kindLabels[item.kind]} ·{' '}
                            {new Intl.DateTimeFormat('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              timeZone: data.settings.timezone,
                            }).format(new Date(item.createdAt))}
                          </span>
                          <span className={styles.rowExcerpt}>
                            {item.kind === 'BOOKING' && item.desiredStartAt
                              ? receptionSlotLabel(item.desiredStartAt, data.settings.timezone)
                              : item.message}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {selected ? (
                <RequestDetail
                  key={selected.id}
                  item={selected}
                  data={data}
                  busy={busy}
                  onAction={act}
                  preview={preview}
                  onBack={() => {
                    setMobileDetail(false);
                    requestAnimationFrame(() => {
                      if (lastRequestButton.current?.isConnected) lastRequestButton.current.focus();
                      else document.getElementById('reception-inbox-title')?.focus();
                    });
                  }}
                />
              ) : (
                <section className={styles.empty} aria-label="Request detail">
                  <strong>Ready for the next request</strong>
                  <p>Select a request to review the details and decide what happens next.</p>
                </section>
              )}
            </div>
          )}
        </>
      )}
      <p className={styles.footerNote}>
        This pilot handles web requests and approved practice answers. Messaging, appointment
        waitlists and telephone reception are not connected.
      </p>
    </main>
  );
}

function RequestDetail({
  item,
  data,
  busy,
  onAction,
  preview,
  onBack,
}: {
  item: ReceptionRequestView;
  data: WorkspaceData;
  busy: boolean;
  onAction: (id: string, action: ReceptionAction) => Promise<void>;
  preview: boolean;
  onBack: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [verified, setVerified] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [confirmDecline, setConfirmDecline] = useState(false);
  const patient = data.vertical === 'DOCTOR' ? 'patient' : 'client';
  const rosterHref = data.vertical === 'DOCTOR' ? '/app/patients' : '/app/clients';
  const matchingClients = data.clients.filter(
    (client) =>
      client.id === clientId ||
      `${client.name} ${client.id}`.toLowerCase().includes(clientSearch.trim().toLowerCase()),
  );
  const chosenClient = data.clients.find((client) => client.id === clientId);
  return (
    <section className={styles.detail} aria-labelledby="request-detail-heading">
      <button className={`${styles.quiet} ${styles.mobileBack}`} onClick={onBack}>
        ← Back to requests
      </button>
      <header className={styles.detailHeader}>
        <div>
          <h2 className={styles.detailHeading} id="request-detail-heading" tabIndex={-1}>
            {item.patientName}
          </h2>
          <p className={styles.hint}>{kindLabels[item.kind]}</p>
        </div>
        <span
          className={styles.status}
          data-status={item.status === 'NEW' ? 'PENDING' : item.status}
        >
          {statusLabels[item.status]}
        </span>
      </header>
      {item.desiredStartAt && (
        <div className={styles.appointmentStrip}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect
              x="3"
              y="5"
              width="18"
              height="16"
              rx="3"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M7 3v4m10-4v4M3 11h18"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <div>
            <span className={styles.label}>
              {item.status === 'BOOKED' ? 'Booked time' : 'Requested time'}
            </span>
            <strong>{receptionSlotLabel(item.desiredStartAt, data.settings.timezone)}</strong>
            <span className={styles.subtle}>
              {data.settings.timezone === 'Asia/Dubai'
                ? 'UAE time (UTC+4)'
                : 'India time (UTC+5:30)'}
            </span>
          </div>
        </div>
      )}
      <dl className={styles.facts}>
        <dt>Phone</dt>
        <dd>
          {preview ? (
            item.patientPhone
          ) : (
            <a className={styles.inlineLink} href={`tel:${item.patientPhone}`}>
              {item.patientPhone}
            </a>
          )}
        </dd>
        {item.patientEmail && (
          <>
            <dt>Email</dt>
            <dd>
              {preview ? (
                item.patientEmail
              ) : (
                <a className={styles.inlineLink} href={`mailto:${item.patientEmail}`}>
                  {item.patientEmail}
                </a>
              )}
            </dd>
          </>
        )}
        <dt>Received</dt>
        <dd>{receptionSlotLabel(item.createdAt, data.settings.timezone)}</dd>
      </dl>
      {item.message && <div className={styles.message}>{item.message}</div>}
      {item.status === 'NEW' && item.kind === 'BOOKING' && (
        <>
          <hr className={styles.divider} />
          <h3 className={styles.sectionTitle}>Confirm the right {patient}</h3>
          {!data.settings.enabled && (
            <p className={styles.banner}>
              Reception is paused. Enable it in Settings before approving a booking.
            </p>
          )}
          <p className={styles.sectionIntro}>
            Verify identity directly with this person, then choose their existing record. A matching
            phone number is not proof of identity.
          </p>
          <label className={styles.field}>
            <span className={styles.label}>Find a {patient} record</span>
            <input
              className={styles.input}
              value={clientSearch}
              placeholder="Search by name or record ID"
              disabled={busy}
              onChange={(event) => setClientSearch(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Select the existing {patient}</span>
            <select
              className={styles.select}
              value={clientId}
              disabled={busy}
              onChange={(event) => {
                setClientId(event.target.value);
                setVerified(false);
              }}
            >
              <option value="">Choose a verified {patient}</option>
              {matchingClients.map((client) => (
                <option value={client.id} key={client.id}>
                  {client.name} · {client.id.slice(-8)}
                </option>
              ))}
            </select>
          </label>
          {matchingClients.length === 0 && (
            <p className={styles.hint}>
              No matching record. Try another name or create the record first.
            </p>
          )}
          {chosenClient && (
            <p className={styles.selectedRecord}>
              Selected: <strong>{chosenClient.name}</strong>
              <span>Record {chosenClient.id}</span>
            </p>
          )}
          <p className={styles.hint}>
            New {patient}?{' '}
            {preview ? (
              'Create their record in the normal patient or client workflow first. This fixture cannot create records.'
            ) : (
              <>
                Create their record in{' '}
                <Link className={styles.inlineLink} href={rosterHref}>
                  {data.vertical === 'DOCTOR' ? 'Patients' : 'Clients'}
                </Link>{' '}
                first, then return and refresh.
              </>
            )}
          </p>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={verified}
              disabled={busy || !clientId}
              onChange={(event) => setVerified(event.target.checked)}
            />
            <span>
              I have verified this person’s identity and confirmed that the selected {patient}{' '}
              record is theirs.
            </span>
          </label>
          <div className={styles.decisionBar}>
            <button
              className={styles.button}
              disabled={busy || !clientId || !verified || !data.settings.enabled}
              onClick={() =>
                void onAction(item.id, {
                  action: 'APPROVE_BOOKING',
                  clientId,
                  identityVerified: true,
                })
              }
            >
              {busy ? 'Updating request…' : 'Approve booking'}
            </button>
            <button
              className={styles.danger}
              disabled={busy}
              onClick={() => setConfirmDecline(true)}
            >
              Decline request
            </button>
          </div>
          <p className={styles.hint}>
            {!clientId
              ? `Choose the ${patient} record to continue. `
              : !verified
                ? 'Confirm the identity check to enable booking. '
                : ''}
            Approval rechecks availability. You still need to contact the {patient}; no message is
            sent automatically.
          </p>
        </>
      )}
      {item.status === 'NEW' && item.kind !== 'BOOKING' && (
        <>
          <div className={styles.banner}>
            <strong>Follow up with this person</strong>
            <p>
              {item.kind === 'CANCEL'
                ? 'Their appointment has not been cancelled. Verify identity and handle the cancellation in your usual appointment workflow.'
                : item.kind === 'RESCHEDULE'
                  ? 'Their appointment has not been rescheduled. Verify identity and arrange a new time in your usual appointment workflow.'
                  : 'Reply using your usual contact method. This inbox does not send messages.'}
            </p>
          </div>
          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={busy}
              onClick={() => void onAction(item.id, { action: 'RESOLVE' })}
            >
              {busy ? 'Updating request…' : 'Mark enquiry resolved'}
            </button>
            <button
              className={styles.danger}
              disabled={busy}
              onClick={() => setConfirmDecline(true)}
            >
              Decline request
            </button>
          </div>
          <p className={styles.hint}>
            Marking an enquiry resolved only closes this request. It does not change an appointment
            or send a message.
          </p>
        </>
      )}
      {item.status !== 'NEW' && (
        <p className={styles.banner}>
          {item.status === 'BOOKED'
            ? 'This request was booked. Confirm the details with the person using your usual contact method.'
            : 'This request is closed. No message was sent automatically.'}
        </p>
      )}
      {confirmDecline && item.status === 'NEW' && (
        <div className={styles.banner} role="group" aria-label="Confirm decline">
          <strong>Decline this request?</strong>
          <p>This closes the enquiry without changing an appointment. No message will be sent.</p>
          <div className={styles.actions}>
            <button
              className={styles.danger}
              disabled={busy}
              onClick={() => void onAction(item.id, { action: 'DECLINE' })}
            >
              Yes, decline request
            </button>
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={() => setConfirmDecline(false)}
            >
              Keep for review
            </button>
          </div>
        </div>
      )}
      {item.events.length > 0 && (
        <details>
          <summary className={styles.subtle}>Request history</summary>
          <ul>
            {item.events.map((event) => (
              <li key={event.id} className={styles.hint}>
                {event.action.toLowerCase().replaceAll('_', ' ')} ·{' '}
                {receptionSlotLabel(event.createdAt, data.settings.timezone)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <hr className={styles.divider} />
      {confirmErase ? (
        <div className={styles.error}>
          <strong>Delete this enquiry?</strong>
          <p>
            This permanently removes this enquiry’s contact details, message and history. It keeps
            calendar appointments and the {patient} record. You cannot undo this.
          </p>
          <div className={styles.saveBar}>
            <button
              className={styles.danger}
              disabled={busy}
              onClick={() => void onAction(item.id, { action: 'ERASE', confirmErase: true })}
            >
              {busy ? 'Deleting enquiry…' : 'Yes, delete enquiry'}
            </button>
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={() => setConfirmErase(false)}
            >
              Keep enquiry
            </button>
          </div>
        </div>
      ) : (
        <button className={styles.quiet} disabled={busy} onClick={() => setConfirmErase(true)}>
          Delete enquiry
        </button>
      )}
    </section>
  );
}
