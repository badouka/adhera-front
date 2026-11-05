/**
 * Accès à l'API d'EventFlow.
 *
 * R2 : tous ces appels partent du NAVIGATEUR. Le limiteur `membership-public`
 * compte 20 requêtes/min par IP ; un fetch côté serveur ferait passer tous les
 * membres derrière l'IP du VPS et le 21ᵉ de la minute prendrait un 429.
 *
 * R5 : `cache: 'no-store'` partout. Un membre qui vient de payer doit voir son
 * état réel.
 */

import type {
  DeclarationResult,
  MemberPayload,
  PaymentMethod,
  Verification,
} from './types';

export const API_BASE = 'https://api.eventflow.africa/api/v1';

/** Erreurs de champ renvoyées par un 422 Laravel. */
export type FieldErrors = Record<string, string[]>;

/**
 * R4 : le code est le contrat, jamais le message. `status` 0 signale une panne
 * réseau (aucune réponse HTTP).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly errors: FieldErrors;

  constructor(
    status: number,
    code: string | null,
    message: string,
    errors: FieldErrors = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

/**
 * Les champs refusés d'un `422`, chacun avec son PREMIER message, tel que
 * l'API l'écrit : elle parle français partout dans Adhera (« Le champ prénom
 * est obligatoire. »). Aucun écran ne traduit ni ne réécrit ces messages.
 */
export function fieldMessages(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.status !== 422) return {};
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(error.errors)) {
    const first = messages.map((m) => m.trim()).find((m) => m !== '');
    if (first) out[field] = first;
  }
  return out;
}

type ErrorBody = {
  code?: unknown;
  message?: unknown;
  errors?: unknown;
};

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

export async function toApiError(response: Response): Promise<ApiError> {
  let body: ErrorBody = {};
  try {
    const raw: unknown = await response.json();
    // Un corps `null` ou un tableau ne porte ni code ni message.
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) body = raw as ErrorBody;
  } catch {
    // Un 502 de nginx rend du HTML : on garde seulement le statut.
  }

  return new ApiError(
    response.status,
    typeof body.code === 'string' ? body.code : null,
    typeof body.message === 'string' ? body.message : response.statusText,
    readFieldErrors(body.errors),
  );
}

export function headers(tenant: string): HeadersInit {
  return { Accept: 'application/json', 'X-Tenant-Slug': tenant };
}

/**
 * Les deux en-têtes que pose le service worker de la carte (`public/m/sw.js`)
 * quand il sert, hors connexion, la dernière réponse gardée. Une réponse du
 * réseau ne les porte jamais.
 */
export const OFFLINE_HEADER = 'X-Adhera-Hors-Connexion';
export const SAVED_AT_HEADER = 'X-Adhera-Enregistre-Le';

export type MemberResult = {
  payload: MemberPayload;
  /** ISO 8601 : la réponse vient du cache, faute de réseau. Sinon `null`. */
  offlineSince: string | null;
};

/** `GET /m/{token}` — l'état du membre. */
export async function fetchMember(
  token: string,
  tenant: string,
  signal?: AbortSignal,
): Promise<MemberResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/m/${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: headers(tenant),
      cache: 'no-store',
      signal,
      referrerPolicy: 'no-referrer',
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, null, 'Réseau indisponible');
  }

  if (!response.ok) throw await toApiError(response);

  const offline = response.headers?.get(OFFLINE_HEADER) === '1';
  return {
    payload: (await response.json()) as MemberPayload,
    offlineSince: offline ? (response.headers.get(SAVED_AT_HEADER) ?? '') : null,
  };
}

export type DeclarationInput = {
  /** Entier brut : le seul nombre que le client manipule (R1). */
  amount: number;
  method: PaymentMethod;
  reference: string;
  proof: File | null;
};

