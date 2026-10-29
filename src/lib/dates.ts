/**
 * Formatage des dates.
 *
 * ⚠️ Une chaîne `YYYY-MM-DD` passée à `new Date()` est interprétée en UTC, puis
 * `toLocaleDateString` la rend dans le fuseau du téléphone : à Los Angeles, le
 * 13 mars s'affiche le 12. On construit donc la date en UTC et on formate en
 * forçant `timeZone: 'UTC'`.
 */

const MONTHS_UTC = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const DAKAR = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Dakar',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** « 1 avril 2026 » → « 1er avril 2026 ». */
function frenchOrdinal(formatted: string): string {
  return formatted.replace(/^1(?=\s)/, '1er');
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Une date de période (`YYYY-MM-DD`) → « 13 mars 2027 ».
 * Rend une chaîne vide si l'entrée n'est pas exploitable, pour ne jamais
 * afficher « Invalid Date » à un membre.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';

  const match = DATE_ONLY.exec(value);
  if (!match) return '';

  const [, year, month, day] = match;
  const stamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(stamp)) return '';

  const date = new Date(stamp);
  // Date.UTC accepte le 32 février ; on vérifie qu'elle n'a pas glissé.
  if (date.getUTCMonth() !== Number(month) - 1) return '';

  return frenchOrdinal(MONTHS_UTC.format(date));
}

/**
 * Un horodatage ISO 8601 (déclaration, reçu) → « 12 novembre 2026 », lu dans le
 * fuseau de l'association (Africa/Dakar), pas celui du téléphone.
 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return frenchOrdinal(DAKAR.format(date));
}

/**
 * La date du jour à Dakar, en `YYYY-MM-DD`, pour comparer une fin de période
 * sans dépendre du fuseau du téléphone.
 */
export function todayInDakar(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Dakar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts;
}

/** Vrai si `periodEnd` (`YYYY-MM-DD`) est strictement passée. */
export function isPast(periodEnd: string | null | undefined, now?: Date): boolean {
  if (!periodEnd || !DATE_ONLY.test(periodEnd)) return false;
  return periodEnd < todayInDakar(now);
}
