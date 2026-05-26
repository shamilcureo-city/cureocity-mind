-- CreateTable
CREATE TABLE "audio_chunks" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sampleRate" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audio_chunks_sessionId_uploadedAt_idx" ON "audio_chunks"("sessionId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "audio_chunks_sessionId_chunkIndex_key" ON "audio_chunks"("sessionId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "audio_chunks" ADD CONSTRAINT "audio_chunks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

