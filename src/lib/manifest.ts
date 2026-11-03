/**
 * Le manifeste de la carte d'un membre (F4 § 1.4).
 *
 * R2 : le serveur Next ne lit PAS l'API pour le composer. Le nom de
 * l'association et son logo voyagent dans l'adresse du manifeste, posée par la
 * page une fois la carte chargée dans le navigateur : un fetch côté serveur
 * ferait passer chaque membre derrière l'IP du VPS (limiteur
 * `membership-public`, 20 / min / IP), et Chrome relit le manifeste à chaque
 * ouverture de la page.
 */

import { API_BASE } from './api';

export const MANIFEST_FALLBACK_NAME = 'Ma carte de membre';
export const MANIFEST_SHORT_NAME = 'Ma carte';

/** L'icône de carte neutre, sans marque, servie par l'app (`public/carte/`). */
export const NEUTRAL_ICONS = [
  { src: '/carte/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/carte/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
] as const;

/** Un jeton de membre plausible : rien d'autre ne compose une adresse. */
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function isPlausibleToken(token: string): boolean {
  return TOKEN.test(token);
}

/** Le logo n'est accepté que s'il vient de l'API (même règle que la CSP). */
const LOGO_ORIGIN = new URL(API_BASE).origin;

/**
 * L'adresse servie par l'API, TELLE QUELLE, si elle vient bien de l'API ; sinon
 * `null`. Elle est seulement contrôlée, jamais recomposée ni normalisée.
 */
export function safeLogoUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.origin !== LOGO_ORIGIN || url.protocol !== 'https:') return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * L'image de l'écran d'accueil (manifeste et apple-touch-icon) : `icon_url`,
 * l'icône carrée du serveur ; à défaut (`null`, ou absente d'un serveur plus
 * ancien), `logo_url`. Les deux adresses passent telles que l'API les sert.
 */
export function homeIconUrl(
  iconUrl: string | null | undefined,
  logoUrl: string | null | undefined,
): string | null {
  return iconUrl ? safeLogoUrl(iconUrl) : safeLogoUrl(logoUrl);
}

function logoType(url: string): string {
  return /\.jpe?g$/i.test(new URL(url).pathname) ? 'image/jpeg' : 'image/png';
}

export function memberPath(token: string): string {
  return `/m/${encodeURIComponent(token)}`;
}

/**
 * L'adresse du manifeste, telle que la page la pose dans `<head>`. `icon` est
 * l'image de l'écran d'accueil (`homeIconUrl`) ; elle voyage sous `?logo=`,
 * le nom que lisent déjà les manifestes des cartes installées.
 */
export function manifestHref(
  token: string,
  organisationName: string,
  icon: string | null,
): string {
  const query = new URLSearchParams();
  const name = organisationName.trim();
  if (name) query.set('nom', name);
  const logo = safeLogoUrl(icon);
  if (logo) query.set('logo', logo);
  const qs = query.toString();
  return `${memberPath(token)}/manifest.webmanifest${qs ? `?${qs}` : ''}`;
}

export type CardManifest = {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  lang: 'fr';
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
};

export function buildManifest(
  token: string,
  name: string | null,
  logo: string | null,
): CardManifest {
  const path = memberPath(token);
  const safeLogo = safeLogoUrl(logo);
  // Le nom est borné : il s'affiche sous l'icône et dans la liste des apps.
  const label = (name ?? '').trim().slice(0, 120);
  return {
    id: path,
    name: label || MANIFEST_FALLBACK_NAME,
    short_name: MANIFEST_SHORT_NAME,
    start_url: `${path}?vue=carte`,
    // Le préfixe de la page du membre : `?vue=carte` y est compris.
    scope: path,
    display: 'standalone',
    lang: 'fr',
    // Les couleurs de la page (tokens.css : --surface-raised, --surface).
    background_color: 'white',
    theme_color: 'white',
    icons: safeLogo
      ? [{ src: safeLogo, sizes: '512x512', type: logoType(safeLogo), purpose: 'any' }]
      : NEUTRAL_ICONS.map((icon) => ({ ...icon })),
  };
}
