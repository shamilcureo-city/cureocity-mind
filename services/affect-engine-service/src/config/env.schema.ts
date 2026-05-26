import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3004),
  DATABASE_URL: z.string().min(1),

  AUTH_BYPASS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

  // Affect baseline policy.
  AFFECT_BASELINE_MIN_SESSIONS: z.coerce.number().int().min(2).default(4),
  AFFECT_BASELINE_WINDOW_SESSIONS: z.coerce.number().int().min(2).default(10),
  AFFECT_DEVIATION_SIGMA: z.coerce.number().positive().default(1.5),
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
