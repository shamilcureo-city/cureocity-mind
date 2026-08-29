import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { canonicalPractitionerProduct, productFromHost } from './product';

const webRoot = join(import.meta.dirname, '..');
const repoRoot = join(webRoot, '..', '..');
const appRoot = join(webRoot, 'app', 'app');
const readWeb = (path: string) => readFileSync(join(webRoot, path), 'utf8');
const readRepo = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

function currentAppPageRoutes(directory = appRoot): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) routes.push(...currentAppPageRoutes(absolute));
    if (entry.isFile() && entry.name === 'page.tsx') {
      const routeDirectory = relative(appRoot, dirname(absolute));
      routes.push(routeDirectory ? `/app/${routeDirectory.split(sep).join('/')}` : '/app');
    }
  }
  return routes.sort();
}

function parsedWeb(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readWeb(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function hasCall(source: ts.SourceFile, functionName: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === functionName) found = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function hasJsxTag(source: ts.SourceFile, tag: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === tag) ||
      (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === tag)
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function hasPropertyAssignment(source: ts.SourceFile, property: string, value: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === property &&
      node.initializer.getText(source) === value
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('Mind and Scribe practitioner journey boundary', () => {
  it('maps each canonical host to its actual practitioner product', () => {
    expect(productFromHost('mind.cureocity.in')).toMatchObject({
      key: 'mind',
      vertical: 'THERAPIST',
    });
    expect(productFromHost('scribe.cureocity.in')).toMatchObject({
      key: 'scribe',
      vertical: 'DOCTOR',
    });
    expect(canonicalPractitionerProduct('THERAPIST').host).toBe('mind.cureocity.in');
    expect(canonicalPractitionerProduct('DOCTOR').host).toBe('scribe.cureocity.in');
  });

  it('keeps the doctor clinic and encounter pages behind the doctor guard', () => {
    const doctorPages = [
      'app/app/clinic/page.tsx',
      'app/app/patients/page.tsx',
      'app/app/patients/[id]/encounters/[sessionId]/page.tsx',
      'app/app/patients/[id]/encounters/[sessionId]/live/page.tsx',
    ];

    for (const path of doctorPages) expect(hasCall(parsedWeb(path), 'requireOnboardedDoctor')).toBe(true);
    expect(hasJsxTag(parsedWeb(doctorPages[2]!), 'DoctorEncounterPanel')).toBe(true);
    expect(hasJsxTag(parsedWeb(doctorPages[3]!), 'LiveEncounterFlow')).toBe(true);
  });

  it('preserves doctor Review & Sign and prescription integration in both capture paths', () => {
    const batch = parsedWeb('components/app/DoctorEncounterPanel.tsx');
    const live = parsedWeb('components/app/DoctorLiveEncounter.tsx');
    const review = parsedWeb('components/app/ReviewAndSign.tsx');

    expect(hasJsxTag(batch, 'ReviewAndSign')).toBe(true);
    expect(hasJsxTag(live, 'ReviewAndSign')).toBe(true);
    expect(hasJsxTag(live, 'RxPadPanel')).toBe(true);
    expect(hasJsxTag(review, 'PlanComposer')).toBe(true);
    expect(hasPropertyAssignment(review, 'rxPad', 'signedRxPad')).toBe(true);
    expect(review.getText()).toContain('Prescription PDF');
  });

  it('keeps the therapy capture entry from becoming the doctor home', () => {
    const record = parsedWeb('app/app/page.tsx');

    expect(hasCall(record, 'redirect')).toBe(true);
    expect(hasJsxTag(record, 'RecordingShell')).toBe(true);
    expect(record.getText()).toContain("therapist.vertical === 'DOCTOR'");
    expect(record.getText()).toContain("redirect('/app/clinic')");
  });

  it('keeps the documented route inventory exactly synchronized with page files', () => {
    const matrix = readRepo('docs/MIND_SCRIBE_ROUTE_MATRIX.md');
    const inventory = matrix
      .split('## Complete authenticated page inventory')[1]
      ?.split('## Visible vocabulary')[0];
    expect(inventory).toBeDefined();

    const documented = [...(inventory ?? '').matchAll(/^\| `([^`]+)` \|/gm)]
      .map((match) => match[1]!)
      .sort();
    expect(documented).toEqual(currentAppPageRoutes());
  });

  it('documents shared-file review and distinct completion vocabulary', () => {
    const matrix = readRepo('docs/MIND_SCRIBE_ROUTE_MATRIX.md');

    expect(matrix).toContain('## Shared-file change rules');
    expect(matrix).toContain('## Pull-request acceptance gate');
    expect(matrix).toContain('Review & Close');
    expect(matrix).toContain('Review & Sign');
  });
});
