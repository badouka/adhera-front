/**
 * Les paiements : vérifier, refuser, enregistrer, annuler (§6, §11, §18).
 */

import { BureauApiError, request } from './core';
import type { DirectPaymentInput, Payment, PaymentFilterStatus, PaymentWithShare, ProofUrl, RejectInput } from '../types';

const seg = encodeURIComponent;

/* ───────────────────────────── Versements ─────────────────────────── */

export function listPayments(
  filters: { status?: PaymentFilterStatus; member_id?: string },
  signal?: AbortSignal,
) {
  return request<Payment[]>('membership/payments', { query: filters, signal });
}

/**
 * « J'ai bien reçu cet argent ». `paid_on` est facultatif : sans lui, le
 * serveur garde la date que le membre a signalée. `409 possible_duplicate`
 * (§18.1) si un paiement identique est déjà enregistré ce jour-là ;
 * `confirmDuplicate` est la RÉPONSE du trésorier à cette question, jamais un
 * défaut.
 */
export function validatePayment(
  id: string,
  options: { paidOn?: string | null; confirmDuplicate?: boolean } = {},
) {
  const json: Record<string, unknown> = {};
  if (options.paidOn) json.paid_on = options.paidOn;
  if (options.confirmDuplicate) json.confirm_duplicate = true;
  return request<PaymentWithShare>(`membership/payments/${seg(id)}/validate`, {
    method: 'POST',
    json,
  });
}

/**
 * Refuser (§18.4) : une raison toute prête (`reason_code`), dont le SERVEUR
 * compose la phrase que le membre lira, ou un texte libre de 10 caractères.
 * La réponse porte `share`, le message WhatsApp du refus.
 */
export function rejectPayment(id: string, input: RejectInput | string) {
  const json = typeof input === 'string' ? { reason: input } : input;
  return request<PaymentWithShare>(`membership/payments/${seg(id)}/reject`, {
    method: 'POST',
    json,
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
 * clé, `409 duplicate_payment`. Le même paiement saisi deux fois le même jour,
 * avec ou sans clé, `409 possible_duplicate` (§18.1) : on le rejoue avec
 * `confirmDuplicate` ET une clé neuve (même clé, autre corps : refusé).
 */
export function createDirectPayment(
  memberId: string,
  input: DirectPaymentInput,
  idempotencyKey?: string,
  options: { confirmDuplicate?: boolean } = {},
) {
  const json: Record<string, unknown> = {
    amount: input.amount,
    method: input.method,
    paid_on: input.paid_on,
  };
  if (input.reference) json.reference = input.reference;
  // §18.1 : la réponse « Non, il a payé deux fois », jamais posée par défaut.
  if (options.confirmDuplicate) json.confirm_duplicate = true;
  return request<PaymentWithShare>(`membership/members/${seg(memberId)}/payments`, {
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
