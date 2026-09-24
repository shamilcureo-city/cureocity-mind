-- Scribe closeout: allow the doctor to correct every clinical section before
-- signing. Structured values are serialized as canonical JSON in the existing
-- NoteEdit text columns; the enum stays append-only.
ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'reviewOfSystems';
ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'physicalExam';
ALTER TYPE "NoteEditField" ADD VALUE IF NOT EXISTS 'vitals';
