import { decryptClientField } from './client-pii';
import { normaliseIndianPhone } from './phone';

export async function claimPhoneMatches(args: {
  psychologistId: string;
  contactPhoneEncrypted: string | null;
  verifiedPhoneNumber: string | null;
}): Promise<boolean> {
  if (!args.verifiedPhoneNumber || !args.contactPhoneEncrypted) return false;
  const expected = normaliseIndianPhone(
    await decryptClientField(args.psychologistId, args.contactPhoneEncrypted),
  );
  return normaliseIndianPhone(args.verifiedPhoneNumber) === expected;
}
