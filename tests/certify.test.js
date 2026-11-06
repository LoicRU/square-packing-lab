import { describe, it, expect } from 'vitest';
import { certifyAgainstKnown } from '../src/engine/certify.js';
import { gridLayout, rotateCluster, isValid } from '../src/algorithms/hop.js';
import { expand } from '../src/algorithms/hop.js';
import { createRng } from '../src/engine/rng.js';

describe('détecteur de record', () => {
  it('la grille 5×5 (N=25) est certifiée et ne bat pas le record connu 5', () => {
    const c = certifyAgainstKnown(gridLayout(25), 25);
    expect(c.certified).toBe(true); expect(c.beats).toBe(false); expect(c.ties).toBe(true);
  });
  it('N sans référence (> 40) : certifiée, jamais « bat le record »', () => {
    const c = certifyAgainstKnown(gridLayout(49), 49); expect(c.ref).toBeNull(); expect(c.certified).toBe(true); expect(c.beats).toBe(false);
  });
  it('une solution sous la borne d\'aire n\'est jamais certifiée', () => {
    const g = gridLayout(25); const bad = { ...g, S: 4.9 };
    expect(certifyAgainstKnown(bad, 25).certified).toBe(false);
  });
  it('une disposition plus grande que le record connu ne le bat pas', () => {
    expect(certifyAgainstKnown(gridLayout(17), 17).beats).toBe(false);
  });
  it('rotateCluster reste valide', () => {
    const rng = createRng(2); const E = expand(gridLayout(16), 0.05);
    for (let i = 0; i < 20; i++) expect(isValid(rotateCluster(E, rng, 0.05))).toBe(true);
  });
});
