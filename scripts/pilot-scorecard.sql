-- Pilot scorecard — the Friday numbers pull (docs/PILOT_PLAYBOOK.md §5).
--
-- Paste into the Neon SQL editor on the MAIN branch and run ONE SECTION AT
-- A TIME. Everything here is read-only. Each weekly section has a `params`
-- CTE at the top — edit `week_start` to Monday 00:00 IST of the week you
-- are scoring, then run it.
--
-- Demo clients (Client.isDemo) are excluded everywhere so the auto-seeded
-- practice client never inflates a metric.

-- ---------------------------------------------------------------------------
-- Section 0 — cohort sanity (run any time; no week window)
-- One row per therapist: onboarded? passkey registered? (playbook §4 items
-- 1–2). `has_passkey` must be true for all 5 before you flip
-- REQUIRE_WEBAUTHN_SIGNING=true.
-- ---------------------------------------------------------------------------
SELECT
  p."fullName"                                 AS therapist,
  p.email,
  p."createdAt"::date                          AS joined,
  (p."onboardingCompletedAt" IS NOT NULL)      AS onboarded,
  EXISTS (
    SELECT 1 FROM webauthn_credentials w
    WHERE w."psychologistId" = p.id AND w."revokedAt" IS NULL
  )                                            AS has_passkey
FROM psychologists p
WHERE p."deletedAt" IS NULL
  AND p.vertical = 'THERAPIST'
ORDER BY p."createdAt";

-- ---------------------------------------------------------------------------
-- Section 1 — weekly per-therapist rollup (criteria 1, 2, 3 + capture split)
-- completed_sessions ≥ 1  → "active" (criterion 1)
-- signed_notes            → criterion 2 (target ≥ 3/wk in weeks 3–4)
-- median_min_to_sign      → criterion 3 (target ≤ 10)
-- live_sessions           → the live-vs-record-only share (§3 last bullet)
-- ---------------------------------------------------------------------------
WITH params AS (
  SELECT timestamptz '2026-07-13 00:00:00+05:30'                     AS week_start,
         timestamptz '2026-07-13 00:00:00+05:30' + interval '7 days' AS week_end
),
week_sessions AS (
  SELECT s.id, s."psychologistId", s."captureMode"
  FROM sessions s
  JOIN clients c ON c.id = s."clientId" AND c."isDemo" = false
  CROSS JOIN params
  WHERE s.status = 'COMPLETED'
    AND s."endedAt" >= params.week_start
    AND s."endedAt" <  params.week_end
),
week_signed AS (
  SELECT tn.id, s."psychologistId",
         extract(epoch FROM tn."signedAt" - s."endedAt") / 60.0 AS min_to_sign
  FROM therapy_notes tn
  JOIN sessions s ON s.id = tn."sessionId"
  JOIN clients c ON c.id = s."clientId" AND c."isDemo" = false
  CROSS JOIN params
  WHERE tn."signedAt" >= params.week_start
    AND tn."signedAt" <  params.week_end
)
SELECT
  p."fullName"                                                    AS therapist,
  count(DISTINCT ws.id)                                           AS completed_sessions,
  count(DISTINCT ws.id) FILTER (WHERE ws."captureMode" = 'LIVE')  AS live_sessions,
  (SELECT count(*) FROM week_signed x
    WHERE x."psychologistId" = p.id)                              AS signed_notes,
  round((
    SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY x.min_to_sign))::numeric
    FROM week_signed x
    WHERE x."psychologistId" = p.id AND x.min_to_sign IS NOT NULL
  ), 1)                                                           AS median_min_to_sign
FROM psychologists p
LEFT JOIN week_sessions ws ON ws."psychologistId" = p.id
WHERE p."deletedAt" IS NULL
  AND p.vertical = 'THERAPIST'
  AND p."onboardingCompletedAt" IS NOT NULL
GROUP BY p.id, p."fullName"
ORDER BY completed_sessions DESC;

-- ---------------------------------------------------------------------------
-- Section 2 — live-copilot suggestion rates (criterion 6)
-- Target: acted ≥ 20% of shown, dismissed < 60%.
-- ---------------------------------------------------------------------------
WITH params AS (
  SELECT timestamptz '2026-07-13 00:00:00+05:30'                     AS week_start,
         timestamptz '2026-07-13 00:00:00+05:30' + interval '7 days' AS week_end
)
SELECT
  p."fullName"                                                        AS therapist,
  count(*) FILTER (WHERE a.action = 'LIVE_SUGGESTION_SHOWN')          AS shown,
  count(*) FILTER (WHERE a.action = 'LIVE_SUGGESTION_ACTED')          AS acted,
  count(*) FILTER (WHERE a.action = 'LIVE_SUGGESTION_DISMISSED')      AS dismissed,
  round(100.0 * count(*) FILTER (WHERE a.action = 'LIVE_SUGGESTION_ACTED')
      / nullif(count(*) FILTER (WHERE a.action = 'LIVE_SUGGESTION_SHOWN'), 0), 1)
                                                                      AS acted_pct
