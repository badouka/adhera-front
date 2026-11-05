import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
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
  // F5 — « Un membre a payé » : la saisie, et la phrase « Vous allez enregistrer ».
  join(SRC, 'app', 'bureau', 'enregistrer', 'page.tsx'),
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

/**
 * F6 — l'exception UNIQUE à R3 : trois messages WhatsApp n'ont pas d'adresse
 * servie par l'API (le lien personnel que le visiteur s'envoie, l'invitation
 * d'un membre, le lien pour adhérer que le bureau partage). Ils sont composés
 * dans un seul fichier, qui n'écrit qu'une adresse.
 */
const WHATSAPP_EXCEPTION = { file: 'src/lib/whatsapp.ts', url: 'https://wa.me/' };

/** R3 — le jeton ne fuit pas : aucun tiers, aucun lien sortant sans noreferrer. */
describe('R3 — aucun tiers dans le code livré', () => {
  it('ne contacte aucun hôte autre que l’API d’EventFlow', () => {
    const allowed = /^https:\/\/api\.eventflow\.africa\b/;
    const offenders: string[] = [];

    for (const file of walk(SRC, ['.ts', '.tsx', '.css'])) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const url of code.match(/https?:\/\/[^\s'"`)]+/g) ?? []) {
        if (allowed.test(url)) continue;
        if (relative(process.cwd(), file) === WHATSAPP_EXCEPTION.file && url === WHATSAPP_EXCEPTION.url) continue;
        offenders.push(`${relative(process.cwd(), file)} → ${url}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('F6 — l’exception nommée : wa.me, composé dans src/lib/whatsapp.ts et nulle part ailleurs', () => {
    const code = stripComments(readFileSync(WHATSAPP_EXCEPTION.file, 'utf8'));
    expect(code.match(/https?:\/\/[^\s'"`)]+/g)).toEqual([WHATSAPP_EXCEPTION.url]);
    // Contre-épreuve : aucun autre fichier n'écrit wa.me, même sans « https ».
    const elsewhere = walk(SRC, ['.ts', '.tsx'])
      .filter((file) => relative(process.cwd(), file) !== WHATSAPP_EXCEPTION.file)
      .filter((file) => /wa\.me\//.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(process.cwd(), file));
    expect(elsewhere).toEqual([]);
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
    // F4 — la carte et la vérification.
    join(SRC, 'components', 'card', 'MemberCardView.tsx'),
    join(SRC, 'components', 'card', 'AttestationAction.tsx'),
    join(SRC, 'components', 'card', 'SaveCard.tsx'),
    join(SRC, 'components', 'card', 'cardImage.ts'),
    join(SRC, 'components', 'card', 'QrCode.tsx'),
    join(SRC, 'app', 'v', '[code]', 'VerifyPage.tsx'),
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
    expect(texts.some((t) => t.includes('L’association vérifiera votre paiement'))).toBe(true);
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

/**
 * F3 — le vocabulaire du membre s'étend au bureau : « signaler », « capture »,
 * « refuser » ; jamais « déclarer » ni « justificatif » sur un écran.
 */
describe('vocabulaire — l’espace du bureau', () => {
  const BANNED = /d[ée]clar|justificatif/i;
  // Un `${declaredOn}` ou un `'declared'` (code d'API) n'est pas un mot affiché.
  const words = (text: string) => text.replace(/\$\{[^}]*\}/g, '').replace(/'[\w-]*'/g, '');

  it('aucune chaîne affichable de /bureau ne dit « déclar… » ni « justificatif »', () => {
    const offenders: string[] = [];
    let texts = 0;
    for (const dir of BUREAU_DIRS) {
      for (const file of walk(dir, ['.ts', '.tsx'])) {
        for (const text of visibleStrings(stripComments(readFileSync(file, 'utf8')))) {
          texts += 1;
          if (BANNED.test(words(text))) offenders.push(`${relative(process.cwd(), file)} → ${text}`);
        }
      }
    }
    expect(texts).toBeGreaterThan(200);
    expect(offenders).toEqual([]);
  });

  it('contre-épreuve : l’ancien « Déclarer une sortie » serait vu', () => {
    const hit = (code: string) =>
      visibleStrings(stripComments(code)).some((t) => BANNED.test(words(t)));
    expect(hit('<Button>Déclarer une sortie</Button>')).toBe(true);
    expect(hit("setError('Lien du justificatif absent');")).toBe(true);
    expect(hit("{ value: 'declared', label: 'À valider' }")).toBe(false);
    expect(hit('const s = `signalé le ${declaredOn}`;')).toBe(false);
  });
});

/**
 * F3 — le graphique est dessiné à la main : aucune bibliothèque, ni graphique
 * ni autre. F4 — une exception, et une seule : le QR de la carte
 * (`qrcode-generator`, version exacte), chargé À LA DEMANDE par un `import()`
 * dans `QrCode.tsx`, et nulle part ailleurs : il n'entre dans le premier
 * chargement d'aucune route.
 */
const QR_LIB = 'qrcode-generator';
const QR_COMPONENT = join(SRC, 'components', 'card', 'QrCode.tsx');

/** Les fichiers qui importent la bibliothèque QR, statiquement ou non. */
export function qrImports(code: string): { static: boolean; dynamic: boolean } {
  return {
    static: /(?:from\s+|import\s+)['"]qrcode-generator['"]/.test(code),
    dynamic: /import\(\s*['"]qrcode-generator['"]\s*\)/.test(code),
  };
}

describe('dépendances — aucune bibliothèque ajoutée au bundle', () => {
  it('les dépendances livrées sont next, react, react-dom, et la bibliothèque QR (F4)', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['next', QR_LIB, 'react', 'react-dom']);
    // Une version exacte : la mise à jour d'un générateur de QR se décide.
    expect(pkg.dependencies[QR_LIB]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('la bibliothèque QR n’est importée que par QrCode.tsx, et seulement à la demande', () => {
    const importers: string[] = [];
    for (const file of walk(SRC, ['.ts', '.tsx'])) {
      const found = qrImports(stripComments(readFileSync(file, 'utf8')));
      if (found.static) importers.push(`${relative(process.cwd(), file)} → statique`);
      if (found.dynamic) importers.push(`${relative(process.cwd(), file)} → import()`);
    }
    expect(importers).toEqual([`${relative(process.cwd(), QR_COMPONENT)} → import()`]);
  });

  it('contre-épreuve : un import statique serait vu', () => {
    expect(qrImports("import qrcode from 'qrcode-generator';").static).toBe(true);
    expect(qrImports("import 'qrcode-generator';").static).toBe(true);
    expect(qrImports("await import('qrcode-generator')").dynamic).toBe(true);
    expect(qrImports("await import('qrcode-generator')").static).toBe(false);
  });

  it('le graphique du tableau de bord est un SVG écrit ici', () => {
    const chart = stripComments(
      readFileSync(join(SRC, 'components', 'bureau', 'EvolutionChart.tsx'), 'utf8'),
    );
    expect(chart).toContain('<svg');
    // React, et nos propres modules : rien d'autre.
    expect(chart).not.toMatch(/from\s+['"](?!react['"]|[@./])/);
  });
});

/**
 * Accessibilité — `sr-only` jamais directement sur un <table> : Firefox dessine
 * le <caption> dans l'enveloppe du tableau, hors de la boîte que `sr-only`
 * rogne, et il reste visible. On enveloppe le tableau dans un <div sr-only>.
 */
const SR_ONLY_TABLE = /<table\b[^>]*\bsr-only\b/;

describe('accessibilité — aucun <table> ne porte sr-only directement', () => {
  it('ne trouve aucun <table className="… sr-only …"> dans src/', () => {
    const { offenders, scanned } = scan([SRC], [{ label: '<table> en sr-only', pattern: SR_ONLY_TABLE }]);
    expect(scanned).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });

  it('contre-épreuve : le scan voit l’ancien tableau du graphique, sur une ou plusieurs lignes', () => {
    expect(SR_ONLY_TABLE.test('<table className="sr-only">')).toBe(true);
    expect(SR_ONLY_TABLE.test('<table\n  data-x="1"\n  className="w-full sr-only"\n>')).toBe(true);
    expect(SR_ONLY_TABLE.test('<div className="sr-only">\n  <table>')).toBe(false);
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
    // F3 : la file WhatsApp (urgence puis nom de famille) et les campagnes
    // (la plus récente en tête) arrivent ordonnées par le serveur.
    join(SRC, 'app', 'bureau', 'a-envoyer', 'page.tsx'),
    join(SRC, 'app', 'bureau', 'campagnes', 'page.tsx'),
  ];
  const SORTS = /\.sort\(|\.toSorted\(|localeCompare|Intl\.Collator/;

  it('ni le registre, ni la recherche d’« Encaisser », ni la file, ni les campagnes ne retrient', () => {
    const offenders = FILES.filter((f) => SORTS.test(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => relative(process.cwd(), f))).toEqual([]);
  });

  it('contre-épreuve', () => {
    expect(SORTS.test('members.sort((a, b) => a.name.localeCompare(b.name))')).toBe(true);
    expect(SORTS.test('[...members].toSorted(byName)')).toBe(true);
    expect(SORTS.test('members.slice(0, 50)')).toBe(false);
  });
});

/**
 * §12.4 — `cancelled_at` est servi sur les reçus d'une période : la fiche le lit.
 * La déduction depuis les versements annulés (commit d2345c4, recette F3) est
 * retirée et ne doit pas revenir — elle travaillerait contre le contrat.
 */
const FICHE = join(SRC, 'app', 'bureau', 'membres', '[id]', 'page.tsx');

/** Vrai si le code marque un reçu de cotisation à partir des versements. */
export function deducesCancelledReceipts(code: string): boolean {
  return (
    /cancelledReceipts/.test(code) ||
    /status\s*===\s*['"]cancelled['"]\s*&&\s*\w+\.receipt\b/.test(code)
  );
}

describe('§12.4 — le reçu annulé se lit, il ne se déduit pas', () => {
  it('la fiche marque un paiement annulé par SON statut, et ne déduit rien des reçus (F5)', () => {
    // F5 : la fiche montre « Ses paiements », chacun avec son reçu ; un paiement
    // annulé y est marqué par son propre `status`, jamais par déduction.
    const code = stripComments(readFileSync(FICHE, 'utf8'));
    expect(code).toContain("payment.status === 'cancelled'");
    expect(deducesCancelledReceipts(code)).toBe(false);
  });

  it('contre-épreuve : la déduction de d2345c4 serait vue', () => {
    expect(
      deducesCancelledReceipts(
        "payments.value.filter((p) => p.status === 'cancelled' && p.receipt).map((p) => p.receipt?.id)",
      ),
    ).toBe(true);
    expect(deducesCancelledReceipts('<DuesPanel cancelledReceipts={ids} />')).toBe(true);
  });
});

/**
 * F4 — la carte et l'attestation portent le nom de L'ASSOCIATION. Aucun texte
 * affichable des composants de la carte ne nomme la plateforme ; seule la page
 * de vérification dit, en pied de page, « Vérification assurée par Adhera ».
 */
describe('marque — la carte ne nomme que l’association', () => {
  const CARD_FILES = ['MemberCardView.tsx', 'AttestationAction.tsx', 'SaveCard.tsx', 'cardImage.ts', 'QrCode.tsx'].map(
    (f) => join(SRC, 'components', 'card', f),
  );
  const BRANDS = /adhera|eventflow|digissol/i;

  it('aucun texte des composants de la carte ne dit Adhera, EventFlow ni DIGISSOL', () => {
    const offenders: string[] = [];
    for (const file of CARD_FILES) {
      for (const text of visibleStrings(stripComments(readFileSync(file, 'utf8')))) {
        // Une adresse (l'API) n'est pas un texte affiché.
        if (BRANDS.test(text) && !/^https?:\/\//.test(text)) {
          offenders.push(`${relative(process.cwd(), file)} → ${text}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('la vérification ne nomme la plateforme qu’une fois, en pied de page', () => {
    const texts = visibleStrings(
      stripComments(readFileSync(join(SRC, 'app', 'v', '[code]', 'VerifyPage.tsx'), 'utf8')),
    ).filter((t) => BRANDS.test(t));
    expect(texts).toEqual(['Vérification assurée par Adhera']);
  });

  it('contre-épreuve : un « Carte Adhera » serait vu', () => {
    expect(visibleStrings('<p>Carte Adhera</p>').some((t) => BRANDS.test(t))).toBe(true);
  });
});

/**
 * F4 — `a { color: var(--link) }` (globals.css) est hors couche : il l'emporte
 * sur une classe Tailwind. Un lien PLEIN (`bg-indigo text-on-indigo`) prenait
 * donc la couleur des liens, celle de son fond : le bouton « Télécharger mon
 * attestation » est sorti bleu sur bleu, vu en recette. Même défaut, plus
 * discret, sur « Espace du bureau » (`text-ink-muted`) et la liste des reçus
 * (`text-ink`) : écart E5. Sur un `<a>` ou un `<Link>`, TOUTE couleur de texte
 * du thème se pose en `!`, comme dans `bureau/ui.tsx` — sauf `text-link`, qui
 * est celle de la règle globale.
 */
const THEME_COLORS = [
  ...readFileSync(join(SRC, 'app', 'globals.css'), 'utf8').matchAll(/--color-([\w-]+):/g),
]
  .map((m) => m[1] as string)
  .filter((name) => name !== 'link');

export function anchorsWithWeakTextColor(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/<(a|Link)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/gs)) {
    for (const cls of (m[2] ?? m[3] ?? '').split(/\s+/)) {
      const color = /^text-([\w-]+)$/.exec(cls)?.[1];
      if (color && THEME_COLORS.includes(color)) found.push(`<${m[1]}> ${cls}`);
    }
  }
  return found;
}

describe('liens — le texte garde la couleur que l’écran lui donne', () => {
  it('la liste des couleurs du thème est lue', () => {
    expect(THEME_COLORS).toEqual(expect.arrayContaining(['ink', 'ink-muted', 'on-indigo']));
    expect(THEME_COLORS).not.toContain('link');
  });

  it('aucun <a> ni <Link> ne pose une couleur de texte du thème sans « ! »', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC, ['.tsx'])) {
      for (const hit of anchorsWithWeakTextColor(stripComments(readFileSync(file, 'utf8')))) {
        offenders.push(`${relative(process.cwd(), file)} → ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('contre-épreuve : le bouton bleu sur bleu et les liens d’E5 seraient vus', () => {
    expect(anchorsWithWeakTextColor('<a href="x" className="bg-indigo text-on-indigo">T</a>')).toEqual([
      '<a> text-on-indigo',
    ]);
    expect(anchorsWithWeakTextColor('<Link href="/bureau" className="small text-ink-muted">E</Link>')).toEqual([
      '<Link> text-ink-muted',
    ]);
    expect(anchorsWithWeakTextColor('<a href="x" className="border text-ink no-underline">R</a>')).toEqual([
      '<a> text-ink',
    ]);
    expect(anchorsWithWeakTextColor('<a href="x" className="bg-indigo text-on-indigo!">T</a>')).toEqual([]);
    // Une taille ou un alignement n'est pas une couleur ; `text-link` est celle de la règle.
    expect(anchorsWithWeakTextColor('<a href="x" className="text-[18px] text-center text-link">T</a>')).toEqual([]);
  });
});

/**
 * Règle du 2026-11-03 : le comportement se branche sur le `code`, le texte
 * affiché est le `message` de l'API dès qu'il existe, et les libellés locaux ne
 * servent que de repli. Les trois tables de libellés par code sont GELÉES
 * telles quelles : un code nouveau n'y entre pas, il affiche le message de
 * l'API. Retirer une clé reste permis (le message de l'API prend alors le
 * relais) ; en ajouter une fait échouer ce test.
 */
export function tableKeys(code: string, name: string): string[] {
  const start = code.indexOf(`const ${name}`);
  if (start < 0) return [];
  const body = code.slice(start, code.indexOf('\n};', start));
  return [...body.matchAll(/^\s+(\w+):/gm)].map((m) => m[1] as string);
}

const FROZEN_TABLES: ReadonlyArray<{ file: string; name: string; keys: string[] }> = [
  {
    file: 'src/lib/bureau/messages.ts',
    name: 'BY_CODE',
    keys: [
      'feature_disabled', 'cotisation_mode_unsupported', 'category_in_use', 'mime_not_allowed',
      'file_too_large', 'logo_missing', 'upload_invalid', 'proof_missing',
      'member_is_not_an_organisation', 'unknown_member', 'unknown_category', 'nothing_due',
      'amount_exceeds_balance', 'amount_due_unknown', 'invalid_period', 'adhera_domain_missing',
      'message_not_pending', 'campaign_already_sent', 'invalid_campaign', 'duplicate_payment',
      'idempotency_key_reused', 'payment_not_cancellable', 'reason_required',
    ],
  },
  { file: 'src/components/PaymentSheet.tsx', name: 'PROOF_CODES', keys: ['mime_not_allowed', 'file_too_large', 'upload_invalid'] },
  { file: 'src/components/PaymentSheet.tsx', name: 'RELOAD_CODES', keys: ['amount_exceeds_balance', 'nothing_due', 'amount_due_unknown'] },
];

describe('libellés par code — un code nouveau affiche le message de l’API', () => {
  for (const table of FROZEN_TABLES) {
    it(`${table.name} n’accueille aucun code nouveau`, () => {
      const keys = tableKeys(readFileSync(join(process.cwd(), table.file), 'utf8'), table.name);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.filter((k) => !table.keys.includes(k))).toEqual([]);
    });
  }

  it('contre-épreuve : un code ajouté serait vu', () => {
    const code = "const BY_CODE: Record<string, string> = {\n  nothing_due: 'x',\n  code_neuf: 'y',\n};\n";
    expect(tableKeys(code, 'BY_CODE')).toEqual(['nothing_due', 'code_neuf']);
  });
});

/**
 * F5 — un mot par chose (A11). La liste vit ICI, une seule fois : ce sont les
 * mots que le lexique d'Adhera interdit (`docs/adhera-lexique.md` côté
 * backend, résumé au §18.8 du contrat `_handoff/adhera-api-bureau.md`). On dit
 * « paiement », « enregistrer un paiement », « vérifier », « accepté » /
 * « refusé », « reste à payer » / « reste à recevoir », « à jour » / « en
 * retard », « type de membre » — et « a payé », jamais « m'a payé ».
 *
 * Elle porte sur TOUT texte affiché de `src/` : bureau, page du membre, carte,
 * vérification. Les clés, les `code` et les identifiants ne sont pas des mots
 * affichés (`'validated'`, `category_id`), et ne sont pas vus.
 */
export const LEXIQUE_BANNIS: ReadonlyArray<{ mot: string; pattern: RegExp }> = [
  // L'argent — « paiement ».
  { mot: 'versement', pattern: /(?<!\p{L})versements?(?!\p{L})/iu },
  { mot: 'règlement', pattern: /(?<!\p{L})r[èe]glements?(?!\p{L})/iu },
  { mot: 'encaissement', pattern: /(?<!\p{L})encaissements?(?!\p{L})/iu },
  // « enregistrer un paiement » : le verbe…
  { mot: 'encaisser', pattern: /(?<!\p{L})encaiss(?:er|e|es|ent|ons|ez|ait|aient|era|erai|erez|ant)(?!\p{L})/iu },
  // … et « reçu » · « payé » : le participe, nommé à part (F5-bis R3).
  { mot: 'encaissé', pattern: /(?<!\p{L})encaissé(?:e|s|es)?(?!\p{L})/iu },
  // « moyen de paiement ».
  { mot: 'mode de paiement', pattern: /(?<!\p{L})modes?\s+de\s+paiement/iu },
  { mot: 'mode de règlement', pattern: /(?<!\p{L})modes?\s+de\s+r[èe]glement/iu },
  // « Mode » ou « Moyen » SEULS, en libellé de colonne ou de champ : la phrase
  // entière est le mot (« mode de cotisation » reste un autre sujet).
  { mot: 'Mode · Moyen (seuls)', pattern: /^(?:mode|moyen)\s*:?$/iu },
  // « reçu » n'est jamais un verbe sur un bouton (défaut P3).
  { mot: 'Reçu ✓', pattern: /(?<!\p{L})reçu\s*✓/iu },
  // La décision : « vérifier », « accepté », « refusé ».
  { mot: 'valider', pattern: /(?<!\p{L})valid(?:er|ez|ons|ent)(?!\p{L})/iu },
  { mot: 'validé', pattern: /(?<!\p{L})validé(?:e|s|es)?(?!\p{L})/iu },
  { mot: 'rejeté', pattern: /(?<!\p{L})rejeté(?:e|s|es)?(?!\p{L})/iu },
  // Ce qui est dû : « reste à payer » (le membre), « reste à recevoir » (l'association).
  { mot: 'reste dû', pattern: /(?<!\p{L})restes?\s+d[ûu](?!\p{L})/iu },
  { mot: 'reste à encaisser', pattern: /(?<!\p{L})reste\s+à\s+encaisser/iu },
  { mot: 'Reste (seul)', pattern: /^restes?\s*:?$/iu },
  // L'état d'un membre : « à jour », « en retard », « type de membre ».
  { mot: 'couvert', pattern: /(?<!\p{L})couverte?s?(?!\p{L})/iu },
  { mot: 'en règle', pattern: /(?<!\p{L})en\s+règle(?!\p{L})/iu },
  { mot: 'pas à jour', pattern: /(?<!\p{L})pas\s+à\s+jour(?!\p{L})/iu },
  { mot: 'impayé', pattern: /(?<!\p{L})impayé(?:e|s|es)?(?!\p{L})/iu },
  { mot: 'catégorie', pattern: /(?<!\p{L})catégories?(?!\p{L})/iu },
  // Maquette du trésorier (P3) : le bouton dit ce que l'on a reçu, pas « m'a payé ».
  { mot: 'm’a payé', pattern: /(?<!\p{L})m[’']a\s+payé/iu },
  // Le geste : « cliquez sur », sur téléphone comme sur ordinateur (F5, après
  // le test d'Alioune). Un adverbe intercalé ne fait pas sortir de la règle :
  // « appuyez bien sur » est encore « appuyez sur ».
  { mot: 'touchez', pattern: /(?<!\p{L})touchez(?!\p{L})/iu },
  { mot: 'tapez sur', pattern: /(?<!\p{L})tapez(?:\s+\p{L}+)?\s+sur(?!\p{L})/iu },
  { mot: 'appuyez sur', pattern: /(?<!\p{L})appuyez(?:\s+\p{L}+)?\s+sur(?!\p{L})/iu },
  // F6 § 6 — « payer », jamais « régler » ni ses formes (« Réglez sur le… »).
  // « règle » (la norme) et « réglage » (les Paramètres) sont d'autres mots.
  {
    mot: 'régler',
    pattern: /(?<!\p{L})r[ée]gl(?:er|ez|é|ée|és|ées|ons|ent|ait|aient|era|erez|ant)(?!\p{L})/iu,
  },
  // L'adhésion en ligne (lexique, S5) : « demande d'adhésion », « admettre »,
  // « lien d'invitation », « personnes que vous avez fait venir ».
  { mot: 'candidature', pattern: /(?<!\p{L})candidatures?(?!\p{L})/iu },
  { mot: 'inscription', pattern: /(?<!\p{L})inscriptions?(?!\p{L})/iu },
  { mot: 'filleul', pattern: /(?<!\p{L})filleule?s?(?!\p{L})/iu },
  { mot: 'en attente de validation', pattern: /(?<!\p{L})en\s+attente\s+de\s+validation/iu },
  { mot: 'lien de parrainage', pattern: /(?<!\p{L})liens?\s+de\s+parrainage/iu },
  { mot: 'code promo', pattern: /(?<!\p{L})codes?\s+promo/iu },
];

/**
 * Les exceptions au lexique, nommées une par une : le fichier, la phrase
 * EXACTE, et la raison (adhera-lexique.md, « Le garde-fou » : jamais par
 * motif). Une exception dont la phrase a disparu de son fichier fait échouer
 * le test : elle ne reste pas en place comme un trou silencieux.
 */
export const LEXIQUE_EXCEPTIONS: ReadonlyArray<{ mot: string; file: string; text: string; raison: string }> = [
  {
    mot: 'appuyez sur',
    file: 'src/components/card/SaveCard.tsx',
    text: 'Appuyez longuement sur l’image, puis Enregistrer',
    raison:
      'Le geste d’enregistrement d’une image dans le navigateur de WhatsApp est un appui LONG : « cliquez » le ferait rater.',
  },
];

/** Les attributs JSX qui ne sont jamais lus : de la mise en forme, des adresses, des clés. */
const UNREAD_ATTRIBUTES = /^(className|href|src|id|key|type|name|role|rel|target|method|inputMode|autoComplete|htmlFor|referrerPolicy|accept|data-[\w-]+|aria-(controls|describedby|labelledby|current|live|hidden))$/;

/**
 * Les textes AFFICHABLES d'un fichier, lus par l'analyseur de TypeScript :
 * chaînes, gabarits et texte JSX — ni commentaire, ni chemin d'import, ni
 * attribut de mise en forme. Une chaîne en minuscules sans espace
 * (`'validated'`, `'not_found'`) est un code, pas un mot affiché.
 */
export function displayedTexts(code: string, fileName = 'x.tsx'): string[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const keep = (text: string) => {
    const t = text.trim();
    if (t && !/^[a-z0-9_./@:\-[\]#?=&%]*$/.test(t)) out.push(t);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isLiteralTypeNode(node)) return;
    if (ts.isJsxAttribute(node) && UNREAD_ATTRIBUTES.test(node.name.getText(source))) return;
    if (ts.isCallExpression(node) && /^(import|require)$/.test(node.expression.getText(source))) return;
    if (ts.isJsxText(node)) keep(node.text);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) keep(node.text);
    else if (ts.isTemplateExpression(node)) {
      keep([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' … '));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Les mots bannis d'un fichier, nommés : « encaisser → Encaisser ». */
export function lexiqueOffenders(code: string, fileName?: string): string[] {
  const out: string[] = [];
  // Absolu (le balayage) ou relatif (les contre-épreuves) : toujours « src/… ».
  const file = fileName ? relative(process.cwd(), fileName) : '';
  for (const text of displayedTexts(code, fileName)) {
    for (const { mot, pattern } of LEXIQUE_BANNIS) {
      if (!pattern.test(text)) continue;
      const excused = LEXIQUE_EXCEPTIONS.some((e) => e.mot === mot && e.file === file && e.text === text);
      if (!excused) out.push(`${mot} → ${text}`);
    }
  }
  return out;
}

describe('lexique — un mot par chose, dans tout texte affiché (A11)', () => {
  it('aucun fichier de src/ n’affiche un mot banni', () => {
    const offenders: string[] = [];
    let files = 0;
    for (const file of walk(SRC, ['.ts', '.tsx'])) {
      files += 1;
      for (const hit of lexiqueOffenders(readFileSync(file, 'utf8'), file)) {
        offenders.push(`${relative(process.cwd(), file)} : ${hit}`);
      }
    }
    expect(files).toBeGreaterThan(80);
    expect(offenders).toEqual([]);
  });

  it('contre-épreuve : « Encaisser » réinjecté dans un bouton est nommé', () => {
    expect(lexiqueOffenders('<Button tone="primary">Encaisser</Button>')).toEqual([
      'encaisser → Encaisser',
    ]);
    expect(lexiqueOffenders("setError('Le versement a été rejeté.');")).toEqual([
      'versement → Le versement a été rejeté.',
      'rejeté → Le versement a été rejeté.',
    ]);
    expect(lexiqueOffenders('<p>Cheikh m’a payé</p>')).toEqual(['m’a payé → Cheikh m’a payé']);
    expect(lexiqueOffenders('<span>Pas à jour</span>')).toEqual(['pas à jour → Pas à jour']);
  });

  it('contre-épreuve F5-bis : les mots ajoutés d’après adhera-lexique.md sont nommés', () => {
    expect(lexiqueOffenders('<p>Montant encaissé</p>')).toEqual(['encaissé → Montant encaissé']);
    expect(lexiqueOffenders("t('Deux paiements encaissés')")).toEqual([
      'encaissé → Deux paiements encaissés',
    ]);
    expect(lexiqueOffenders('<p>La somme encaissée</p>')).toEqual(['encaissé → La somme encaissée']);
    expect(lexiqueOffenders('<Pill>En règle</Pill>')).toEqual(['en règle → En règle']);
    expect(lexiqueOffenders('<td>Impayé</td>')).toEqual(['impayé → Impayé']);
    expect(lexiqueOffenders("label: 'Cotisations impayées'")).toEqual([
      'impayé → Cotisations impayées',
    ]);
    expect(lexiqueOffenders('<Label>Mode de paiement</Label>')).toEqual([
      'mode de paiement → Mode de paiement',
    ]);
    expect(lexiqueOffenders('<th>Mode</th><th>Reste</th>')).toEqual([
      'Mode · Moyen (seuls) → Mode',
      'Reste (seul) → Reste',
    ]);
    expect(lexiqueOffenders('<button>Reçu ✓</button>')).toEqual(['Reçu ✓ → Reçu ✓']);
  });

  it('contre-épreuve F5-bis : les mots voisins ne sont pas pris', () => {
    expect(lexiqueOffenders('<p>Le mode de cotisation de votre association</p>')).toEqual([]);
    expect(lexiqueOffenders('<Label>Moyen de paiement</Label>')).toEqual([]);
    expect(lexiqueOffenders('<p>Reste à payer</p><p>Reste à recevoir</p>')).toEqual([]);
    expect(lexiqueOffenders('<p>Une règle du bureau. Votre reçu est prêt.</p>')).toEqual([]);
  });

  it('contre-épreuve F5 : « touchez », « tapez sur » et « appuyez sur » sont nommés', () => {
    expect(lexiqueOffenders('<p>Touchez Partager en bas de l’écran</p>')).toEqual([
      'touchez → Touchez Partager en bas de l’écran',
    ]);
    expect(lexiqueOffenders("setHint('Tapez sur « Enregistrer ».')")).toEqual([
      'tapez sur → Tapez sur « Enregistrer ».',
    ]);
    expect(lexiqueOffenders('<p>Appuyez sur le bouton vert</p>')).toEqual([
      'appuyez sur → Appuyez sur le bouton vert',
    ]);
    expect(lexiqueOffenders('<p>Appuyez bien sur le bouton vert</p>')).toEqual([
      'appuyez sur → Appuyez bien sur le bouton vert',
    ]);
    // Le mot voulu, et les mots voisins, passent.
    expect(lexiqueOffenders('<p>Cliquez sur « Enregistrer ».</p>')).toEqual([]);
    expect(lexiqueOffenders("t('Retapez le nouveau mot de passe à l’identique.')")).toEqual([]);
    expect(lexiqueOffenders('<p>Ne retouchez pas le montant.</p>')).toEqual([]);
  });

  it('l’exception nommée : « Appuyez longuement sur l’image », dans SaveCard.tsx seulement', () => {
    const exception = LEXIQUE_EXCEPTIONS[0]!;
    expect(LEXIQUE_EXCEPTIONS).toHaveLength(1);
    // La phrase est bien dans son fichier : l'exception n'excuse pas un absent.
    expect(displayedTexts(readFileSync(exception.file, 'utf8'), exception.file)).toContain(exception.text);
    expect(lexiqueOffenders(`<p>${exception.text}</p>`, exception.file)).toEqual([]);
  });

  it('contre-épreuve de l’exception : ailleurs, ou une autre phrase, elle ne vaut plus', () => {
    const { text, file } = LEXIQUE_EXCEPTIONS[0]!;
    // La même phrase dans un autre fichier.
    expect(lexiqueOffenders(`<p>${text}</p>`, 'src/components/CopyButton.tsx')).toEqual([`appuyez sur → ${text}`]);
    // Une autre phrase dans le même fichier.
    expect(lexiqueOffenders('<p>Appuyez sur Enregistrer</p>', file)).toEqual([
      'appuyez sur → Appuyez sur Enregistrer',
    ]);
    // L'exception ne couvre que « appuyez sur » : un autre mot banni dans la phrase reste nommé.
    expect(lexiqueOffenders(`<p>${text} encaissée</p>`, file)).toEqual([`encaissé → ${text} encaissée`, `appuyez sur → ${text} encaissée`]);
  });

  it('contre-épreuve : une clé, un code ou un commentaire ne sont pas des mots affichés', () => {
    expect(lexiqueOffenders("if (p.status === 'validated') setCategory(category_id);")).toEqual([]);
    expect(lexiqueOffenders('// Encaisser : ancien nom du geste')).toEqual([]);
    expect(lexiqueOffenders('<Pastille>Valide</Pastille>')).toEqual([]);
    expect(lexiqueOffenders('<p>Une couverture, une découverte</p>')).toEqual([]);
  });
});

/**
 * F5-bis R3 — sur la page du membre et sur la vérification, c'est
 * L'ASSOCIATION qui agit (« L'association vérifiera votre paiement »), jamais
 * « le trésorier », ni un autre rôle du bureau (v3.8.5, D2). Les écrans du
 * bureau, eux, peuvent nommer des rôles : la liste ne vaut QUE pour les fichiers
 * que chargent `/m/[jeton]` et `/v/[code]`, suivis import par import depuis leur
 * page — un composant ajouté demain y entre sans qu'on l'écrive ici.
 */
export const ROLES_BANNIS_MEMBRE: ReadonlyArray<{ mot: string; pattern: RegExp }> = [
  { mot: 'trésorier', pattern: /(?<!\p{L})trésori(?:er|ère)s?(?!\p{L})/iu },
  { mot: 'président', pattern: /(?<!\p{L})président(?:e)?s?(?!\p{L})/iu },
  { mot: 'secrétaire', pattern: /(?<!\p{L})secrétaires?(?!\p{L})/iu },
  { mot: 'le bureau', pattern: /(?<!\p{L})bureau(?:x)?(?!\p{L})/iu },
  // Le membre lit ce qu'IL doit : « reste à payer » (adhera-lexique.md).
  { mot: 'reste à recevoir', pattern: /(?<!\p{L})reste\s+à\s+recevoir/iu },
];

export function memberRoleOffenders(code: string, fileName?: string): string[] {
  const out: string[] = [];
  for (const text of displayedTexts(code, fileName)) {
    for (const { mot, pattern } of ROLES_BANNIS_MEMBRE) {
      if (pattern.test(text)) out.push(`${mot} → ${text}`);
    }
  }
  return out;
}

/** Les fichiers de `src/` qu'une page charge, de proche en proche (`@/…` et `./…`). */
function importClosure(entries: string[]): string[] {
  const seen = new Set<string>();
  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = join(from, '..', spec);
    else return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // essai suivant
      }
    }
    return null;
  };
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const specs: string[] = [];
    const walkNode = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        // `import type` n'apporte aucun texte affiché.
        if (!(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)) specs.push(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) specs.push(arg.text);
      }
      ts.forEachChild(node, walkNode);
    };
    walkNode(source);
    for (const spec of specs) {
      const target = resolve(file, spec);
      if (target) visit(target);
    }
  };
  for (const entry of entries) visit(entry);
  return [...seen].sort();
}

describe('page du membre — l’association agit, jamais un rôle (F5-bis R3)', () => {
  const MEMBER_SURFACE = importClosure([
    join(SRC, 'app', 'm', '[token]', 'page.tsx'),
    join(SRC, 'app', 'v', '[code]', 'page.tsx'),
    // F6 — le visiteur de /adherer lit, lui aussi, ce que fait L'ASSOCIATION.
    join(SRC, 'app', 'adherer', 'page.tsx'),
  ]);
  const rel = (f: string) => relative(SRC, f);

  it('la surface suivie couvre bien la page, la feuille de paiement, la carte et la vérification — et rien du bureau', () => {
    const files = MEMBER_SURFACE.map(rel);
    for (const expected of [
      'app/m/[token]/MemberPage.tsx',
      'components/PaymentSheet.tsx',
      'components/Fallbacks.tsx',
      'components/card/SaveCard.tsx',
      'components/card/cardImage.ts',
      'app/v/[code]/VerifyPage.tsx',
      'app/adherer/JoinPage.tsx',
    ]) {
      expect(files).toContain(expected);
    }
    expect(files.filter((f) => /(^|\/)bureau\//.test(f))).toEqual([]);
  });

  it('aucun texte affiché de /m/[jeton] ni de /v/[code] ne nomme un rôle', () => {
    const offenders: string[] = [];
    for (const file of MEMBER_SURFACE) {
      for (const hit of memberRoleOffenders(readFileSync(file, 'utf8'), file)) {
        offenders.push(`${rel(file)} : ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('contre-épreuve : « le trésorier » ou « le bureau » réinjectés côté membre sont nommés', () => {
    expect(memberRoleOffenders('<p>Le trésorier vérifiera votre paiement.</p>')).toEqual([
      'trésorier → Le trésorier vérifiera votre paiement.',
    ]);
    expect(memberRoleOffenders("onNeedsReload('La trésorière va le confirmer.')")).toEqual([
      'trésorier → La trésorière va le confirmer.',
    ]);
    expect(memberRoleOffenders('<p>Contactez le bureau de votre association.</p>')).toEqual([
      'le bureau → Contactez le bureau de votre association.',
    ]);
    expect(memberRoleOffenders('<p>Reste à recevoir</p>')).toEqual([
      'reste à recevoir → Reste à recevoir',
    ]);
    // L'association, elle, agit ; un commentaire n'est pas lu.
    expect(memberRoleOffenders('<p>L’association vérifiera votre paiement.</p>')).toEqual([]);
    expect(memberRoleOffenders('// le trésorier vérifie ici')).toEqual([]);
  });

  it('contre-épreuve : la règle ne s’étend pas au bureau, qui peut nommer des rôles', () => {
    const bureau = importClosure([join(SRC, 'app', 'bureau', 'profil', 'page.tsx')]);
    expect(MEMBER_SURFACE).not.toContain(join(SRC, 'app', 'bureau', 'profil', 'page.tsx'));
    expect(bureau.map(rel)).toContain('app/bureau/profil/page.tsx');
  });
});

/**
 * F5 — « Enregistrer ma carte dans mes photos » : le code qui DESSINE la carte
 * (`cardImage.ts`) n'est chargé qu'au toucher, par `import()`. Aucun import
 * statique : il n'entre dans le premier chargement d'aucune page.
 */
describe('carte en PNG — le dessin est chargé à la demande', () => {
  const imports = (code: string) => ({
    static: /(?:from\s+|import\s+)['"][^'"]*\/cardImage['"]/.test(code),
    dynamic: /import\(\s*['"][^'"]*\/cardImage['"]\s*\)/.test(code),
  });

  it('cardImage.ts n’est importé que par SaveCard.tsx, et par import()', () => {
    const found: string[] = [];
    for (const file of walk(SRC, ['.ts', '.tsx'])) {
      const hit = imports(stripComments(readFileSync(file, 'utf8')));
      if (hit.static) found.push(`${relative(process.cwd(), file)} → statique`);
      if (hit.dynamic) found.push(`${relative(process.cwd(), file)} → import()`);
    }
    expect(found).toEqual([
      `${relative(process.cwd(), join(SRC, 'components', 'card', 'SaveCard.tsx'))} → import()`,
    ]);
  });

  it('contre-épreuve : un import statique serait vu', () => {
    expect(imports("import { drawCard } from './cardImage';").static).toBe(true);
    expect(imports("const m = await import('./cardImage');").dynamic).toBe(true);
  });

  it('« Garder sur mon téléphone » a disparu de la page du membre', () => {
    const code = stripComments(readFileSync(join(SRC, 'app', 'm', '[token]', 'MemberPage.tsx'), 'utf8'));
    expect(code).not.toMatch(/KeepOnPhone|Garder sur mon téléphone/);
    expect(code).toContain('<SaveCard');
  });
});

/**
 * F6 § 6 — les mots ajoutés d'après le lexique S5 et S6, et leurs voisins qui
 * restent justes (« réglage », « règle »).
 */
describe('lexique F6 — payer, demande d’adhésion, lien d’invitation', () => {
  it('contre-épreuve : « régler » et ses formes, candidature, inscription, filleuls sont nommés', () => {
    expect(lexiqueOffenders('<button>Régler ma cotisation</button>')).toEqual(['régler → Régler ma cotisation']);
    expect(lexiqueOffenders("t('Réglez sur le 77 123 45 67')")).toEqual(['régler → Réglez sur le 77 123 45 67']);
    expect(lexiqueOffenders('<p>Rien à régler pour l’instant.</p>')).toEqual(['régler → Rien à régler pour l’instant.']);
    expect(lexiqueOffenders('<p>Votre cotisation est réglée.</p>')).toEqual(['régler → Votre cotisation est réglée.']);
    expect(lexiqueOffenders('<h1>Votre candidature</h1>')).toEqual(['candidature → Votre candidature']);
    expect(lexiqueOffenders('<p>Inscription envoyée</p>')).toEqual(['inscription → Inscription envoyée']);
    expect(lexiqueOffenders('<p>Vos filleuls</p>')).toEqual(['filleul → Vos filleuls']);
    expect(lexiqueOffenders('<p>Votre lien de parrainage</p>')).toEqual(['lien de parrainage → Votre lien de parrainage']);
    expect(lexiqueOffenders('<p>En attente de validation</p>')).toEqual([
      'en attente de validation → En attente de validation',
    ]);
  });

  it('contre-épreuve : les mots voisins passent', () => {
    expect(lexiqueOffenders('<p>Paramètres : un réglage, une règle du bureau.</p>')).toEqual([]);
    expect(lexiqueOffenders('<p>Rien à payer pour l’instant.</p>')).toEqual([]);
    expect(lexiqueOffenders('<p>Votre demande d’adhésion. Votre lien d’invitation.</p>')).toEqual([]);
    expect(lexiqueOffenders('<p>3 personnes sont venues grâce à vous.</p>')).toEqual([]);
  });
});

/**
 * F6 § 6 et lexique S6 — sur les écrans QUI N'EXISTENT QUE POUR LES QUESTIONS,
 * on dit « question », « sorte de question », « réponses possibles » : jamais
 * « champ », « option », « rubrique », « item », « valeur », ni « type » (pris
 * par le type de membre). Ailleurs « champ » reste du bon français : la liste
 * ne vaut QUE pour ces fichiers, nommés un par un.
 */
export const QUESTION_SURFACES = [
  'src/app/bureau/questions/page.tsx',
  'src/app/bureau/questions/[id]/page.tsx',
  'src/app/bureau/questions/words.ts',
];

export const MOTS_BANNIS_QUESTIONS: ReadonlyArray<{ mot: string; pattern: RegExp }> = [
  { mot: 'champ', pattern: /(?<!\p{L})champs?(?!\p{L})/iu },
  { mot: 'option', pattern: /(?<!\p{L})options?(?!\p{L})/iu },
  { mot: 'rubrique', pattern: /(?<!\p{L})rubriques?(?!\p{L})/iu },
  { mot: 'item', pattern: /(?<!\p{L})items?(?!\p{L})/iu },
  { mot: 'valeur', pattern: /(?<!\p{L})valeurs?(?!\p{L})/iu },
  // « type de membre » est juste ; « type » d'une question ne l'est pas.
  { mot: 'type (d’une question)', pattern: /(?<!\p{L})types?(?!\p{L})(?!\s+de\s+membres?)/iu },
];

export function questionWordOffenders(code: string, fileName?: string): string[] {
  const out: string[] = [];
  for (const text of displayedTexts(code, fileName)) {
    for (const { mot, pattern } of MOTS_BANNIS_QUESTIONS) {
      if (pattern.test(text)) out.push(`${mot} → ${text}`);
    }
  }
  return out;
}

describe('les écrans des questions — question, sorte, réponses possibles (F6)', () => {
  it('les trois fichiers suivis existent', () => {
    for (const file of QUESTION_SURFACES) expect(() => statSync(file)).not.toThrow();
  });

  it('aucun texte affiché ne dit champ, option, rubrique, item, valeur ni type', () => {
    const offenders = QUESTION_SURFACES.flatMap((file) =>
      questionWordOffenders(readFileSync(file, 'utf8'), file).map((hit) => `${file} : ${hit}`),
    );
    expect(offenders).toEqual([]);
  });

  it('contre-épreuve : les mots du développeur sont nommés, « type de membre » passe', () => {
    expect(questionWordOffenders('<p>Ajoutez un champ</p>')).toEqual(['champ → Ajoutez un champ']);
    expect(questionWordOffenders('<legend>Les options</legend>')).toEqual(['option → Les options']);
    expect(questionWordOffenders('<legend>Type de question</legend>')).toEqual([
      'type (d’une question) → Type de question',
    ]);
    expect(questionWordOffenders('<p>Sous le type de membre</p>')).toEqual([]);
    expect(questionWordOffenders('<p>Les réponses possibles</p>')).toEqual([]);
  });

  it('contre-épreuve : la règle ne s’étend pas au reste du bureau, où « champ » est juste', () => {
    const memberForm = readFileSync('src/components/bureau/MemberForm.tsx', 'utf8');
    expect(QUESTION_SURFACES).not.toContain('src/components/bureau/MemberForm.tsx');
    expect(questionWordOffenders('<p>Le champ téléphone</p>', 'src/components/bureau/MemberForm.tsx')).toHaveLength(1);
    expect(typeof memberForm).toBe('string');
  });
});

/**
 * §20.7 — la vérification `/v/{code}` ne montre AUCUNE réponse : un tiers y
 * apprend l'appartenance, jamais les déclarations. Ni `lines`, ni `answers`
 * dans les fichiers qu'elle charge.
 */
describe('vérification publique — aucune réponse (F6, §20.7)', () => {
  const VERIFY = importClosure([join(SRC, 'app', 'v', '[code]', 'page.tsx')]);

  it('aucun fichier de /v/ ne lit lines ni answers, et la carte du membre n’y entre pas', () => {
    const readers = VERIFY.filter((file) => /\.tsx$/.test(file))
      .filter((file) => /\.(lines|answers)\b|\b(lines|answers)\s*[:=?]/.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(SRC, file));
    expect(readers).toEqual([]);
    expect(VERIFY.map((f) => relative(SRC, f))).not.toContain('components/card/MemberCardView.tsx');
  });

  it('contre-épreuve : la carte du membre, elle, lit card.lines', () => {
    const card = stripComments(readFileSync(join(SRC, 'components', 'card', 'MemberCardView.tsx'), 'utf8'));
    expect(/\.lines\b/.test(card)).toBe(true);
  });
});
