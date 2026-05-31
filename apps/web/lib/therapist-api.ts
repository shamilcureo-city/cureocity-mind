import type {
  Client,
  CreateClientInput,
  CreateSessionInput,
  ListClientsResponse,
  Session,
} from '@cureocity/contracts';

/**
 * Therapist-side BFF calls. Same-origin (apps/web hosts both UI and
 * /api/v1/*) so the base is just /api/v1. Authentication is intentionally
 * absent on the client — when AUTH_BYPASS=true on the server, the API
 * routes resolve the seeded dev psychologist (priya.menon@example.in)
 * automatically. When real Firebase comes online, the auth-server.ts
 * guard switches to Bearer-token verification and we add a token-aware
 * `fetch` wrapper here.
 */

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${text || path}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const TherapistApi = {
  listClients(): Promise<ListClientsResponse> {
    return http<ListClientsResponse>('/clients');
  },
  getClient(id: string): Promise<Client> {
    return http<Client>(`/clients/${encodeURIComponent(id)}`);
  },
  createClient(input: CreateClientInput): Promise<Client> {
    return http<Client>('/clients', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  createSession(input: CreateSessionInput): Promise<Session> {
    return http<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};
