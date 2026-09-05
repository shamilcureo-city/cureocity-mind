import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8');

describe('Therapy Library assignment boundary', () => {
  it('shares catalog scripts without silently creating homework and leaves assignment to the explicit workflow', () => {
    const library = read('components/app/TherapyLibrary.tsx');
    const workflow = read('components/app/WorkflowSection.tsx');

    expect(library).toContain('Review client sharing');
    expect(library).not.toContain('assignHomework: true');
    expect(workflow).toContain('Assign homework');
    for (const field of ['homeworkTask', 'homeworkFrequency', 'homeworkDueAt', 'homeworkNote']) {
      expect(workflow).toContain(field);
    }
    expect(workflow).toContain("artefactType: 'HOMEWORK'");
  });
});
