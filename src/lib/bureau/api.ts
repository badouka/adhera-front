/**
 * Le client HTTP UNIQUE de l'espace bureau.
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

import { API_BASE, ApiError, type FieldErrors } from '../api';
import {
  clearSession,
  currentTenant,
  expireSession,
  getSession,
  loginHref,
  navigation,
} from './session';
import type {
  Campaign,
  CampaignInput,
  Category,
  CategoryInput,
  Contact,
  ContactInput,
  Dashboard,
  DirectPaymentInput,
  LaunchedCampaign,
  LeftReason,
  LoginData,
  MemberDetail,
  MemberFilters,
  MemberInput,
  MemberLink,
  MemberListItem,
  OutreachDecision,
  OutreachItem,
  Payment,
  PaymentFilterStatus,
  ProofUrl,
  Settings,
  SettingsInput,
  WhatsappMessage,
} from './types';

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
 * ⚠️ En production, l'en-tête n'est PAS lisible depuis le navigateur : l'API
 * ne l'expose pas en CORS (`Access-Control-Expose-Headers` absent, constaté le
 * 2026-10-30). Le repli ne sert donc que si nginx l'expose un jour.
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // Un 502 de nginx rend du HTML ; un 204 ne rend rien.
    return null;
  }
}

async function toError(response: Response): Promise<BureauApiError> {
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

function networkError(cause: unknown): never {
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
 * ⚠️ L'API n'expose pas cet en-tête en CORS (constaté le 2026-11-01) : dans le
 * navigateur il est presque toujours illisible, et l'écran compose le nom.
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

/* ───────────────────────────── Réglages ───────────────────────────── */

export function getSettings(signal?: AbortSignal) {
  return request<Settings>('membership/settings', { signal });
}

export function updateSettings(input: SettingsInput) {
  return request<Settings>('membership/settings', { method: 'PUT', json: input });
}

export function uploadLogo(file: File) {
  const form = new FormData();
  form.set('logo', file);
  return request<Settings>('membership/settings/logo', { method: 'POST', form });
}

export function deleteLogo() {
  return request<Settings>('membership/settings/logo', { method: 'DELETE' });
}

/* ──────────────────────────── Catégories ──────────────────────────── */

export function listCategories(signal?: AbortSignal) {
  return request<Category[]>('membership/categories', { signal });
}

export function createCategory(input: CategoryInput) {
  return request<Category>('membership/categories', { method: 'POST', json: input });
}

export function updateCategory(
  id: number,
  input: Partial<CategoryInput> & { is_active?: boolean },
) {
  return request<Category>(`membership/categories/${id}`, {
    method: 'PUT',
    json: input,
  });
}

export function deleteCategory(id: number) {
  return request<{ deleted: boolean }>(`membership/categories/${id}`, {
    method: 'DELETE',
  });
}

/* ────────────────────────────── Membres ───────────────────────────── */

const seg = encodeURIComponent;

export function listMembers(filters: MemberFilters, signal?: AbortSignal) {
  return request<MemberListItem[]>('membership/members', {
    query: { ...filters },
    signal,
  });
}

export function getMember(id: string, signal?: AbortSignal) {
  return request<MemberDetail>(`membership/members/${seg(id)}`, { signal });
}

export function createMember(input: MemberInput) {
  return request<MemberDetail>('membership/members', { method: 'POST', json: input });
}

export function updateMember(id: string, input: MemberInput) {
  return request<MemberDetail>(`membership/members/${seg(id)}`, {
    method: 'PUT',
    json: input,
  });
}

export function leaveMember(id: string, leftAt: string, reason: LeftReason) {
  // Le champ s'appelle bien `left_reason` : un `reason` est rejeté en 422.
  return request<MemberDetail>(`membership/members/${seg(id)}/leave`, {
    method: 'POST',
    json: { left_at: leftAt, left_reason: reason },
  });
}

export function getMemberLink(id: string, signal?: AbortSignal) {
  return request<MemberLink>(`membership/members/${seg(id)}/link`, { signal });
}

export function rotateMemberLink(id: string) {
  return request<MemberLink>(`membership/members/${seg(id)}/link/rotate`, {
    method: 'POST',
  });
}

export function getWhatsapp(id: string, signal?: AbortSignal) {
  return request<WhatsappMessage>(`membership/members/${seg(id)}/whatsapp`, {
    signal,
  });
}

export function createContact(memberId: string, input: ContactInput) {
  return request<Contact>(`membership/members/${seg(memberId)}/contacts`, {
    method: 'POST',
    json: input,
  });
}

export function deleteContact(memberId: string, contactId: string) {
  return request<{ deleted: boolean }>(
    `membership/members/${seg(memberId)}/contacts/${seg(contactId)}`,
    { method: 'DELETE' },
  );
}

/* ───────────────────────────── Versements ─────────────────────────── */

export function listPayments(
  filters: { status?: PaymentFilterStatus; member_id?: string },
  signal?: AbortSignal,
) {
  return request<Payment[]>('membership/payments', { query: filters, signal });
}

export function validatePayment(id: string, paidOn: string) {
  return request<Payment>(`membership/payments/${seg(id)}/validate`, {
    method: 'POST',
    json: { paid_on: paidOn },
  });
}

