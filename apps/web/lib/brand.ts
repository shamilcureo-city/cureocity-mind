/**
 * Cureocity ORBIT brand source of truth.
 *
 * Keep customer-facing product naming here so future brand refinements do
 * not require another repository-wide string migration. Package scopes,
 * database identifiers, audit targets, and storage keys intentionally keep
 * their stable `cureocity` names.
 */
export const BRAND = {
  company: 'Cureocity',
  product: 'ORBIT',
  fullName: 'Cureocity ORBIT',
  assistantName: 'ORBIT Assistant',
  tagline: 'The intelligent workspace for every clinical encounter.',
  description:
    'Prepare, conduct, document, follow up, and measure care from one intelligent clinical workspace.',
} as const;
