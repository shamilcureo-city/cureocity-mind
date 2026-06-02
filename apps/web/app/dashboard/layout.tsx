import type { ReactNode } from 'react';
import { Sidebar } from '@/components/dashboard/Sidebar';

export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 bg-[var(--color-bg)]">{children}</div>
    </div>
  );
}
