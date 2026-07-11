import type { Metadata } from 'next';
import { CareLogin } from '@/components/care/CareLogin';

export const metadata: Metadata = { title: 'Sign in — Cureocity Care' };

export default function CareLoginPage() {
  return <CareLogin />;
}
