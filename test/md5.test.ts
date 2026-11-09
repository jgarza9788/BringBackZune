import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { md5 } from '../src/core/md5';

describe('md5', () => {
  it('matches known vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
  });

  it('matches node:crypto across lengths (block boundaries) and unicode', () => {
    for (const len of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const s = 'x'.repeat(len);
      expect(md5(s)).toBe(createHash('md5').update(s).digest('hex'));
    }
    const u = 'pässwörd-日本語-🎵';
    expect(md5(u)).toBe(createHash('md5').update(u, 'utf8').digest('hex'));
  });

  it('matches the Subsonic spec example (sesame + c19b2d)', () => {
    expect(md5('sesamec19b2d')).toBe('26719a1196d2a940705a59634eb18eab');
  });
});
