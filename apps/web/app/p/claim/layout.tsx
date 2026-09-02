import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Claim your private care page',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function ClientClaimLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
