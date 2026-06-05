-- Sprint 11: NoteTemplate model — therapist-owned customizable note structures.
-- Each template owns an ordered list of sections (stored as JSON so the
-- shape can evolve without further migrations). Exactly one isDefault=true
-- per psychologist is enforced at the app layer.

CREATE TABLE "note_templates" (
    "id" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "note_templates_psychologistId_updatedAt_idx"
    ON "note_templates"("psychologistId", "updatedAt");

ALTER TABLE "note_templates"
    ADD CONSTRAINT "note_templates_psychologistId_fkey"
    FOREIGN KEY ("psychologistId") REFERENCES "psychologists"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add the three new AuditAction enum values used by template CRUD audits.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TEMPLATE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TEMPLATE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TEMPLATE_DELETED';
