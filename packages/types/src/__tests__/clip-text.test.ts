import { clipText } from '../clip-text';

describe('clipText', () => {
  it('returns text that fits unchanged', () => {
    expect(clipText('short', 10)).toBe('short');
    expect(clipText('exactly 10!', 11, 'end')).toBe('exactly 10!');
  });

  it('keeps the start by default and marks the cut at the end', () => {
    expect(clipText('abcdefghij', 5)).toBe('abcd…');
  });

  it('keeps the end when the latest text matters and marks the cut at the start', () => {
    expect(clipText('abcdefghij', 5, 'end')).toBe('…ghij');
  });

  it('never exceeds the limit', () => {
    expect(clipText('x'.repeat(100), 10, 'end')).toHaveLength(10);
    expect(clipText('x'.repeat(100), 10)).toHaveLength(10);
  });
});
