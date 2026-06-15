import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { planLabel } from '@cureocity/contracts';
import { InvoicePdf } from '@/components/pdf/InvoicePdf';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { gstBreakdown, invoiceNumber, sellerIdentity } from '@/lib/invoice';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/billing/payments/[id]/invoice — Sprint 56 (Lever 4 #3).
 *
 * Render a GST tax invoice PDF for a PAID payment and stream it. Indian
 * therapists (and clinics) need a GSTIN invoice for their books, not a
 * bare payment line — an adoption blocker at Pro/Premium prices.
 *
 * 404 unless the payment exists, belongs to the caller, and is PAID
 * (CREATED/FAILED orders are not invoiceable).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const payment = await prisma.billingPayment.findUnique({ where: { id } });
  if (!payment || payment.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }
  if (payment.status !== 'PAID') {
    return NextResponse.json(
      { error: 'Only paid payments have an invoice.' },
      { status: 404 },
    );
  }

  const psychologist = await prisma.psychologist.findUnique({
    where: { id: auth.value.psychologistId },
    select: { fullName: true, email: true },
  });
  if (!psychologist) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const gst = gstBreakdown(payment.amountInr);
  const number = invoiceNumber(payment.id, payment.createdAt);
  const doc = InvoicePdf({
    invoiceNumber: number,
    invoiceDate: payment.createdAt.toISOString().slice(0, 10),
    paymentRef: payment.razorpayPaymentId ?? payment.razorpayOrderId,
    seller: sellerIdentity(),
    buyer: { name: psychologist.fullName, email: psychologist.email },
    lineDescription: `Cureocity Mind — ${planLabel(payment.plan)} subscription`,
    gst,
  });
  const buffer = await renderToBuffer(doc);

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'INVOICE_DOWNLOADED',
    targetType: 'BillingPayment',
    targetId: payment.id,
    metadata: {
      ...auditMetadataFromRequest(req),
      invoiceNumber: number,
      amountInr: payment.amountInr,
      baseInr: gst.baseInr,
      igstInr: gst.igstInr,
      plan: payment.plan,
    },
  });

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cureocity-invoice-${number.replace(/\//g, '-')}.pdf"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
    },
  });
}
