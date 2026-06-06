-- Sprint 16 — Multilingual / code-mix awareness.
--
-- Adds two array columns for dynamic language handling:
--   * Session.spokenLanguages — ISO 639-1 codes detected by Pass 1
--     in the actual audio, sorted by prevalence. Real Indian sessions
--     are usually code-mixed (Manglish, Hinglish, Tanglish) so this
--     is multi-value rather than a single column.
--   * Client.spokenLanguages — optional therapist-provided hint of
--     the client's typical spoken languages, used by Pass 1 as a
--     transcription bias and by Pass 4 to choose the verbatim
--     "therapistSays" language.
--
-- The existing Session.language column (Sprint 13) is now treated
-- as the OUTPUT (therapist-facing narrative) language; this is a
-- semantic split, not a rename.

ALTER TABLE "sessions"
    ADD COLUMN "spokenLanguages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "clients"
    ADD COLUMN "spokenLanguages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
