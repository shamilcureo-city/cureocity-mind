import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Your private care page',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function ClientCareHomeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
