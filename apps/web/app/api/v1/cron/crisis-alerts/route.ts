import { NextResponse, type NextRequest } from 'next/server';
import { processCrisisAlertOutbox } from '@/lib/crisis-alert-outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Separately invokable safety outbox drain; correctness never depends on check-in request lifetime. */
export async function GET(req: NextRequest) {
  const configured = process.env['CRON_SECRET'];
  const supplied = req.headers.get('authorization');
  if (!configured || supplied !== 'Bearer ' + configured) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await processCrisisAlertOutbox();
  return NextResponse.json(result, {
    status: result.failures.length > 0 ? 207 : 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
