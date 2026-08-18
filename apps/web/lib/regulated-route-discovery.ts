export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ExportedRouteHandler {
  method: RouteMethod;
  source: string;
  start: number;
  end: number;
}

const EXPORTED_HANDLER = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
const REEXPORTED_HANDLER =
  /export\s*\{\s*(GET|POST|PUT|PATCH|DELETE)(?:\s+as\s+(GET|POST|PUT|PATCH|DELETE))?\s*\}\s*from\s*['"][^'"]+['"]\s*;?/g;
const REGULATED_MARKER =
  /therapyNote|noteDraft|medicalEncounterNote|clinicalReport|transcript|safetyPlan|treatmentWorkflow|modalityState|instrumentResponse|clinicalReading|medicationOrder|clinicalOrder|assessmentItem|clientDiagnosis|problemListItem|affectFeatures|preSessionBrief|decryptClientField|renderToBuffer|modelRouter|generateContent|persistVitalReadings|computeClientJourney|delegateSessionRoute|run(?:ClinicalAnalysis|Differential|NoteGeneration)/i;
const GUARD = /require(?:PsychologistId|Capability|AnyCapability)\s*\(/;
const PROTECTED_OPERATION =
  /prisma\.|parseJson\s*\(|parseQuery\s*\(|decryptClientField\s*\(|renderToBuffer\s*\(|modelRouter\s*\(|generateContent\s*\(|computeClientJourney\s*\(|(?:enqueue|schedule|queue)[A-Z\w]*\s*\(/i;

/** Extract each exported route handler as its own balanced function segment. */
export function exportedRouteHandlers(source: string): ExportedRouteHandler[] {
  const handlers: ExportedRouteHandler[] = [];
  for (const match of source.matchAll(EXPORTED_HANDLER)) {
    const method = match[1] as RouteMethod;
    const start = match.index ?? 0;
    const bodyStart = findFunctionBodyStart(source, start + match[0].length);
    if (bodyStart < 0) continue;
    const end = findBalancedBodyEnd(source, bodyStart);
    handlers.push({ method, source: source.slice(start, end), start, end });
  }
  for (const match of source.matchAll(REEXPORTED_HANDLER)) {
    const start = match.index ?? 0;
    handlers.push({
      method: (match[2] ?? match[1]) as RouteMethod,
      source: match[0],
      start,
      end: start + match[0].length,
    });
  }
  return handlers.sort((left, right) => left.start - right.start);
}

export function analyzeRegulatedRouteSource(source: string): {
  regulatedHandlers: ExportedRouteHandler[];
  unguardedMethods: RouteMethod[];
  guardOrderViolations: RouteMethod[];
} {
  const handlers = exportedRouteHandlers(source);
  const regulatedHandlers = handlers.filter(
    (handler) => REGULATED_MARKER.test(handler.source) || /^\s*export\s*\{/.test(handler.source),
  );
  const unguardedMethods: RouteMethod[] = [];
  const guardOrderViolations: RouteMethod[] = [];

  for (const handler of regulatedHandlers) {
    const guard = GUARD.exec(handler.source);
    const operation = PROTECTED_OPERATION.exec(handler.source);
    if (!guard) unguardedMethods.push(handler.method);
    if (operation && (!guard || guard.index > operation.index)) {
      guardOrderViolations.push(handler.method);
    }
  }
  return { regulatedHandlers, unguardedMethods, guardOrderViolations };
}

function findFunctionBodyStart(source: string, from: number): number {
  let parenDepth = 1;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth -= 1;
    else if (char === '{' && parenDepth === 0) return i;
  }
  return -1;
}

function findBalancedBodyEnd(source: string, bodyStart: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = bodyStart; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}
