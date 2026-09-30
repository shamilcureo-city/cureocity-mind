import * as React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  countAccounts: vi.fn(),
  findAccounts: vi.fn(),
  findBilling: vi.fn(),
  groupSessions: vi.fn(),
}));

vi.mock('@/lib/auth-page', () => ({ requirePageAdmin: mocks.requireAdmin }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    psychologist: { count: mocks.countAccounts, findMany: mocks.findAccounts },
    billingAccount: { findMany: mocks.findBilling },
    session: { groupBy: mocks.groupSessions },
  },
}));

import AdminAccountsPage from '../app/console/accounts/page';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  mocks.requireAdmin.mockResolvedValue({ id: 'admin-1' });
  mocks.countAccounts.mockResolvedValue(2);
  mocks.findAccounts.mockResolvedValue([
    {
      id: 'real-1',
      fullName: 'Current Practitioner',
      email: 'current@example.test',
      vertical: 'THERAPIST',
      status: 'ACTIVE',
      role: 'THERAPIST',
      isSynthetic: false,
      rciNumber: 'RCI-CURRENT-1',
      medicalRegNumber: null,
      createdAt: new Date('2026-09-30T10:00:00.000Z'),
      onboardingCompletedAt: new Date('2026-09-30T10:00:00.000Z'),
    },
    {
      id: 'demo-1',
      fullName: 'Dr Amina Al Mansoori',
      email: 'uae-doctor-0001@demo.cureocity.test',
      vertical: 'DOCTOR',
      status: 'ACTIVE',
      role: 'THERAPIST',
      isSynthetic: true,
      rciNumber: 'NOT-APPLICABLE-DHA-DEMO-NOT-ISSUED-0001',
      medicalRegNumber: 'DHA-DEMO-NOT-ISSUED-0001',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      onboardingCompletedAt: new Date('2026-09-01T00:00:00.000Z'),
    },
  ]);
  mocks.findBilling.mockResolvedValue([]);
  mocks.groupSessions.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllGlobals());

describe('demo account presentation boundary', () => {
  it('returns real and demo accounts together while marking only the fictional row', async () => {
    const html = renderToStaticMarkup(
      await AdminAccountsPage({ searchParams: Promise.resolve({}) }),
    );
    const rows = html.split('<tr');
    const realRow = rows.find((row) => row.includes('Current Practitioner'));
    const demoRow = rows.find((row) => row.includes('Dr Amina Al Mansoori'));

    expect(mocks.countAccounts).toHaveBeenCalledWith({ where: { deletedAt: null } });
    expect(mocks.findAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null },
        orderBy: [{ isSynthetic: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(html).not.toContain('name="dataset"');
    expect(realRow).toBeDefined();
    expect(realRow).not.toContain('>Demo</span>');
    expect(demoRow).toContain('>Demo</span>');
  });

  it('keeps a compact disclosure on an individual demo profile', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../app/console/accounts/[id]/page.tsx'),
      'utf8',
    );

    expect(source).toContain('isSynthetic: true');
    expect(source).toContain('href="/console/accounts"');
    expect(source).not.toContain('dataset=synthetic');
    expect(source).toMatch(/not a real\s+clinician or issued credential/);
  });
});
