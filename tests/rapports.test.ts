import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Un rapport (`_handoff/RAPPORT_*.md`) ne part jamais avec un emplacement
 * `@@…@@` laissé par sa rédaction : un rapport tronqué passerait pour complet.
 * `_handoff/` vit sur le VPS, hors du dépôt : sans lui, rien à vérifier.
 */
export function placeholders(text: string): string[] {
  return text
    .split('\n')
    .map((line, index) => ({ line, n: index + 1 }))
    .filter(({ line }) => line.includes('@@'))
    .map(({ line, n }) => `ligne ${n} : ${line.trim()}`);
}

const DIR = join(process.cwd(), '_handoff');
const reports = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^RAPPORT_.*\.md$/.test(f)).sort() : [];

describe('les rapports — aucun emplacement @@ restant', () => {
  it('contre-épreuve : un emplacement est trouvé, un texte complet passe', () => {
    expect(placeholders('# Titre\n\n@@POIDS@@\n\nfin')).toEqual(['ligne 3 : @@POIDS@@']);
    expect(placeholders('Un rapport complet, avec une adresse e-mail a@b.sn.')).toEqual([]);
  });

  for (const file of reports) {
    it(`${file} est complet`, () => {
      expect(placeholders(readFileSync(join(DIR, file), 'utf8'))).toEqual([]);
    });
  }
});
