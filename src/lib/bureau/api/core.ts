/**
 * Le client HTTP UNIQUE de l'espace bureau — le noyau : `request`, les erreurs
 * et les codes posés par le client. Les routes vivent à côté, un fichier par
 * domaine (F6 § 7) : un écran ne charge que les routes qu'il appelle, et le
 * cadre commun du bureau (`BureauFrame`) ne tire que la session, les réglages
 * et le compteur des paiements à vérifier.
 *
 * Chaque appel pose `Authorization`, `X-Tenant-Slug`, `Accept:
 * application/json` et `cache: 'no-store'` (R5), et part du navigateur.
 *
 * ⚠️ Deux enveloppes (contrat §1, piège 1) :
 * - `POST /admin/login` répond `{ success, message, data }` ;
 * - `admin/membership/*` répond SANS enveloppe : la charge est au premier
 *   niveau, une liste est un tableau nu.
 *
 * R7 : un `401` sur n'importe quelle route (hors connexion) purge le jeton et
 * renvoie à `/bureau/connexion` avec « Votre session a expiré ».
 */

import { API_BASE, ApiError, type FieldErrors } from '../../api';
import {
  currentTenant,
  expireSession,
  getSession,
  loginHref,
  navigation,
} from '../session';

export const ADMIN_BASE = `${API_BASE}/admin`;
export const MEMBERSHIP_BASE = `${ADMIN_BASE}/membership`;

/**
 * R4 : le code est le contrat. `body` garde la charge d'erreur entière, pour
 * les refus qui disent POURQUOI (`category_in_use` porte `members` et `dues`).
 */
export class BureauApiError extends ApiError {
  readonly body: Record<string, unknown>;
  /** Le délai d'un `429`, en secondes, s'il a été servi (corps ou en-tête). */
  readonly retryAfter: number | null;

  constructor(
    status: number,
    code: string | null,
    message: string,
    errors: FieldErrors = {},
    body: Record<string, unknown> = {},
    retryAfter: number | null = null,
  ) {
    super(status, code, message, errors);
    this.name = 'BureauApiError';
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

/**
 * Le délai d'un `429`, en secondes : `retry_after` du corps d'abord (ce que le
 * contrat destine à l'écran, §2), l'en-tête `Retry-After` à défaut.
 *
 * L'en-tête est exposé en CORS depuis S3d (`Access-Control-Expose-Headers:
 * Content-Disposition, Retry-After`, vérifié le 2026-11-01) : c'est lui qui
 * donne son délai réel au `429` du limiteur par IP, dont le corps est muet.
 */
export function readRetryAfter(
  body: Record<string, unknown>,
  headers: Headers | undefined,
  now: number = Date.now(),
): number | null {
  const fromBody = body.retry_after;
  if (typeof fromBody === 'number' && Number.isFinite(fromBody) && fromBody >= 0) {
    return fromBody;
  }
  const raw = headers?.get('Retry-After')?.trim();
  if (!raw) return null;
  // Des secondes, ou une date HTTP (RFC 9110).
  if (/^\d+$/.test(raw)) return Number(raw);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - now) / 1000));
}

/** Codes posés par ce client lui-même, jamais par le serveur. */
export const SESSION_EXPIRED = 'session_expired';
export const SESSION_MISSING = 'session_missing';
export const TENANT_MISSING = 'tenant_missing';
export const INVALID_CREDENTIALS = 'invalid_credentials';

/** Vrai si l'erreur a déjà déclenché le retour à la connexion. */
export function isSessionError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === SESSION_EXPIRED || error.code === SESSION_MISSING)
  );
}

function readFieldErrors(raw: unknown): FieldErrors {
  if (!raw || typeof raw !== 'object') return {};
  const out: FieldErrors = {};
  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      const messages = value.filter((m): m is string => typeof m === 'string');
      if (messages.length > 0) out[field] = messages;
    } else if (typeof value === 'string') {
      out[field] = [value];
    }
  }
  return out;
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // Un 502 de nginx rend du HTML ; un 204 ne rend rien.
    return null;
  }
}

export async function toError(response: Response): Promise<BureauApiError> {
  const raw = await readJson(response);
  const body =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  return new BureauApiError(
    response.status,
    typeof body.code === 'string' ? body.code : null,
    typeof body.message === 'string' ? body.message : response.statusText,
    readFieldErrors(body.errors),
    body,
    response.status === 429 ? readRetryAfter(body, response.headers) : null,
  );
}

export function networkError(cause: unknown): never {
  if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
  throw new BureauApiError(0, null, 'Réseau indisponible');
}

type Query = Record<string, string | number | null | undefined>;

/** Une valeur vide vaut « absent » pour l'API (§5) : on ne l'envoie pas. */
export function buildQuery(query: Query | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text !== '') params.set(key, text);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Query;
  json?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  as?: 'json' | 'blob' | 'file';
};

/** Un fichier téléchargé : le nom vient du `Content-Disposition`, s'il est lisible. */
export type DownloadedFile = { blob: Blob; filename: string | null };

/**
 * Le nom d'un `Content-Disposition: attachment; filename="…"` (ou `filename*`).
 * Exposé en CORS depuis S3d : le fichier porte le nom que le serveur lui donne,
 * et l'écran ne compose un nom que si l'en-tête manque.
 */
export function filenameFromDisposition(value: string | null | undefined): string | null {
  if (!value) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(value);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // On retombe sur `filename=`.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(value);
  return plain?.[1]?.trim() || null;
}

/**
 * Une route authentifiée. `path` est relatif à `/api/v1/admin`.
 * La réponse est lue NUE : c'est l'enveloppe de `admin/membership/*`.
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const tenant = currentTenant();
  if (!tenant) {
    throw new BureauApiError(0, TENANT_MISSING, 'Association introuvable');
  }

  const session = getSession(tenant);
  if (!session) {
    navigation.replace(loginHref(false, tenant));
    throw new BureauApiError(401, SESSION_MISSING, 'Non connecté');
  }

  const headers: Record<string, string> = {
    ...options.headers,
    Accept: 'application/json',
    'X-Tenant-Slug': tenant,
    Authorization: `Bearer ${session.token}`,
  };

  let body: BodyInit | undefined;
  if (options.form) {
    // Pas de Content-Type : le navigateur pose la frontière du multipart.
    body = options.form;
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }

  let response: Response;
  try {
    response = await fetch(`${ADMIN_BASE}/${path}${buildQuery(options.query)}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      cache: 'no-store',
      signal: options.signal,
      referrerPolicy: 'no-referrer',
    });
  } catch (cause) {
    networkError(cause);
  }

  if (response.status === 401) {
    // À CHAQUE 401, même tombés à plusieurs en parallèle : la purge ne doit
    // jamais dépendre de l'ordre d'arrivée. Rediriger deux fois vers la même
    // adresse est sans effet.
    expireSession(tenant);
    throw new BureauApiError(401, SESSION_EXPIRED, 'Votre session a expiré');
  }

  if (!response.ok) throw await toError(response);

  if (options.as === 'blob') return (await response.blob()) as T;
  if (options.as === 'file') {
    const file: DownloadedFile = {
      blob: await response.blob(),
      filename: filenameFromDisposition(response.headers?.get('Content-Disposition')),
    };
    return file as T;
  }
  return (await readJson(response)) as T;
}
