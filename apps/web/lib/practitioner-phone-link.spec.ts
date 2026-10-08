import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  currentUser: null as null | { uid: string; providerData: { providerId: string }[] },
  link: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('firebase/auth', () => ({ linkWithPhoneNumber: h.link }));
vi.mock('./firebase-therapist', () => ({ getFirebaseAuth: () => h }));
import { beginPractitionerPhoneLink, practitionerPhoneLinkError } from './practitioner-phone-link';

beforeEach(() => {
  vi.clearAllMocks();
  h.currentUser = { uid: 'original-google-uid', providerData: [{ providerId: 'google.com' }] };
  h.link.mockResolvedValue({ confirm: h.confirm });
  h.confirm.mockResolvedValue({ user: h.currentUser });
});
describe('same-identity phone provider linking', () => {
  it('links to the existing Google identity rather than signing into a replacement', async () => {
    const verifier = {} as never;
    const flow = await beginPractitionerPhoneLink('original-google-uid', '+971500000000', verifier);
    expect(h.link).toHaveBeenCalledWith(h.currentUser, '+971500000000', verifier);
    await flow.confirm('123456');
    expect(h.confirm).toHaveBeenCalledWith('123456');
    expect(h.currentUser?.uid).toBe('original-google-uid');
  });
  it.each([null, { uid: 'different-uid', providerData: [] }])(
    'rejects an absent or mismatched page identity before SMS',
    async (user) => {
      h.currentUser = user;
      await expect(
        beginPractitionerPhoneLink('original-google-uid', '+971500000000', {} as never),
      ).rejects.toThrow('original Google or email');
      expect(h.link).not.toHaveBeenCalled();
    },
  );
  it('rejects a sign-in change between SMS and confirmation', async () => {
    const flow = await beginPractitionerPhoneLink(
      'original-google-uid',
      '+971500000000',
      {} as never,
    );
    h.currentUser = { uid: 'different-uid', providerData: [] };
    await expect(flow.confirm('123456')).rejects.toThrow('sign-in changed');
    expect(h.confirm).not.toHaveBeenCalled();
  });
  it('does not automatically merge a phone belonging to a separate identity', async () => {
    h.link.mockRejectedValue({ code: 'auth/credential-already-in-use' });
    await expect(
      beginPractitionerPhoneLink('original-google-uid', '+971500000000', {} as never),
    ).rejects.toMatchObject({ code: 'auth/credential-already-in-use' });
    expect(h.currentUser?.uid).toBe('original-google-uid');
    expect(practitionerPhoneLinkError({ code: 'auth/credential-already-in-use' })).toContain(
      'verified account recovery',
    );
    expect(h.confirm).not.toHaveBeenCalled();
  });
});
