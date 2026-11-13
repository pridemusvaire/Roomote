import { looksLikeRealSecret } from '../cursor-acp/secret-strength';

describe('looksLikeRealSecret', () => {
  it.each([
    'postgres',
    'password',
    'changeme',
    'minioadmin',
    'ABCDEFGH',
    '12345678',
    'abcdefghijklmnopq',
    'short',
    '',
  ])('does not take the plain word or number %j for a secret', (value) => {
    expect(looksLikeRealSecret(value)).toBe(false);
  });

  it.each([
    'glpat-super-secret-value-123',
    'ghp_AbCdEf1234567890',
    'sk-proj-abc123',
    'Passw0rdX',
    'a1b2c3d4',
    'user@example',
    'two-words',
  ])('takes %j, with two kinds of character, for a secret', (value) => {
    expect(looksLikeRealSecret(value)).toBe(true);
  });

  it('takes a long value for a secret whatever it is made of', () => {
    expect(looksLikeRealSecret('abcdefghijklmnopqrst')).toBe(true);
    expect(looksLikeRealSecret('A'.repeat(20))).toBe(true);
    expect(looksLikeRealSecret('1'.repeat(20))).toBe(true);
  });

  it('needs at least eight characters even with two kinds of them', () => {
    expect(looksLikeRealSecret('Ab1')).toBe(false);
    expect(looksLikeRealSecret('Ab1-xyz')).toBe(false);
    expect(looksLikeRealSecret('Ab1-xyzw')).toBe(true);
  });
});
