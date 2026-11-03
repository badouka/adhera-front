/**
 * Les petits mots de l'espace simplifié (F5). Aucun montant ici (R1) : des
 * nombres de PERSONNES, et le prénom.
 */

/** « 1 membre », « 8 membres » ; 0 reste au singulier en français. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/**
 * Le prénom du membre, pour s'adresser à lui ou parler de lui (« Cheikh a
 * payé ») : l'API ne connaît pas le genre, le prénom remplace « il » et
 * « elle ». Une organisation, ou une fiche sans prénom, garde son nom entier.
 */
export function firstName(member: { first_name?: string | null; name: string }): string {
  return member.first_name?.trim() || member.name.trim();
}

/** « en espèces », « par Wave », « par virement » : le moyen dans une phrase. */
export function methodPhrase(method: string, label: string): string {
  if (method === 'especes') return 'en espèces';
  if (method === 'virement') return 'par virement';
  if (method === 'cheque') return 'par chèque';
  return `par ${label}`;
}
