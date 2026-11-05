import { ApiError } from '../api';
import { BureauApiError } from './api/core';
import type { ExistingPayment } from './types';

/**
 * §18.1 — `409 possible_duplicate` : un paiement identique (membre, montant,
 * moyen, date) est déjà enregistré ce jour-là. La charge porte `existing`, que
 * l'écran montre à côté de la saisie pour poser LA question.
 */
export function possibleDuplicate(error: unknown): ExistingPayment | null {
  if (!(error instanceof ApiError) || error.code !== 'possible_duplicate') return null;
  const raw = error instanceof BureauApiError ? error.body.existing : null;
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.amount_formatted !== 'string' || typeof e.method_label !== 'string') return null;
  return {
    payment_id: typeof e.payment_id === 'string' ? e.payment_id : '',
    amount: typeof e.amount === 'number' ? e.amount : 0,
    amount_formatted: e.amount_formatted,
    method_label: e.method_label,
    recorded_at: typeof e.recorded_at === 'string' ? e.recorded_at : '',
    receipt_reference: typeof e.receipt_reference === 'string' ? e.receipt_reference : null,
  };
}
