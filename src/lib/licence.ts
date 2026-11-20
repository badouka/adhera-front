/**
 * B11 (F7) — la licence de l'association : les quatre refus de
 * `CheckTenantTrial` portent enfin `code` (§23.4). Trois d'entre eux arrêtent
 * le service : on BRANCHE sur le code, jamais sur le message.
 *
 * ⚠️ Exception à la règle « afficher le message de l'API », décidée par Alioune
 * le 2026-11-20 : le message servi (« Votre licence a expiré. Renouvelez pour
 * réactiver votre espace. ») ne dit ni à qui écrire ni, côté membre, qu'il
 * s'adresse au bureau. Ces phrases ne sont PAS une entrée de `BY_CODE`, qui
 * reste gelé : elles font un écran à part, suivi des contacts d'Adhera côté
 * bureau.
 *
 * Le comportement de fond (ce qui reste ouvert quand la licence est échue)
 * viendra avec S10 : ce module ne corrige que ce que l'écran dit.
 */

import { ApiError } from './api';

export type LicenceCode = 'license_expired' | 'trial_expired' | 'tenant_inactive';

const LICENCE_CODES: ReadonlyArray<string> = ['license_expired', 'trial_expired', 'tenant_inactive'];

/** Le code de licence d'un refus, ou `null`. Le message n'est jamais lu. */
export function licenceCode(error: unknown): LicenceCode | null {
  if (!(error instanceof ApiError) || error.code === null) return null;
  return LICENCE_CODES.includes(error.code) ? (error.code as LicenceCode) : null;
}

/** L'espace du bureau : une phrase par code, chacune suivie des contacts d'Adhera. */
export const BUREAU_LICENCE_TEXT: Record<LicenceCode, string> = {
  license_expired: 'La licence de votre association a expiré. Pour la renouveler, écrivez à Adhera.',
  trial_expired: 'La période d’essai de votre association est terminée. Pour continuer, écrivez à Adhera.',
  tenant_inactive: 'L’espace de votre association est suspendu. Pour en savoir plus, écrivez à Adhera.',
};

/**
 * La page du membre, la vérification d'une carte et « Adhérer » : la même
 * phrase pour toute réponse 403 (licence comprise). C'est l'association qui
 * parle au membre : jamais Adhera, jamais la licence.
 */
export const MEMBER_UNAVAILABLE_TEXT = 'Ce service est momentanément indisponible. Contactez votre association.';
