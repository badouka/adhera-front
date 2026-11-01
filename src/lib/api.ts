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

import type { DeclarationResult, MemberPayload, PaymentMethod } from './types';

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

async function toApiError(response: Response): Promise<ApiError> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
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

function headers(tenant: string): HeadersInit {
  return { Accept: 'application/json', 'X-Tenant-Slug': tenant };
}

/** `GET /m/{token}` — l'état du membre. */
export async function fetchMember(
  token: string,
  tenant: string,
  signal?: AbortSignal,
): Promise<MemberPayload> {
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

  return (await response.json()) as MemberPayload;
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
