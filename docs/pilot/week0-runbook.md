# Week 0 — per-therapist onboarding run-of-show

Companion to `docs/PILOT_PLAYBOOK.md` §4. One sitting per therapist,
~45 minutes, in person or on a video call where they share their screen.
The goal is simple: **they see the whole loop once — record → note →
sign → share — before any real client is in the room.**

Do these in order. Don't skip the dry run; it is the whole point.

## Before the call (founder, 5 min)

- [ ] Confirm their device: recent Chrome or Safari, working mic,
      Touch ID / fingerprint / screen-lock available (passkeys need it).
- [ ] Send them the app URL and tell them to have their Google account
      password handy (sign-in is Google only).
- [ ] Add them to the pilot WhatsApp group.
- [ ] Verify prod is healthy: sign in yourself, record nothing, just see
      Today load.

## The sitting (per therapist)

### 1. Sign in + onboarding (5 min)

1. They open the app → **Continue with Google**.
2. Onboarding: full name, RCI number, phone, languages. Vertical =
   therapist (the default).
3. Landing on **Today** with the auto-seeded practice client visible =
   done.

### 2. Passkey (3 min) — do this NOW, not "later"

1. **Settings → Security → Register a device.**
2. They approve with Touch ID / fingerprint / device PIN.
3. Confirm the credential appears under "Registered credentials".

Signing works without a passkey until `REQUIRE_WEBAUTHN_SIGNING` is
flipped on (after all 5 are enrolled) — but enrolling in week 0 means the
flip is a non-event.

### 3. First three real clients (10 min)

They create their 3 most-active clients themselves (don't do it for
them — this is the muscle memory):

- **`spokenLanguages` set to the real mix** (`ml + en`, `hi + en`, …).
  This drives transcription quality more than anything else in the
  product. "What do they actually speak in the room?" — not what forms
  say.
- `preferredLanguage` = what the client should receive WhatsApp
  content in.
- Consent captured per client (the create form walks through it).

### 4. The dry run (15 min) — the heart of week 0

Role-play a 10-minute session against the **practice client**:

1. Today → the practice client → start the session (their chosen capture
   mode — see step 6).
2. Founder plays the client for ~8–10 minutes. Use their real language
   mix, mention a low mood, mention sleep — give the note something to
   find.
3. End the session. Watch the note generate together.
4. Review the note + clinical brief. Point out: **the AI suggests, they
   confirm.** Nothing enters the record until they accept it.
5. **Sign** — the passkey prompt appears; this is why step 2 came first.
6. **Share to their OWN WhatsApp number** — they see exactly what a
   client would receive, on their own phone.

If anything in this loop fails, stop the onboarding and fix it — a
broken loop discovered by a real client costs the pilot.

### 5. The consent script (5 min)

They explain to you, in one breath, in the language they'd use in the
room: the session is recorded, an AI helps draft the note, the therapist
reviews and signs everything, the client can say no, and recordings are
deleted automatically after processing. Rehearse until it's theirs, not
a script.

### 6. Default capture mode (2 min)

- **Live** — transcript + copilot while they talk; needs a solid
  network in the room.
- **Record-only** — the recorder runs, everything generates at the end;
  survives bad networks.

Let them choose; set it in preferences. Tell them switching per-session
is one tap, and record-only is the safe fallback whenever the room's
network is suspect.

### 7. The measurement habit (3 min)

Show the client page's measure panel: administering a PHQ-9/GAD-7 is
in-session, takes ~2 minutes, and the Journey page turns it into a
progress verdict. Ask them to baseline each active client during their
first real session — criterion 4 of the pilot lives or dies here.

## Exit checklist (all boxes, per therapist)

- [ ] Signed in; onboarding complete
- [ ] Passkey registered (verify in scorecard Section 0 — `has_passkey`)
- [ ] 3 real clients with correct `spokenLanguages`
- [ ] Dry run completed end-to-end (record → note → sign → share)
- [ ] Consent explanation rehearsed
- [ ] Default capture mode chosen
- [ ] In the WhatsApp group

## After all five are through

1. Run scorecard **Section 0** (`scripts/pilot-scorecard.sql`) — every
   row `onboarded = true`, `has_passkey = true`.
2. Flip **`REQUIRE_WEBAUTHN_SIGNING=true`** on Vercel (production env) —
   from this point signing requires the passkey.
3. Run scorecard **Section 5a** — at least one `AUDIO_RETENTION_PURGED`
   row proves the retention cron is live (playbook §7).
4. Post the week-1 kickoff message in the group: what to do (just run
   real sessions), how to report problems (the group, same-day reply),
   when the first Friday check-in is.
