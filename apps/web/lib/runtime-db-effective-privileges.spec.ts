import { describe, expect, it } from 'vitest';
import { assertRuntimeRoleVerification } from '../../../scripts/verify-runtime-db-role.mjs';

const safe = {
  current_user: 'runtime',
  current_database: 'app',
  rolsuper: false,
  rolbypassrls: false,
  rolcreaterole: false,
  rolcreatedb: false,
  rolreplication: false,
  owner_membership: false,
  signature_update: false,
  signature_delete: false,
  signature_truncate: false,
  erasure_execute: false,
  schema_create: false,
};

describe('effective runtime PostgreSQL privilege verification', () => {
  it('accepts the exact least-privilege runtime identity', () => {
    expect(() => assertRuntimeRoleVerification(safe, 'runtime', 'app')).not.toThrow();
  });

  it.each(['rolsuper', 'rolbypassrls', 'rolcreaterole', 'rolcreatedb', 'rolreplication'])(
    'rejects %s',
    (flag) => {
      expect(() =>
        assertRuntimeRoleVerification({ ...safe, [flag]: true }, 'runtime', 'app'),
      ).toThrow('forbidden');
    },
  );

  it.each([
    'owner_membership',
    'signature_update',
    'signature_delete',
    'signature_truncate',
    'erasure_execute',
  ])('rejects effective %s', (flag) => {
    expect(() =>
      assertRuntimeRoleVerification({ ...safe, [flag]: true }, 'runtime', 'app'),
    ).toThrow('owner or destructive');
  });

  it('rejects schema CREATE and connection identity drift', () => {
    expect(() =>
      assertRuntimeRoleVerification({ ...safe, schema_create: true }, 'runtime', 'app'),
    ).toThrow('CREATE');
    expect(() => assertRuntimeRoleVerification(safe, 'other', 'app')).toThrow('identity');
    expect(() => assertRuntimeRoleVerification(safe, 'runtime', 'other')).toThrow('identity');
  });
});