FROM audit_logs a
JOIN psychologists p ON p.id = a."actorPsychologistId"
CROSS JOIN params
WHERE a.action IN
      ('LIVE_SUGGESTION_SHOWN', 'LIVE_SUGGESTION_ACTED', 'LIVE_SUGGESTION_DISMISSED')
  AND a."createdAt" >= params.week_start
  AND a."createdAt" <  params.week_end
GROUP BY p.id, p."fullName"
ORDER BY shown DESC;

-- ---------------------------------------------------------------------------
-- Section 3 — baseline instrument coverage (criterion 4; point-in-time)
-- Of clients with ≥2 completed sessions, the share with ≥1 PHQ-9/GAD-7
-- response. Target ≥ 60%.
-- ---------------------------------------------------------------------------
WITH eligible AS (
  SELECT c.id AS client_id, c."psychologistId"
  FROM clients c
  JOIN sessions s ON s."clientId" = c.id AND s.status = 'COMPLETED'
  WHERE c."deletedAt" IS NULL AND c."isDemo" = false
  GROUP BY c.id, c."psychologistId"
  HAVING count(s.id) >= 2
)
SELECT
  p."fullName"                                       AS therapist,
  count(*)                                           AS clients_2plus_sessions,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM instrument_responses ir WHERE ir."clientId" = e.client_id
  ))                                                 AS with_baseline,
  round(100.0 * count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM instrument_responses ir WHERE ir."clientId" = e.client_id
  )) / nullif(count(*), 0), 0)                       AS baseline_pct
FROM eligible e
JOIN psychologists p ON p.id = e."psychologistId"
GROUP BY p.id, p."fullName"
ORDER BY baseline_pct DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- Section 4 — re-measure coverage (criterion 5; point-in-time)
-- Of clients whose FIRST instrument response is ≥14 days old (the Journey
-- card's measure-due cadence), the share with a second response. Target
-- ≥ 50%. Approximation: any later response counts as re-measured.
-- ---------------------------------------------------------------------------
WITH firsts AS (
  SELECT ir."clientId",
         min(ir."administeredAt") AS first_at,
         count(*)                 AS n_responses
  FROM instrument_responses ir
  JOIN clients c ON c.id = ir."clientId"
    AND c."isDemo" = false AND c."deletedAt" IS NULL
  GROUP BY ir."clientId"
),
due AS (
  SELECT f.*, c."psychologistId"
  FROM firsts f
  JOIN clients c ON c.id = f."clientId"
  WHERE f.first_at < now() - interval '14 days'
)
SELECT
  p."fullName"                                       AS therapist,
  count(*)                                           AS clients_due_remeasure,
  count(*) FILTER (WHERE d.n_responses >= 2)         AS remeasured,
  round(100.0 * count(*) FILTER (WHERE d.n_responses >= 2)
      / nullif(count(*), 0), 0)                      AS remeasure_pct
FROM due d
JOIN psychologists p ON p.id = d."psychologistId"
GROUP BY p.id, p."fullName"
ORDER BY remeasure_pct DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- Section 5a — ops guardrail: audio-purge proof (playbook §7)
-- Week 0 must show at least one row here; afterwards expect one per day.
-- ---------------------------------------------------------------------------
SELECT "createdAt", metadata
FROM audit_logs
WHERE action = 'AUDIO_RETENTION_PURGED'
ORDER BY "createdAt" DESC
LIMIT 5;

-- ---------------------------------------------------------------------------
-- Section 5b — ops guardrail: Gemini spend by therapist this week (₹)
-- Watch for outliers against the per-session ₹500 / monthly ₹15,000 caps.
-- ---------------------------------------------------------------------------
WITH params AS (
  SELECT timestamptz '2026-07-13 00:00:00+05:30'                     AS week_start,
         timestamptz '2026-07-13 00:00:00+05:30' + interval '7 days' AS week_end
)
SELECT
  coalesce(p."fullName", '(unattributed)')            AS who,
  round(sum(g."costInr")::numeric, 0)                 AS inr,
  count(*)                                            AS calls,
  count(*) FILTER (WHERE g.status <> 'SUCCESS')       AS failed_calls
FROM gemini_call_logs g
LEFT JOIN psychologists p ON p.id = g."psychologistId"
CROSS JOIN params
WHERE g."createdAt" >= params.week_start
  AND g."createdAt" <  params.week_end
GROUP BY p.id, p."fullName"
ORDER BY inr DESC;
