/**
 * L'UNIQUE exception à R1 (brief étape 1, § D).
 *
 * Un montant servi par l'API s'affiche toujours depuis son `*_formatted`. Mais
 * la SAISIE de l'utilisateur n'a pas encore de version servie : la réafficher
 * formatée dans le récapitulatif, avant l'envoi, fait sauter aux yeux un zéro
 * de trop (« 2 500 000 FCFA » se lit, « 2500000 » non).
 *
 * Seuls les composants de saisie de montant ont le droit de l'importer :
 * `tests/guards.test.ts` tient la liste blanche.
 */

const GROUPS = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/**
 * 250000 → « 250 000 FCFA ». `fr-FR` sépare les milliers par une espace fine
 * insécable ; le serveur, par une espace ordinaire (contrat § 9, piège 3). On
 * s'aligne sur le serveur, pour que la saisie et le montant servi s'écrivent
 * pareil. Les montants ne se coupent pas pour autant : `.money` est `nowrap`.
 */
export function formatTypedAmount(n: number): string {
  return `${GROUPS.format(n).replace(/[  ]/g, ' ')} FCFA`;
}
