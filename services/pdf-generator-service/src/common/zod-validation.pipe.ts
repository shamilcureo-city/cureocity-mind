import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

interface ZodErrorLike {
  name: 'ZodError';
  flatten(): { formErrors: string[]; fieldErrors: Record<string, string[] | undefined> };
}

function isZodError(e: unknown): e is ZodErrorLike {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name === 'ZodError' &&
    typeof (e as { flatten?: unknown }).flatten === 'function'
  );
}

@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  /**
   * Duck-typed instead of `instanceof ZodError` because zod ships its own
   * symbol-based check that breaks across pnpm-deduped copies (the
   * @cureocity/contracts package and this service may each carry their
   * own zod instance even when the version is identical).
   */
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    try {
      return this.schema.parse(value);
    } catch (e) {
      if (isZodError(e)) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: e.flatten(),
        });
      }
      throw e;
    }
  }
}
