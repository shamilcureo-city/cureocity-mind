import { NextResponse } from 'next/server';

/** Apply clinical-response privacy headers without changing status/body/cookies. */
export function privateResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export function privateJson(body: unknown, init?: ResponseInit): NextResponse {
  return privateResponse(NextResponse.json(body, init));
}
