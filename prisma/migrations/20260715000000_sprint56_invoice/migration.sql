-- Sprint 56 (Lever 4 #3) — GST invoice PDF download audit.
-- Append-only audit verb; idempotent. No table changes — invoices are
-- rendered on demand from the BillingPayment row.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_DOWNLOADED';
