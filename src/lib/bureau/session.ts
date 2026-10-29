/**
 * La session du bureau.
 *
 * R7 : le jeton vit en MÉMOIRE, doublé en `sessionStorage` pour survivre à un
 * rechargement de l'onglet — et nulle part ailleurs. Ni stockage persistant du
 * navigateur, ni cookie lisible : ce jeton valide des paiements et émet des
 * reçus au nom de l'association pendant 7 jours ; `sessionStorage` le borne à
 * l'onglet, et il meurt avec lui.
 */

import { resolveTenant, tenantFromHost, isValidSlug } from '../tenant';
import type { Admin } from './types';

const KEY = 'adhera.bureau.session';

export type BureauSession = {
  token: string;
  /** L'association pour laquelle le jeton a été émis. */
  tenant: string;
  admin: Admin;
};

/** `undefined` : pas encore relu depuis `sessionStorage`. */
let memory: BureauSession | null | undefined;

const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Navigation privée stricte, ou stockage désactivé : la mémoire suffit.
    return null;
  }
}

function isSession(value: unknown): value is BureauSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const admin = v.admin as Record<string, unknown> | null | undefined;
  return (
    typeof v.token === 'string' &&
    v.token !== '' &&
    typeof v.tenant === 'string' &&
    isValidSlug(v.tenant) &&
    !!admin &&
    typeof admin === 'object' &&
    typeof admin.name === 'string'
  );
}

function load(): BureauSession | null {
  if (memory !== undefined) return memory;

  memory = null;
  const raw = storage()?.getItem(KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isSession(parsed)) memory = parsed;
      else storage()?.removeItem(KEY);
    } catch {
      storage()?.removeItem(KEY);
    }
  }
  return memory;
}

function emit() {
  for (const listener of listeners) listener();
}

/**
 * La session courante, ou null. Un jeton émis pour une AUTRE association que
 * celle de l'hôte est purgé sur-le-champ : il ne doit jamais partir vers un
 * tenant qui ne l'a pas émis.
 */
export function getSession(tenant?: string | null): BureauSession | null {
  const session = load();
  if (session && tenant && session.tenant !== tenant) {
    clearSession();
    return null;
  }
  return session;
}

export function saveSession(session: BureauSession): void {
  memory = session;
  try {
    storage()?.setItem(KEY, JSON.stringify(session));
  } catch {
    // Quota ou stockage refusé : la session tient en mémoire pour cet onglet.
  }
  emit();
}

/** Purge le jeton, en mémoire ET dans `sessionStorage`. */
export function clearSession(): void {
  memory = null;
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Rien à faire : la mémoire est déjà vidée.
  }
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Pour les tests : oublie l'état relu, comme un nouvel onglet. */
export function resetSessionCache(): void {
  memory = undefined;
}

/**
 * Le tenant de l'espace bureau. En production, seul le nom d'hôte fait foi
 * (`src/lib/tenant.ts`, inchangé). En développement local, `?tenant=` ne
 * survit pas aux liens internes : on retombe alors sur celui de la session.
 */
export function currentTenant(
  location: Pick<Location, 'hostname' | 'search'> = window.location,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): string | null {
  const resolved = resolveTenant(location, isProduction);
  if (resolved) return resolved;
  if (isProduction) return null;
  return load()?.tenant ?? null;
}

/**
 * La navigation hors de React. Un objet plutôt qu'une fonction : les tests
 * remplacent `replace` sans toucher `window.location`, que jsdom ne sait pas
 * suivre.
 */
export const navigation = {
  replace(url: string): void {
    window.location.replace(url);
  },
};

/**
 * L'adresse de la page de connexion. Hors du sous-domaine (développement
 * local), le tenant doit voyager dans l'URL, puisque la session est purgée.
 */
export function loginHref(expired: boolean, tenant: string | null): string {
  const query = new URLSearchParams();
  if (expired) query.set('session', 'expiree');
  if (
    tenant &&
    typeof window !== 'undefined' &&
    !tenantFromHost(window.location.hostname)
  ) {
    query.set('tenant', tenant);
  }
  const qs = query.toString();
  return `/bureau/connexion${qs ? `?${qs}` : ''}`;
}

/**
 * `401` sur n'importe quelle route : le jeton est mort (7 jours écoulés,
 * `--reset`, `--deactivate`). On le purge et on renvoie à la connexion avec
 * « Votre session a expiré ».
 */
export function expireSession(tenant: string | null = currentTenant()): void {
  clearSession();
  navigation.replace(loginHref(true, tenant));
}
