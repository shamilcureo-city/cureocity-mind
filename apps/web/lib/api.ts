import type { ClaimTokenPreview, ClaimTokenRedeemResult } from '@cureocity/contracts';

const PATIENT_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1';

export async function fetchClaimPreview(token: string): Promise<ClaimTokenPreview> {
  const res = await fetch(`${PATIENT_BASE}/claim-tokens/${encodeURIComponent(token)}`, {
    method: 'GET',
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(`Preview failed: ${res.status} ${text}`);
  }
  return (await res.json()) as ClaimTokenPreview;
}

export async function redeemClaim(token: string, idToken: string): Promise<ClaimTokenRedeemResult> {
  const res = await fetch(`${PATIENT_BASE}/claim-tokens/${encodeURIComponent(token)}/redeem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: '{}',
  });
  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(`Redeem failed: ${res.status} ${text}`);
  }
  return (await res.json()) as ClaimTokenRedeemResult;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
