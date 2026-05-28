# Gemini call timeouts

**Severity:** ticket. **SLA:** next business day.

## What this means

Gemini call timeouts (`status=TIMEOUT`) have exceeded 0.05 calls/second
over a 10-minute window. Each timeout blocks a NoteDraft from
progressing; the BullMQ worker retries up to 3× with exponential
backoff, so a sustained timeout rate means therapy notes are stalling
across multiple sessions.

## Diagnosis

1. Identify the failing pass:
   - `metric{pass="PASS_1_TRANSCRIBE_AND_ANALYSE"}` → Pass 1 = Flash
     in asia-south1.
   - `metric{pass="PASS_2_NOTE_GENERATION"}` → Pass 2 = Pro (global).
2. Check Vertex regional health:
   - GCP status dashboard
   - the chosen region's outage history
3. If Pass 2 only, the global Pro endpoint is most likely the cause —
   the Sprint 2 architecture isolates Pass 2 specifically because
   Pro is the less-resilient of the two.

## Mitigation

### Pass 1 (Flash, asia-south1)

1. Edit `packages/llm/src/backends/vertex-flash.ts` to swap to
   `asia-southeast1` temporarily (set `VERTEX_FLASH_REGION` env var).
2. Restart `scribe-service` so the new region takes effect:
   `pnpm -F scribe-service start:dev` or `kubectl rollout restart`.

### Pass 2 (Pro, global)

1. Pass 2 has no built-in regional failover in V1; the only knob is
   to lengthen the timeout from 30s to 60s. Restarts not required —
   the router reads env at call time.
2. If timeouts persist > 1 hour with the longer timeout, file a
   Vertex AI support ticket and pause new note generation by
   setting `NOTE_QUEUE_BACKEND=sync` on `scribe-service` (this makes
   the queue refuse new jobs gracefully rather than piling them up).

## Verification

- Timeout rate drops below the alert threshold.
- BullMQ depth drains; `redis-cli LLEN bull:note-generation:wait`
  returns to 0.

## Related

- `packages/llm/src/model-router.ts`
- `packages/llm/src/backends/vertex-flash.ts`
- `packages/llm/src/backends/vertex-pro.ts`
