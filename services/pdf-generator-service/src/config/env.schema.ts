import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3006),
  DATABASE_URL: z.string().min(1),

  AUTH_BYPASS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

  // 'fake' uses FakePdfRenderer (returns HTML bytes). Anything else uses Puppeteer.
  PDF_RENDERER_BACKEND: z.enum(['puppeteer', 'fake']).default('puppeteer'),

  // Storage — used to host treatment-plan PDFs that WATI links into a
  // WhatsApp template. 'in-memory' is the test-only choice.
  STORAGE_BACKEND: z.enum(['s3', 'in-memory']).default('in-memory'),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET_PDFS: z.string().default('cureocity-mind-pdfs'),

  // WATI — WhatsApp delivery. 'noop' is the safe default until WATI
  // credentials are procured (per the plan's open question).
  MESSAGING_BACKEND: z.enum(['wati', 'noop']).default('noop'),
  WATI_API_BASE: z.string().url().optional(),
  WATI_BEARER_TOKEN: z.string().optional(),
  WATI_TEMPLATE_TREATMENT_PLAN: z.string().default('treatment_plan'),
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
