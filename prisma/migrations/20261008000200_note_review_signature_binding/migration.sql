ALTER TABLE "note_reviews"
  ADD COLUMN IF NOT EXISTS "reviewedSignatureHash" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedSignedAt" TIMESTAMP(3);

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'note_reviews_signature_binding_pair') THEN
ALTER TABLE "note_reviews" ADD CONSTRAINT "note_reviews_signature_binding_pair"
  CHECK (("reviewedSignatureHash" IS NULL AND "reviewedSignedAt" IS NULL)
    OR ("reviewedSignatureHash" IS NOT NULL AND "reviewedSignatureHash" ~ '^[0-9a-f]{64}$' AND "reviewedSignedAt" IS NOT NULL));
END IF;
END $$;
