import { SCRIBE_UAE_PLANS, scribeEnquiryHref } from '@/app/for-doctors/pricing';
import { DirhamSymbol } from '@/app/for-doctors/DirhamSymbol';
import { Card } from '../ui/Card';

export function ScribePlanRequests() {
  return (
    <section aria-labelledby="scribe-plans" className="space-y-4">
      <h2 id="scribe-plans" className="font-serif text-2xl">
        Scribe monthly plans
      </h2>
      <p className="text-sm">
        1 credit = 1 consultation. These offers require activation by our team. Sending a request
        does not take payment, change your current plan or add credits.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {SCRIBE_UAE_PLANS.map((plan) => (
          <Card key={plan.id} className="space-y-3 p-6">
            <h3 className="font-semibold">{plan.name}</h3>
            <p className="flex items-center gap-2 font-serif text-3xl">
              <DirhamSymbol className="h-7 w-7" />
              <span className="sr-only">AED </span>
              {plan.priceAed}
              <span className="font-sans text-sm">/ month</span>
            </p>
            <p>{plan.credits} consultation credits for 1 month</p>
            <a
              href={scribeEnquiryHref(plan)}
              className="inline-flex min-h-11 items-center rounded-full bg-[var(--color-ink)] px-5 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              Request {plan.name}
            </a>
          </Card>
        ))}
      </div>
      <p className="text-sm text-[var(--color-ink-2)]">
        Activation, unused-credit terms and any applicable taxes are confirmed before payment. Your
        current plan is shown above; existing paid plans stay unchanged until separately agreed.
      </p>
    </section>
  );
}
