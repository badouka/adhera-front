// Le poids de chaque page : la somme des scripts que son HTML référence,
// compressés en Brotli (qualité 11) — ce que nginx envoie au téléphone.
//
//   node scripts/poids.mjs <origine> [hôte]
//   node scripts/poids.mjs http://127.0.0.1:3012 demo-asso.adhera.africa
//
// Plafond : 180 Ko par page (F5-bis). Le « socle » est la part commune à TOUTES
// les pages (React et Next : aucun fichier de src/) ; « application » est ce
// que la page ajoute au-dessus. Code de sortie 1 si une page dépasse.
import { brotliCompressSync, constants } from 'node:zlib';

const PLAFOND_KO = 180;
const [origin, host] = process.argv.slice(2);
if (!origin) {
  console.error('usage : node scripts/poids.mjs <origine> [hôte]');
  process.exit(2);
}
const T = 'a'.repeat(64);
const PAGES = [
  '/', `/m/${T}`, '/v/CODEINVENTE',
  '/bureau/connexion', '/bureau', '/bureau/a-verifier', '/bureau/enregistrer',
  '/bureau/membres', '/bureau/membres/m1', '/bureau/membres/nouveau', '/bureau/plus',
  '/bureau/a-envoyer', '/bureau/campagnes', '/bureau/demandes', '/bureau/anciens',
  '/bureau/paiements', '/bureau/chiffres', '/bureau/types-de-membres',
  '/bureau/reglages', '/bureau/profil', '/bureau/mon-mot-de-passe',
];
const headers = host ? { Host: host } : {};
const sizes = new Map();
const br = async (src) => {
  if (!sizes.has(src)) {
    const buf = Buffer.from(await (await fetch(new URL(src, origin).href, { headers })).arrayBuffer());
    sizes.set(src, brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length);
  }
  return sizes.get(src);
};

const pages = [];
for (const page of PAGES) {
  const html = await (await fetch(origin + page, { headers })).text();
  const srcs = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]))];
  let total = 0;
  for (const src of srcs) total += await br(src);
  pages.push({ page: page.replace(T, '[jeton]'), srcs: new Set(srcs), total });
}
const common = [...pages[0].srcs].filter((s) => pages.every((p) => p.srcs.has(s)));
let socle = 0;
for (const src of common) socle += await br(src);

const ko = (n) => (n / 1024).toFixed(1).replace('.', ',');
console.log(`socle React + Next, commun aux ${pages.length} pages : ${ko(socle)} Ko (${common.length} scripts)`);
console.log('page'.padEnd(28), 'total'.padStart(7), 'appli'.padStart(7));
let over = 0;
for (const { page, total } of pages) {
  const flag = total > PLAFOND_KO * 1024 ? `  > ${PLAFOND_KO} Ko` : '';
  if (flag) over += 1;
  console.log(page.padEnd(28), ko(total).padStart(7), ko(total - socle).padStart(7), flag);
}
console.log(over ? `${over} page(s) au-dessus de ${PLAFOND_KO} Ko` : `toutes les pages ≤ ${PLAFOND_KO} Ko`);
process.exit(over ? 1 : 0);
