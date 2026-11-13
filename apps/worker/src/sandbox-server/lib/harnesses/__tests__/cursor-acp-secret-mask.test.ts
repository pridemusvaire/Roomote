import { maskText } from '../cursor-acp/secret-mask';

describe('maskText', () => {
  it('replaces every occurrence of every secret', () => {
    expect(
      maskText('a-secret-1 and a-secret-1, b-secret-2', [
        'a-secret-1',
        'b-secret-2',
      ]),
    ).toBe('[redacted] and [redacted], [redacted]');
  });

  it('hides all of a longer secret that starts with a shorter one, whatever the order given', () => {
    const short = 'token-abcdef';
    const long = 'token-abcdef-TAIL-0123456789';

    expect(maskText(`key ${long}`, [short, long])).toBe('key [redacted]');
    expect(maskText(`key ${long}`, [long, short])).toBe('key [redacted]');
  });

  it('does not change the list it is given', () => {
    const secrets = ['aaaaaaaa', 'aaaaaaaaaaaa'];

    maskText('x', secrets);

    expect(secrets).toEqual(['aaaaaaaa', 'aaaaaaaaaaaa']);
  });
});
