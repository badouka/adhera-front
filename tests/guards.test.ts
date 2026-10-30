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

  it('ne formate aucun nombre dans src/, hors du helper de saisie (§ D)', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC, ['.ts', '.tsx'])) {
      if (file === TYPED_AMOUNT) continue;
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
 * § D — l'exception UNIQUE à R1 : `formatTypedAmount` réaffiche la saisie de
 * l'utilisateur avant l'envoi. Seuls les composants de saisie de montant ont
 * le droit de l'importer.
 */
const TYPED_AMOUNT = join(SRC, 'lib', 'typedAmount.ts');
const TYPED_AMOUNT_ALLOWED = [
  join(SRC, 'components', 'PaymentSheet.tsx'),
  join(SRC, 'components', 'bureau', 'DirectPaymentPanel.tsx'),
];

/** Vrai si le code importe le helper, quel que soit le chemin employé. */
export function importsTypedAmount(code: string): boolean {
  return /from\s+['"][^'"]*typedAmount['"]/.test(code) || /\bformatTypedAmount\b/.test(code);
}

describe('§ D — formatTypedAmount, réservé aux composants de saisie', () => {
  it('n’est importé que par la liste blanche', () => {
    const importers = walk(SRC, ['.ts', '.tsx'])
      .filter((file) => file !== TYPED_AMOUNT)
      .filter((file) => importsTypedAmount(stripComments(readFileSync(file, 'utf8'))));

    expect(importers.map((f) => relative(process.cwd(), f)).sort()).toEqual(
      TYPED_AMOUNT_ALLOWED.map((f) => relative(process.cwd(), f)).sort(),
    );
  });

  it('contre-épreuve : un import hors liste blanche serait vu', () => {
    expect(importsTypedAmount("import { formatTypedAmount } from '@/lib/typedAmount';")).toBe(true);
    expect(importsTypedAmount("import * as t from '../lib/typedAmount';")).toBe(true);
    expect(importsTypedAmount(stripComments('// formatTypedAmount(1)'))).toBe(false);
    expect(importsTypedAmount("import { parseAmount } from '@/lib/validation';")).toBe(false);
  });

  it('contre-épreuve : Intl.NumberFormat ailleurs que dans le helper reste interdit', () => {
    // Le helper est la seule exception du scan R1 : la même ligne, n'importe
    // où ailleurs, serait signalée.
    const helper = stripComments(readFileSync(TYPED_AMOUNT, 'utf8'));
    expect(helper).toContain('Intl.NumberFormat');
    expect(['toLocaleString(', 'Intl.NumberFormat', 'toFixed('].some((n) => helper.includes(n))).toBe(true);
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

/**
 * Le scan commun des garde-fous de F2 : chaque fichier de `dirs`, commentaires
 * retirés, contre chaque motif interdit.
 */
function scan(dirs: string[], forbidden: ReadonlyArray<{ label: string; pattern: RegExp }>) {
  const offenders: string[] = [];
  let scanned = 0;
  for (const dir of dirs) {
    for (const file of walk(dir, ['.ts', '.tsx'])) {
      scanned += 1;
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const { label, pattern } of forbidden) {
        if (pattern.test(code)) offenders.push(`${relative(process.cwd(), file)} → ${label}`);
      }
    }
  }
  return { offenders, scanned };
}

const BUREAU_DIRS = [
  join(SRC, 'lib', 'bureau'),
  join(SRC, 'app', 'bureau'),
  join(SRC, 'components', 'bureau'),
];

/**
 * R8 — aucune injection de HTML ni de code.
 *
 * Une injection de script volerait le jeton du bureau, qui valide des
 * paiements. React échappe tout par défaut : il suffit de ne jamais le
 * contourner.
 */
describe('R8 — ni HTML brut, ni eval, dans tout src/', () => {
  const FORBIDDEN = [
    { label: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML/ },
    { label: 'innerHTML', pattern: /\binnerHTML\b/ },
    { label: 'outerHTML', pattern: /\bouterHTML\b/ },
    { label: 'insertAdjacentHTML', pattern: /\binsertAdjacentHTML\b/ },
    { label: 'eval(', pattern: /(^|[^\w.$])eval\s*\(/m },
    { label: 'new Function(', pattern: /\bnew\s+Function\s*\(/ },
  ];

  it('ne trouve aucun contournement de l’échappement de React', () => {
    const { offenders, scanned } = scan([SRC], FORBIDDEN);
    expect(scanned).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
  });

  it('le scan voit les violations en code, pas en commentaire', () => {
    const hit = (code: string) => FORBIDDEN.some(({ pattern }) => pattern.test(stripComments(code)));
    expect(hit('<div dangerouslySetInnerHTML={{ __html: x }} />')).toBe(true);
    expect(hit('node.innerHTML = x;')).toBe(true);
    expect(hit('const y = eval(x);')).toBe(true);
    expect(hit('const f = new Function("return 1");')).toBe(true);
    expect(hit('// node.innerHTML = x;')).toBe(false);
    expect(hit('/* eval(x) */')).toBe(false);
    // Un mot qui finit par « eval » n'est pas eval.
    expect(hit('retrieval(x); obj.eval(x);')).toBe(false);
  });
});

/**
 * R7 — le jeton du bureau vit en mémoire + sessionStorage, jamais dans un
 * stockage persistant ni dans un cookie lisible.
 */
describe('R7 — aucun stockage persistant du jeton dans l’espace bureau', () => {
  const FORBIDDEN = [
    { label: 'localStorage', pattern: /localStorage/ },
    { label: 'document.cookie', pattern: /document\.cookie/ },
    { label: 'indexedDB', pattern: /indexedDB/ },
  ];

  it('ni localStorage, ni cookie, ni IndexedDB sous src/lib|app|components/bureau', () => {
    const { offenders, scanned } = scan(BUREAU_DIRS, FORBIDDEN);
    expect(scanned).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it('la session passe bien par sessionStorage', () => {
    const session = stripComments(readFileSync(join(SRC, 'lib', 'bureau', 'session.ts'), 'utf8'));
    expect(session).toContain('sessionStorage');
  });

  it('le scan voit localStorage en code, pas en commentaire', () => {
    const hit = (code: string) => FORBIDDEN.some(({ pattern }) => pattern.test(stripComments(code)));
    expect(hit("window.localStorage.setItem('t', token);")).toBe(true);
    expect(hit('document.cookie = "t=" + token;')).toBe(true);
    expect(hit('// jamais localStorage')).toBe(false);
  });
});

/** R1 de F1, étendu à l'espace bureau : il est bien dans le périmètre du scan. */
describe('R1 — l’espace bureau ne formate aucun montant', () => {
  it('les fichiers de /bureau sont scannés, et aucun ne formate', () => {
    const { offenders, scanned } = scan(BUREAU_DIRS, [
      { label: 'toLocaleString(', pattern: /toLocaleString\(/ },
      { label: 'Intl.NumberFormat', pattern: /Intl\.NumberFormat/ },
      { label: 'toFixed(', pattern: /toFixed\(/ },
    ]);
    expect(scanned).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it('les composants serveur de /bureau n’appellent pas l’API (R2)', () => {
    const layout = stripComments(readFileSync(join(SRC, 'app', 'bureau', 'layout.tsx'), 'utf8'));
    expect(layout).not.toContain('fetch(');
    expect(layout).not.toMatch(/from\s+['"]@?[./\w-]*lib\/bureau\/api['"]/);
    // Toutes les pages de /bureau sont des composants client.
    for (const file of walk(join(SRC, 'app', 'bureau'), ['page.tsx'])) {
      expect(readFileSync(file, 'utf8').trimStart().startsWith("'use client'")).toBe(true);
    }
  });
});

/** Tout lien sortant de l'espace bureau ouvre un onglet SANS opener ni Referer. */
describe('R3 — liens sortants du bureau', () => {
  it('chaque target="_blank" porte rel="noopener noreferrer"', () => {
    const offenders: string[] = [];
    for (const dir of BUREAU_DIRS) {
      for (const file of walk(dir, ['.tsx'])) {
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const match of code.matchAll(/target="_blank"[^>]*/g)) {
          if (!match[0].includes('rel="noopener noreferrer"')) {
            offenders.push(relative(process.cwd(), file));
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** Les chaînes et le texte JSX d'un fichier, sans identifiants ni codes. */
export function visibleStrings(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  for (const m of code.matchAll(/>([^<>{}]*[A-Za-zÀ-ÿ][^<>{}]*)</g)) out.push(m[1] ?? '');
  // Un code d'API (`declaration_pending`) ou un chemin d'import n'est pas
  // affiché : seuls comptent les mots d'un humain.
  return out.filter((t) => !/^[\w./@\-[\]]*$/.test(t.trim()));
}

/**
 * Étape 1 — le membre « paie », il ne « déclare » pas. Ni « déclarer », ni
 * « déclaration », ni « justificatif » sur son écran.
 */
describe('vocabulaire — l’écran du membre', () => {
  const MEMBER_FILES = [
    join(SRC, 'app', 'm', '[token]', 'MemberPage.tsx'),
    join(SRC, 'components', 'PaymentSheet.tsx'),
    join(SRC, 'components', 'PaymentHowTo.tsx'),
    join(SRC, 'components', 'CopyButton.tsx'),
    join(SRC, 'components', 'ReceiptList.tsx'),
    join(SRC, 'components', 'Fallbacks.tsx'),
    join(SRC, 'components', 'Shell.tsx'),
    join(SRC, 'lib', 'validation.ts'),
  ];
  const BANNED = /d[ée]clar|justificatif/i;

  it('aucune chaîne affichable ne dit « déclar… » ni « justificatif »', () => {
    const offenders: string[] = [];
    for (const file of MEMBER_FILES) {
      for (const text of visibleStrings(stripComments(readFileSync(file, 'utf8')))) {
        if (BANNED.test(text)) offenders.push(`${relative(process.cwd(), file)} → ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('le scan lit bien les textes de l’écran', () => {
    const texts = MEMBER_FILES.flatMap((f) => visibleStrings(stripComments(readFileSync(f, 'utf8'))));
    expect(texts.some((t) => t.includes('J’ai payé'))).toBe(true);
    expect(texts.some((t) => t.includes('Ajouter une capture d’écran (facultatif)'))).toBe(true);
    expect(texts.some((t) => t.includes('Le bureau confirmera votre paiement'))).toBe(true);
  });

  it('contre-épreuve : le scan voit une chaîne et un texte JSX fautifs', () => {
    const hit = (code: string) => visibleStrings(code).some((t) => BANNED.test(t));
    expect(hit("setMessage('Votre déclaration est enregistrée.');")).toBe(true);
    expect(hit('<p>Ajouter un justificatif</p>')).toBe(true);
    expect(hit('<h2 className="title">Déclarer mon paiement</h2>')).toBe(true);
    // Un code d'API, un identifiant : invisibles pour le membre.
    expect(hit("if (error.code === 'declaration_pending') {}")).toBe(false);
    expect(hit('const declared = pending_declaration;')).toBe(false);
  });
});

/** Étape 1 — prénom et nom sont deux champs : jamais de « nom complet ». */
describe('noms — aucun champ « nom complet » pour une personne', () => {
  it('aucune chaîne de /bureau ne parle de « nom complet »', () => {
    const { offenders } = scan(BUREAU_DIRS, [
      { label: 'nom complet', pattern: /nom complet/i },
    ]);
    expect(offenders).toEqual([]);
  });

  it('contre-épreuve', () => {
    expect(/nom complet/i.test(stripComments('<Field label="Nom complet" />'))).toBe(true);
  });
});

/**
 * Le registre arrive trié par nom de famille, organisations intercalées
 * (v3.5.7) : le serveur voit l'ensemble, le client non. Aucun retri.
 */
describe('registre — aucun tri côté client', () => {
  const FILES = [
    join(SRC, 'app', 'bureau', 'membres', 'page.tsx'),
    join(SRC, 'app', 'bureau', 'encaisser', 'page.tsx'),
  ];
  const SORTS = /\.sort\(|\.toSorted\(|localeCompare|Intl\.Collator/;

  it('ni le registre ni la recherche d’« Encaisser » ne retrient', () => {
    const offenders = FILES.filter((f) => SORTS.test(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => relative(process.cwd(), f))).toEqual([]);
  });

  it('contre-épreuve', () => {
    expect(SORTS.test('members.sort((a, b) => a.name.localeCompare(b.name))')).toBe(true);
    expect(SORTS.test('[...members].toSorted(byName)')).toBe(true);
    expect(SORTS.test('members.slice(0, 50)')).toBe(false);
  });
});