export function rejectPayment(id: string, reason: string) {
  return request<Payment>(`membership/payments/${seg(id)}/reject`, {
    method: 'POST',
    json: { reason },
  });
}

/**
 * Un lien signé, valable 60 minutes : à demander AU CLIC (§6). La clé servie
 * est `download_url` ; à défaut on prend le premier champ qui est une adresse
 * https — sans jamais la retoucher, toute modification invalide la signature.
 * Depuis v3.5.7 le fichier s'ouvre dans l'onglet (`inline`).
 */
export async function getProofUrl(id: string): Promise<string> {
  const body = await request<ProofUrl | Record<string, unknown> | null>(
    `membership/payments/${seg(id)}/proof-url`,
  );
  if (body && typeof body === 'object') {
    const values = [body.download_url, body.url, ...Object.values(body)];
    for (const value of values) {
      if (typeof value === 'string' && value.startsWith('https://')) return value;
    }
  }
  throw new BureauApiError(200, null, 'Lien de la capture absent');
}

/**
 * La saisie directe : enregistrée ET validée, sur la période de `payableDue()`.
 *
 * `idempotencyKey` est la clé du PANNEAU (§11.1) : la même tant que l'envoi
 * n'a pas réussi. Un rejeu rend `201` et le versement d'origine ; un contenu
 * différent sous la même clé, `422 idempotency_key_reused` ; un doublon sans
 * clé, `409 duplicate_payment`.
 */
export function createDirectPayment(
  memberId: string,
  input: DirectPaymentInput,
  idempotencyKey?: string,
) {
  const json: Record<string, unknown> = {
    amount: input.amount,
    method: input.method,
    paid_on: input.paid_on,
  };
  if (input.reference) json.reference = input.reference;
  return request<Payment>(`membership/members/${seg(memberId)}/payments`, {
    method: 'POST',
    json,
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
}

/**
 * Annuler un encaissement VALIDÉ (§11.3). Motif de 10 caractères au moins,
 * espaces de bord non comptées. Rien n'est supprimé ; un `declared` se
 * REJETTE, il ne s'annule pas.
 */
export function cancelPayment(id: string, reason: string) {
  return request<Payment>(`membership/payments/${seg(id)}/cancel`, {
    method: 'POST',
    json: { reason },
  });
}

/* ──────────────────────────── Pièces émises ───────────────────────── */

/**
 * `GET membership/documents/{id}/pdf`. La route exige le Bearer : un simple
 * `<a href>` ne peut pas le porter, on tire donc le PDF en blob.
 */
export function fetchDocument(id: string) {
  return request<Blob>(`membership/documents/${seg(id)}/pdf`, { as: 'blob' });
}

/* ─────────────────────── Tableau de bord et exports ───────────────── */

/** Bornes `YYYY-MM-DD` incluses ; absentes = du 1er janvier à aujourd'hui. */
export type PeriodQuery = { from?: string | null; to?: string | null };

export function getDashboard(period: PeriodQuery, signal?: AbortSignal) {
  return request<Dashboard>('membership/dashboard', { query: period, signal });
}

/** Le registre en Excel (§10) : des BLOBS, jamais du JSON (piège 29). */
export function downloadMembersExport() {
  return request<DownloadedFile>('membership/exports/members.xlsx', { as: 'file' });
}

export function downloadPaymentsExport(period: PeriodQuery) {
  return request<DownloadedFile>('membership/exports/payments.xlsx', {
    query: period,
    as: 'file',
  });
}

/* ─────────────────────── Relances et campagnes (§9) ───────────────── */

/**
 * La file WhatsApp, la plus urgente d'abord. Elle peut RÉTRÉCIR d'un appel à
 * l'autre (un membre qui a réglé est écarté) ; son ordre est celui du serveur.
 */
export function listOutreach(signal?: AbortSignal) {
  return request<OutreachItem[]>('membership/outreach', { signal });
}

/** Une DÉCLARATION du bureau : le produit ne sait pas si le message est parti. */
export function markOutreachSent(id: string) {
  return request<OutreachDecision>(`membership/outreach/${seg(id)}/sent`, { method: 'POST' });
}

export function skipOutreach(id: string, reason: string) {
  return request<OutreachDecision>(`membership/outreach/${seg(id)}/skip`, {
    method: 'POST',
    json: { reason },
  });
}

export function listCampaigns(signal?: AbortSignal) {
  return request<Campaign[]>('membership/campaigns', { signal });
}

export function createCampaign(input: CampaignInput) {
  const json: Record<string, unknown> = { segment: input.segment, send_email: input.send_email };
  if (input.scheduled_at) json.scheduled_at = input.scheduled_at;
  return request<LaunchedCampaign>('membership/campaigns', { method: 'POST', json });
}

/** `422 campaign_already_sent` : le cron l'a lancée entre-temps — recharger. */
export function cancelCampaign(id: string) {
  return request<Campaign>(`membership/campaigns/${seg(id)}/cancel`, { method: 'POST' });
}

/** Le seul moyen d'arrêter le rapport du lundi (§10). */
export function setWeeklyReport(enabled: boolean) {
  return request<Settings>('membership/settings', {
    method: 'PUT',
    json: { weekly_report_enabled: enabled },
  });
}
