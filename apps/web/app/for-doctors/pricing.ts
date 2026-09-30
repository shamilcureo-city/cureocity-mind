/** Scribe marketing offers only. Does not change the shared billing catalogue. */
export const SCRIBE_UAE_PLANS = [
  {
    id: 'essential',
    name: 'Essential',
    priceAed: 500,
    credits: 200,
    periodMonths: 1,
    label: 'For your regular clinic',
    description: 'A focused plan for your monthly consultations.',
  },
  {
    id: 'plus',
    name: 'Plus',
    priceAed: 750,
    credits: 500,
    periodMonths: 1,
    label: 'For a fuller clinic day',
    description: 'More consultation credits for a busier practice.',
  },
] as const;

export function scribeEnquiryHref(plan?: (typeof SCRIBE_UAE_PLANS)[number]): string {
  const subject = plan
    ? `Cureocity Scribe UAE — ${plan.name} plan enquiry`
    : 'Cureocity Scribe — UAE practice enquiry';
  const body = plan
    ? `Hello, I would like to enquire about the Scribe ${plan.name} plan: AED ${plan.priceAed} for ${plan.credits} consultation credits for 1 month (1 credit = 1 consultation). Please confirm activation, usage terms and any applicable taxes.\n\nClinic name:\nPreferred contact details:`
    : 'Hello, I would like to discuss Cureocity Scribe for my UAE practice.\n\nClinic name:\nConsultation languages:\nPreferred contact details:';
  return `mailto:shamil@cureo.city?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