/**
 * `POST /m/{token}/payments` — la déclaration de paiement du membre.
 *
 * `idempotencyKey` est celle de la feuille « J'ai payé », tirée à son
 * ouverture (§11.1) : un réessai après une coupure ne crée pas de doublon.
 */
export async function declarePayment(
  token: string,
  tenant: string,
  input: DeclarationInput,
  signal?: AbortSignal,
  idempotencyKey?: string,
): Promise<DeclarationResult> {
  const form = new FormData();
  form.set('amount', String(input.amount));
  form.set('method', input.method);
  if (input.reference.trim() !== '') form.set('reference', input.reference.trim());
  if (input.proof) form.set('proof', input.proof);

  let response: Response;
  try {
    // Pas de Content-Type manuel : le navigateur doit poser la frontière du
    // multipart lui-même.
    response = await fetch(
      `${API_BASE}/m/${encodeURIComponent(token)}/payments`,
      {
        method: 'POST',
        headers: idempotencyKey
          ? { ...headers(tenant), 'Idempotency-Key': idempotencyKey }
          : headers(tenant),
        body: form,
        cache: 'no-store',
        signal,
        referrerPolicy: 'no-referrer',
      },
    );
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, null, 'Réseau indisponible');
  }

  if (!response.ok) throw await toApiError(response);

  return (await response.json()) as DeclarationResult;
}

/**
 * L'URL de téléchargement d'un reçu.
 *
 * C'est un `<a href>`, pas un fetch : un lien ne peut pas porter d'en-tête, le
 * tenant passe donc en query. `rel="noreferrer"` est posé sur le lien (R3).
 */
export function receiptUrl(
  token: string,
  tenant: string,
  receiptId: string,
): string {
  const query = new URLSearchParams({ tenant });
  return `${API_BASE}/m/${encodeURIComponent(token)}/receipts/${encodeURIComponent(
    receiptId,
  )}?${query.toString()}`;
}

/**
 * L'URL de l'attestation du membre (§16.3) : le même mécanisme qu'un reçu, un
 * lien qui porte le tenant en query.
 */
export function attestationUrl(token: string, tenant: string): string {
  const query = new URLSearchParams({ tenant });
  return `${API_BASE}/m/${encodeURIComponent(token)}/attestation?${query.toString()}`;
}

/**
 * Avant de suivre le lien de l'attestation, on s'assure qu'il rend bien un PDF :
 * un refus (403 `not_up_to_date`, `not_a_member`, `feature_disabled`, 409
 * `issuer_missing`) s'affiche alors sur la page au lieu d'un JSON nu. La route
 * est idempotente (§16.3) : la seconde ouverture rend la même pièce.
 */
export async function checkAttestation(
  token: string,
  tenant: string,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(attestationUrl(token, tenant), {
      method: 'GET',
      headers: { ...headers(tenant), Accept: 'application/pdf, application/json' },
      cache: 'no-store',
      signal,
      referrerPolicy: 'no-referrer',
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, null, 'Réseau indisponible');
  }

  if (!response.ok) throw await toApiError(response);
  // Le corps n'est pas lu : c'est le lien, suivi ensuite, qui livre le fichier.
  await response.body?.cancel().catch(() => undefined);
}

/**
 * `GET /membership/verify/{code}` — la vérification publique (§16.5), sans
 * authentification. `attestation` est la référence portée par le QR d'un PDF.
 */
export async function fetchVerification(
  code: string,
  tenant: string,
  attestation: string | null,
  signal?: AbortSignal,
): Promise<Verification> {
  const query = attestation ? `?${new URLSearchParams({ attestation }).toString()}` : '';
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE}/membership/verify/${encodeURIComponent(code)}${query}`,
      {
        method: 'GET',
        headers: headers(tenant),
        cache: 'no-store',
        signal,
        referrerPolicy: 'no-referrer',
      },
    );
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, null, 'Réseau indisponible');
  }

  if (!response.ok) throw await toApiError(response);

  return (await response.json()) as Verification;
}
