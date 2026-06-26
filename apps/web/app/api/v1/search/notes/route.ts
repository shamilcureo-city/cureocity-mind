import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requirePsychologistId } from '@/lib/auth-server';
import { decryptClientField } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/search/notes?q=... — Sprint 67.
 *
 * Cross-note search across the therapist's signed notes: "where did we
 * discuss her father?", "which sessions mention sleep?". Read-only,
 * tenant-scoped (only this psychologist's notes), returns a short snippet
 * around the match per session.
 *
 * V1 uses a case-insensitive scan over the note JSON cast to text. Fine
 * for a single therapist's caseload; a tsvector index is a later
 * optimisation if volumes grow.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [], query: q });
  }

  // Escape LIKE metacharacters in the user's query so `100%` or `a_b` match
  // literally instead of `%`/`_` acting as wildcards. Backslash is Postgres'
  // default ILIKE escape char; escape it first so the others stay literal.
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const like = `%${escaped}%`;
  const rows = await prisma.$queryRaw<
    {
      sessionId: string;
      clientId: string;
      scheduledAt: Date;
      kind: string;
      fullName: string;
      fullNameEncrypted: string | null;
      contentText: string;
    }[]
  >(Prisma.sql`
    SELECT s."id" AS "sessionId",
           s."clientId" AS "clientId",
           s."scheduledAt" AS "scheduledAt",
           s."kind"::text AS "kind",
           c."fullName" AS "fullName",
           c."fullNameEncrypted" AS "fullNameEncrypted",
           tn."content"::text AS "contentText"
    FROM "therapy_notes" tn
    JOIN "sessions" s ON s."id" = tn."sessionId"
    JOIN "clients" c ON c."id" = s."clientId"
    WHERE s."psychologistId" = ${auth.value.psychologistId}
      AND c."deletedAt" IS NULL
      AND tn."content"::text ILIKE ${like}
    ORDER BY s."scheduledAt" DESC
    LIMIT 30
  `);

  const results = await Promise.all(
    rows.map(async (r) => ({
      sessionId: r.sessionId,
      clientId: r.clientId,
      clientName: await decryptClientField(
        auth.value.psychologistId,
        r.fullNameEncrypted,
        r.fullName,
      ),
      scheduledAt: r.scheduledAt.toISOString(),
      kind: r.kind,
      snippet: snippet(r.contentText, q),
    })),
  );

  return NextResponse.json({ results, query: q });
}

/** A readable ~160-char excerpt centred on the first match. */
function snippet(contentText: string, q: string): string {
  // Strip JSON punctuation to prose-ish text so the excerpt reads cleanly.
  const text = contentText
    .replace(/[{}[\]"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text.slice(0, 160);
  const start = Math.max(0, idx - 70);
  const end = Math.min(text.length, idx + q.length + 90);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
