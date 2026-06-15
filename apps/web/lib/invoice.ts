/**
 * Sprint 56 (Lever 4 #3) — GST invoice helpers.
 *
 * Prices charged are GST-inclusive (the therapist pays the catalog
 * price). India SaaS GST is 18%. We back-compute the taxable value and
 * show IGST 18% (the common inter-state digital-supply case for a
 * pan-India product). Seller identity comes from env so the same code
 * ships before + after GST registration.
 */
export const GST_RATE = 0.18;
export const SAC_CODE = '998314'; // IT design & development services

export interface GstBreakdown {
  /** Taxable value (base, ex-GST), rounded to whole rupees. */
  baseInr: number;
  /** IGST at 18%, computed so base + igst == gross exactly. */
  igstInr: number;
  /** Gross = what the therapist paid. */
  grossInr: number;
}

export function gstBreakdown(grossInr: number): GstBreakdown {
  const baseInr = Math.round(grossInr / (1 + GST_RATE));
  return { baseInr, igstInr: grossInr - baseInr, grossInr };
}

export interface SellerIdentity {
  legalName: string;
  gstin: string | null;
  address: string;
  state: string;
  email: string;
}

export function sellerIdentity(): SellerIdentity {
  return {
    legalName: process.env['INVOICE_SELLER_LEGAL_NAME'] ?? 'Cureocity Mind',
    gstin: process.env['INVOICE_SELLER_GSTIN'] ?? null,
    address: process.env['INVOICE_SELLER_ADDRESS'] ?? '—',
    state: process.env['INVOICE_SELLER_STATE'] ?? '—',
    email: process.env['INVOICE_SELLER_EMAIL'] ?? 'billing@cureocitymind.com',
  };
}

/** Deterministic, human-readable invoice number from the payment row. */
export function invoiceNumber(paymentId: string, createdAt: Date): string {
  return `CM/${createdAt.getUTCFullYear()}/${paymentId.slice(-8).toUpperCase()}`;
}
