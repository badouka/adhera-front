/**
 * Connexion, déconnexion, mot de passe et profil (§2, §14, §18.7).
 */

import { ADMIN_BASE, BureauApiError, INVALID_CREDENTIALS, networkError, readJson, request, toError } from './core';
import { clearSession, currentTenant, getSession } from '../session';
import type { LoginData, Me } from '../types';

/* ──────────────────────────── Connexion ──────────────────────────── */

type Envelope<T> = { success?: unknown; message?: unknown; data?: T | null };

/**
 * `POST /admin/login` — enveloppe EventFlow `{ success, message, data }`.
 * Son `401` n'est PAS une session expirée : c'est un refus d'identifiants,
 * volontairement identique pour un e-mail inconnu, un mot de passe faux et un
 * compte désactivé.
 */
export async function login(
  tenant: string,
  email: string,
  password: string,
  signal?: AbortSignal,
): Promise<LoginData> {
  let response: Response;
  try {
    response = await fetch(`${ADMIN_BASE}/login`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Tenant-Slug': tenant,
      },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
      signal,
      referrerPolicy: 'no-referrer',
    });
  } catch (cause) {
    networkError(cause);
  }

  if (response.status === 401) {
    throw new BureauApiError(401, INVALID_CREDENTIALS, 'Invalid credentials.');
  }
  if (!response.ok) throw await toError(response);

  const envelope = (await readJson(response)) as Envelope<LoginData> | null;
  const data = envelope?.data;
  if (
    !envelope ||
    envelope.success !== true ||
    !data ||
    typeof data.token !== 'string' ||
    !data.admin
  ) {
    throw new BureauApiError(response.status, null, 'Réponse inattendue');
  }
  return data;
}

/**
 * `POST /admin/logout` — révoque le jeton. La purge locale a lieu QUOI QU'IL
 * ARRIVE : un réseau coupé ne doit pas laisser un jeton vivant dans l'onglet.
 */
export async function logout(): Promise<void> {
  const tenant = currentTenant();
  const session = tenant ? getSession(tenant) : null;
  try {
    if (tenant && session) {
      await fetch(`${ADMIN_BASE}/logout`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'X-Tenant-Slug': tenant,
          Authorization: `Bearer ${session.token}`,
        },
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
    }
  } catch {
    // Le jeton expirera de lui-même ; la purge locale suffit pour cet onglet.
  } finally {
    clearSession();
  }
}

/* ───────────────────────── Mon mot de passe ───────────────────────── */

export type PasswordChange = {
  current_password: string;
  password: string;
  password_confirmation: string;
};

/**
 * `PUT /admin/me/password` (S3e). Le jeton de CET onglet reste valide : la
 * session courante reste ouverte, les autres appareils devront se reconnecter.
 * Un `422` porte, par champ, des messages que l'écran affiche TELS QUELS.
 */
export async function changePassword(input: PasswordChange): Promise<void> {
  await request<unknown>('me/password', {
    method: 'PUT',
    json: {
      current_password: input.current_password,
      password: input.password,
      password_confirmation: input.password_confirmation,
    },
  });
}

/* ──────────────────────────── Mon profil ──────────────────────────── */

/**
 * `GET /admin/me` (§18.7) — route PARTAGÉE avec EventFlow, sans enveloppe.
 * Le nom et `role_label` de l'en-tête viennent d'ici.
 */
export function getMe(signal?: AbortSignal) {
  return request<Me>('me', { signal });
}

/**
 * `PUT /admin/me` — le NOM et rien d'autre : `email` et `role` seraient ignorés
 * par le serveur, ils ne partent donc pas. Un `422` porte `errors.name`, en
 * français, affichable tel quel.
 */
export function updateMe(name: string) {
  return request<Me & { message?: string }>('me', { method: 'PUT', json: { name } });
}
