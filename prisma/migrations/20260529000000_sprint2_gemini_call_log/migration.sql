-- CreateEnum
CREATE TYPE "GeminiPass" AS ENUM ('PASS_1_TRANSCRIBE_AND_ANALYSE', 'PASS_2_NOTE_GENERATION', 'PASS_3_MISSED_THEMES');

-- CreateEnum
CREATE TYPE "GeminiCallStatus" AS ENUM ('SUCCESS', 'ERROR', 'TIMEOUT', 'CIRCUIT_OPEN');

-- CreateTable
CREATE TABLE "gemini_call_logs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "pass" "GeminiPass" NOT NULL,
    "model" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costInr" DECIMAL(10,4) NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "status" "GeminiCallStatus" NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gemini_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gemini_call_logs_sessionId_createdAt_idx" ON "gemini_call_logs"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "gemini_call_logs_createdAt_idx" ON "gemini_call_logs"("createdAt");

-- CreateIndex
CREATE INDEX "gemini_call_logs_status_createdAt_idx" ON "gemini_call_logs"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "gemini_call_logs" ADD CONSTRAINT "gemini_call_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

