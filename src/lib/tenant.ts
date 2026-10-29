/**
 * Résolution du tenant.
 *
 * Le backend résout l'association par l'en-tête `X-Tenant-Slug`, dont la valeur
 * est le sous-domaine : `demo-asso.adhera.africa` → `demo-asso`.
 */

const ROOT_DOMAIN = 'adhera.africa';

/** Le slug doit être validé avant d'être envoyé dans un en-tête. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** Hôtes de développement local autorisés à passer `?tenant=`. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug);
}

/**
 * Extrait le slug d'un nom d'hôte. Un seul niveau de sous-domaine est accepté :
 * `a.b.adhera.africa` et le domaine nu `adhera.africa` rendent null, comme tout
 * autre domaine.
 */
export function tenantFromHost(hostname: string): string | null {
  if (!hostname) return null;

  // Retirer un port éventuel et normaliser la casse.
  const host = hostname.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');

  const suffix = `.${ROOT_DOMAIN}`;
  if (!host.endsWith(suffix)) return null;

  const slug = host.slice(0, -suffix.length);
  // Un sous-domaine imbriqué (a.b) n'est pas un tenant.
  if (slug.includes('.')) return null;

  return isValidSlug(slug) ? slug : null;
}

/**
 * Le tenant du navigateur courant. En développement local uniquement, `?tenant=`
 * prend le relais : en production, seul le nom d'hôte fait foi.
 */
export function resolveTenant(
  location: Pick<Location, 'hostname' | 'search'>,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): string | null {
  const fromHost = tenantFromHost(location.hostname);
  if (fromHost) return fromHost;

  if (!isProduction && LOCAL_HOSTS.has(location.hostname.toLowerCase())) {
    const param = new URLSearchParams(location.search).get('tenant');
    if (param && isValidSlug(param.toLowerCase())) return param.toLowerCase();
  }

  return null;
}
