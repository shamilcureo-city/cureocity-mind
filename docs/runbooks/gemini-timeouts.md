# Gemini call timeouts

**Severity:** ticket. **SLA:** next business day.

## What this means

Gemini call timeouts (`status=TIMEOUT` / transient `ERROR` rows in
`gemini_call_logs`) are elevated. Each failure blocks a NoteDraft from
progressing. Both batch backends retry once on transient errors with
their own per-attempt timeout (Pass 1 Flash: 50 s; Pass 2 Pro: 120 s —
`packages/llm/src/backends/vertex-flash-india.backend.ts` /
`vertex-pro-global.backend.ts`), so a sustained rate means Vertex
itself is degraded, and drafts are stalling across sessions.

Anything the retries didn't save is picked up by the reclaim cron
(`/api/v1/cron/reclaim-stuck`): drafts stranded IN_PROGRESS flip to
FAILED so the therapist sees a re-run button instead of a spinner.

## Diagnosis

1. Identify the failing pass in `gemini_call_logs`:

   ```
   SELECT pass, status, COUNT(*), AVG("latencyMs")
   FROM gemini_call_logs
   WHERE "createdAt" > NOW() - interval '1 hour'
   GROUP BY pass, status ORDER BY pass;
   ```

   - `PASS_1_TRANSCRIBE_AND_ANALYSE` → Flash in asia-south1.
   - `PASS_2_NOTE_GENERATION` → Pro (global endpoint).

2. Check Vertex regional health: the GCP status dashboard, and the
   chosen region's outage history.
3. If Pass 2 only, the global Pro endpoint is the likely cause — it is
   deliberately isolated from Pass 1 for exactly this reason.

## Mitigation

There is no long-lived process to restart — every batch pass runs
inside a Vercel serverless invocation, and env-var changes take effect
on the next **redeploy**.

### Pass 1 (Flash, asia-south1)

1. If asia-south1 is degraded, DPDP residency blocks a casual region
   swap for AUDIO — prefer waiting out the incident. Notes already
   transcribed keep flowing (Pass 2 doesn't need Pass 1's region).

### Pass 2 (Pro, global)

1. The per-attempt timeout and retry count are constructor options on
   the backend (`timeoutMs`, `maxAttempts` — AUD2); raising them is a
   one-line change in `apps/web/lib/llm.ts` + redeploy.
2. If timeouts persist > 1 hour, file a Vertex AI support ticket. New
   generations fail fast with a visible retry affordance — there is no
   queue to pile up.

### Live consults (gateway)

The live gateway (Cloud Run) runs the same backends; check
`https://gateway.cureo.city/healthz` and the Cloud Run logs. Consults
degrade gracefully — the browser falls back to record-only capture.

## Verification

- Timeout rate in `gemini_call_logs` drops back to baseline.
- No NoteDraft rows stuck IN_PROGRESS older than the reclaim window:
  ```
  SELECT COUNT(*) FROM note_drafts
  WHERE status = 'IN_PROGRESS' AND "updatedAt" < NOW() - interval '30 min';
  ```

## Related

- `packages/llm/src/model-router.ts`
- `packages/llm/src/backends/vertex-flash-india.backend.ts`
- `packages/llm/src/backends/vertex-pro-global.backend.ts`
- `apps/web/app/api/v1/cron/reclaim-stuck/route.ts`
