import { NextResponse } from 'next/server';
import { INSTRUMENTS } from '@cureocity/clinical';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/instruments
 *
 * Returns the curated catalogue of supported instruments (PHQ-9, GAD-7
 * in V1). The UI hits this once to populate the picker + render items
 * and severity bands without hardcoding them client-side.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    items: Object.values(INSTRUMENTS).map((def) => ({
      key: def.key,
      title: def.title,
      description: def.description,
      recallWindow: def.recallWindow,
      items: def.items,
      scale: def.scale,
      severityBands: def.severityBands,
      riskItemNumber: def.riskItemNumber ?? null,
    })),
  });
}
