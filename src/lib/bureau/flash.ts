/**
 * Un message d'une page à la suivante (« Rien n'a été enregistré. ») : gardé
 * en mémoire le temps d'une navigation, lu une seule fois. Rien n'est écrit
 * dans le navigateur.
 */

let pending: string | null = null;

export function setFlash(message: string): void {
  pending = message;
}

export function takeFlash(): string | null {
  const message = pending;
  pending = null;
  return message;
}
