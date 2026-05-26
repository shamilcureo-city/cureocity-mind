import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3002),
  DATABASE_URL: z.string().min(1),

  AUTH_BYPASS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

  // Object storage (MinIO in dev, GCS/S3 in prod). Audio chunks land here.
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default('cureocity'),
  S3_SECRET_KEY: z.string().default('cureocity-dev-secret'),
  S3_BUCKET_AUDIO: z.string().default('cureocity-mind-audio'),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // In-memory storage backend for tests (set to 'memory'); otherwise S3.
  STORAGE_BACKEND: z.enum(['s3', 'memory']).default('s3'),

  // Audio chunk policy.
  AUDIO_MAX_CHUNK_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 1024 * 1024),
  AUDIO_ACCEPTED_MIME: z.string().default('audio/pcm'),
  AUDIO_ACCEPTED_SAMPLE_RATE: z.coerce.number().int().positive().default(16000),

  // BullMQ note-generation queue (Sprint 2 PR 4).
  REDIS_URL: z.string().default('redis://localhost:6379'),
  NOTE_QUEUE_NAME: z.string().default('note-generation'),
  NOTE_QUEUE_BACKEND: z.enum(['bullmq', 'sync']).default('bullmq'),

  // Vertex Gemini. Unset => MockGeminiBackend (dev/tests).
  GCP_PROJECT_ID: z.string().optional(),
  GCP_SA_KEY_PATH: z.string().optional(),
  GEMINI_FLASH_REGION: z.string().default('asia-south1'),
  GEMINI_PRO_REGION: z.string().default('us-central1'),
  GEMINI_FLASH_MODEL: z.string().default('gemini-1.5-flash-002'),
  GEMINI_PRO_MODEL: z.string().default('gemini-1.5-pro-002'),

  // Cost circuit breaker (Sprint 2 PR 5, gap G6).
  COST_CAP_PER_SESSION_INR: z.coerce.number().positive().default(500),
  COST_CAP_PER_THERAPIST_MONTHLY_INR: z.coerce.number().positive().default(15_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(config);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    throw new Error(`Invalid environment variables:\n${JSON.stringify(flat.fieldErrors, null, 2)}`);
  }
  return parsed.data;
}
