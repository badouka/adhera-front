/**
 * §23.7 (S9) — l'élision des phrases composées À L'ÉCRAN avec un nom : « la
 * fiche d'Aminata Diop », « de Moussa », « qu'Ousmane ». Le serveur élide
 * déjà les siennes (`qu'Amicale`) ; celles-ci sont les nôtres.
 *
 * La règle du contrat : `de` → `d’` et `que` → `qu’` devant une voyelle ET
 * devant un h. Le « y » n'élide pas (« de Yacine ») : il se prononce consonne
 * dans les prénoms d'ici.
 *
 * ⚠️ Aucun article devant le nom d'une association : « au CAP », « à
 * l'ATSAR » ne se devinent pas. Ces fonctions ne servent qu'aux noms de
 * personnes et aux phrases où le nom suit directement `de` ou `que`.
 */

const ELIDING = /^[aeiouhàâäéèêëîïôöùûüœæ]/i;

/** Vrai si `de` ou `que` s'élide devant ce mot. */
export function elides(next: string): boolean {
  return ELIDING.test(next.trim());
}

/** « d’Aminata Diop », « de Moussa Camara ». */
export function deName(name: string): string {
  const text = name.trim();
  return elides(text) ? `d’${text}` : `de ${text}`;
}

/** « qu’Ousmane », « que Fatou ». */
export function queName(name: string): string {
  const text = name.trim();
  return elides(text) ? `qu’${text}` : `que ${text}`;
}
