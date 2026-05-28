import { redirect } from 'next/navigation';

export default function HomePage() {
  // V1: bounce to login; once a session cookie is wired we'll branch to
  // /clients here (Sprint 7).
  redirect('/login');
}
