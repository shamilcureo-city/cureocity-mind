/**
 * Sprint 61 — map the current screen to the most relevant Learn topic.
 *
 * Pure + serializable, so it's safe to import into a client component.
 * Returns a topic slug (resolved to a title by the caller from its topic
 * index) or null for screens that are themselves help/settings.
 */

interface Rule {
  /** Path to match. */
  path: string;
  /** Exact match instead of prefix. */
  exact?: boolean;
  /** Learn topic slug to offer. */
  slug: string;
}

// Most specific first.
const RULES: Rule[] = [
  { path: '/app/sessions/', slug: 'session-note' },
  { path: '/app/clients/', slug: 'session-note' },
  { path: '/app/clients', slug: 'add-a-client' },
  { path: '/app/today', slug: 'record-a-session' },
  { path: '/app/dashboard', slug: 'what-is-this' },
  { path: '/app', exact: true, slug: 'record-a-session' },
];

export function helpSlugForPath(pathname: string): string | null {
  // The help center and settings don't need a "help for this page" link.
  if (pathname.startsWith('/app/learn') || pathname.startsWith('/app/settings')) return null;
  for (const r of RULES) {
    if (r.exact ? pathname === r.path : pathname.startsWith(r.path)) return r.slug;
  }
  return 'what-is-this';
}
