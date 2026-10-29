import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, exts));
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Retire commentaires de ligne et de bloc en respectant les chaînes, pour que
 * ni `'https://…'` ni un `/* *\/` cité ne fasse dérailper le scan.
 */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;

  while (i < source.length) {
    const c = source[i] as string;
    const next = source[i + 1];

    if (quote) {
      if (c === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

/**
 * R1 — aucun montant n'est formaté côté client.
 *
 * L'autorité est `ReceiptData::formatAmount()` côté serveur : une seconde
 * implémentation divergerait de « 250 000 FCFA ». Seuls les champs
 * `*_formatted` sont affichés ; le seul nombre brut manipulé est la valeur du
 * champ montant du formulaire.
 */
describe('R1 — aucun formatage de montant côté client', () => {
  const FORBIDDEN = ['toLocaleString(', 'Intl.NumberFormat', 'toFixed('];

  it('ne formate aucun nombre dans src/', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC, ['.ts', '.tsx'])) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const needle of FORBIDDEN) {
        if (code.includes(needle)) {
          offenders.push(`${relative(process.cwd(), file)} → ${needle}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('le scan voit bien à travers les commentaires', () => {
    // Contre-épreuve du scan lui-même : commenté, c'est invisible ; en code,
    // c'est détecté.
    expect(stripComments('// x.toFixed(2)')).not.toContain('toFixed(');
    expect(stripComments('/* x.toFixed(2) */')).not.toContain('toFixed(');
    expect(stripComments('const n = x.toFixed(2);')).toContain('toFixed(');
    // Une chaîne contenant « // » ne doit pas masquer la suite de la ligne.
    expect(stripComments("const u = 'https://a'; y.toFixed(1);")).toContain(
      'toFixed(',
    );
  });
});

/**
 * R2 — les données du membre se chargent dans le navigateur, jamais en SSR.
 *
 * Le limiteur `membership-public` compte 20 requêtes/min par IP : un fetch
 * serveur ferait passer tous les membres derrière l'IP du VPS.
 */
describe('R2 — aucun fetch en SSR', () => {
  const PAGE = join(SRC, 'app', 'm', '[token]', 'page.tsx');

  it('le composant serveur de /m/[token] n’appelle pas fetch', () => {
    const code = stripComments(readFileSync(PAGE, 'utf8'));
    expect(code).not.toContain('fetch(');
  });

  it('il n’importe pas non plus la couche API', () => {
    const code = stripComments(readFileSync(PAGE, 'utf8'));
    expect(code).not.toMatch(/from\s+['"]@?[./\w-]*lib\/api['"]/);
  });

  it('le composant qui charge les données est bien un composant client', () => {
    const member = readFileSync(
      join(SRC, 'app', 'm', '[token]', 'MemberPage.tsx'),
      'utf8',
    );
    expect(member.trimStart().startsWith("'use client'")).toBe(true);
  });
});

/** R3 — le jeton ne fuit pas : aucun tiers, aucun lien sortant sans noreferrer. */
describe('R3 — aucun tiers dans le code livré', () => {
  it('ne contacte aucun hôte autre que l’API d’EventFlow', () => {
    const allowed = /^https:\/\/api\.eventflow\.africa\b/;
    const offenders: string[] = [];

    for (const file of walk(SRC, ['.ts', '.tsx', '.css'])) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const url of code.match(/https?:\/\/[^\s'"`)]+/g) ?? []) {
        if (!allowed.test(url)) {
          offenders.push(`${relative(process.cwd(), file)} → ${url}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('tout lien vers l’API porte rel="noreferrer"', () => {
    const receipts = readFileSync(
      join(SRC, 'components', 'ReceiptList.tsx'),
      'utf8',
    );
    expect(receipts).toContain('rel="noreferrer"');
  });
});

/** Le design : tokens.css est la seule source des couleurs. */
describe('design — aucune couleur en hexadécimal dans les composants', () => {
  it('ne trouve aucun hexadécimal hors de tokens.css', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC, ['.ts', '.tsx'])) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const hex of code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
        offenders.push(`${relative(process.cwd(), file)} → ${hex}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
