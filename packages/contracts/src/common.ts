import { z } from 'zod';

export const CuidSchema = z
  .string()
  .regex(/^c[a-z0-9]{24}$/, 'must be a cuid (c + 24 alphanumerics)');

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const IndianPhoneSchema = z
  .string()
  .regex(/^\+91\d{10}$/, 'must be +91 followed by exactly 10 digits');

export const ScriptVersionSchema = z
  .string()
  .regex(/^v\d+\.\d+$/, 'must be v<major>.<minor> (e.g. v1.0)');

export const PaginationCursorSchema = CuidSchema.optional();
