/**
 * Petits libellés partagés par les écrans du bureau. Aucun montant ici (R1) :
 * seulement des dates (via `formatDate` / `formatDateTime` de F1) et des mots.
 */

import { formatDate, formatDateTime, todayInDakar } from '@/lib/dates';
import { ApiError } from '@/lib/api';

/** « du 1er octobre 2026 au 30 septembre 2027 », ou '' si une borne manque. */
export function periodLabel(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const from = formatDate(start);
  const to = formatDate(end);
  return from && to ? `du ${from} au ${to}` : '';
}

/** « Validé le 29 octobre 2026 par Trésorier Démo ». */
export function decisionLabel(
  verb: string,
  decidedAt: string | null,
  decidedBy: string | null,
): string {
  const when = formatDateTime(decidedAt);
  const by = decidedBy?.trim();
  return [verb, when ? `le ${when}` : '', by ? `par ${by}` : '']
    .filter(Boolean)
    .join(' ');
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Une date saisie : bien formée et pas dans le futur (à Dakar). */
export function dateError(value: string, label = 'la date'): string | null {
  if (!DATE_ONLY.test(value) || formatDate(value) === '') {
    return `Indiquez ${label}.`;
  }
  if (value > todayInDakar()) return 'La date ne peut pas être dans le futur.';
  return null;
}

/** Vrai si l'erreur dit que le mode de cotisation n'est pas calculable. */
export function isModeUnsupported(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'cotisation_mode_unsupported';
}
