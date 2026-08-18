import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ORBIT core architecture boundary', () => {
  it('does not depend on web frameworks, Prisma, or concrete infrastructure', () => {
    const root = __dirname;
    const productionFiles = readdirSync(root).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.test.ts'),
    );
    const forbidden = [
      'next/',
      'nextjs',
      '@prisma/client',
      'firebase',
      '@nestjs',
      '@vercel',
      '@/lib/',
    ];

    for (const file of productionFiles) {
      const source = readFileSync(join(root, file), 'utf8');
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
      for (const dependency of forbidden) {
        expect(
          imports.some((specifier) => specifier?.toLowerCase().includes(dependency)),
          `${file} imports forbidden dependency ${dependency}`,
        ).toBe(false);
      }
    }
  });
});
