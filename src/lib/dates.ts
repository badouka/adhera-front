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

/* ─────────────── Formats courts de l'espace bureau (F3) ─────────────── */

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/** Sans point : douze étiquettes tiennent sous un graphique de 328 px. */
const MONTH_SHORT = [
  'janv', 'févr', 'mars', 'avr', 'mai', 'juin',
  'juil', 'août', 'sept', 'oct', 'nov', 'déc',
];

function parts(value: string | null | undefined): [number, number, number] | null {
  if (!value || formatDate(value) === '') return null;
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2027-01-12` → « 12/01/2027 ». */
export function formatShortDate(value: string | null | undefined): string {
  const p = parts(value);
  return p ? `${pad(p[2])}/${pad(p[1])}/${p[0]}` : '';
}

/** `2027-01-02` → « 2 janvier » (« 1er » le premier du mois). */
export function formatDayMonth(value: string | null | undefined): string {
  const p = parts(value);
  if (!p) return '';
  return `${p[2] === 1 ? '1er' : p[2]} ${MONTH_NAMES[p[1] - 1]}`;
}

/** `2026-07` → « juil », l'étiquette sous une barre du graphique. */
export function shortMonth(month: string): string {
  const m = /^\d{4}-(\d{2})$/.exec(month);
  return m ? (MONTH_SHORT[Number(m[1]) - 1] ?? month) : month;
}

/** Nombre de jours de `from` à `to` (`YYYY-MM-DD`), négatif si `to` est passé. */
export function daysBetween(from: string, to: string): number | null {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000);
}

/** Le 1er du mois, `months` mois avant celui de `day` (`YYYY-MM-DD`). */
export function firstOfMonthBefore(day: string, months: number): string {
  const p = parts(day);
  if (!p) return day;
  const d = new Date(Date.UTC(p[0], p[1] - 1 - months, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}

/** Le lendemain de `day` (`YYYY-MM-DD`). */
export function nextDay(day: string): string {
  const p = parts(day);
  if (!p) return day;
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Un fuseau IANA valide, ou celui de Dakar. */
export function safeTimeZone(zone: string | null | undefined): string {
  if (zone) {
    try {
      new Intl.DateTimeFormat('fr-FR', { timeZone: zone });
      return zone;
    } catch {
      // Fuseau inconnu du navigateur : on retombe sur Dakar.
    }
  }
  return 'Africa/Dakar';
}

/** Les champs d'un instant lus dans un fuseau : date `YYYY-MM-DD` et heure `HH:MM`. */
export function zonedParts(
  value: string | Date | null | undefined,
  zone: string,
): { date: string; time: string } | null {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const fields: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(zone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)) {
    fields[part.type] = part.value;
  }
  return {
    date: `${fields.year}-${fields.month}-${fields.day}`,
    time: `${fields.hour}:${fields.minute}`,
  };
}

/**
 * Une date et une heure saisies DANS le fuseau de l'association → l'instant
 * ISO 8601 (UTC) que le serveur reçoit. Deux passes suffisent, changement
 * d'heure compris.
 */
export function zonedToIso(date: string, time: string, zone: string): string | null {
  const d = parts(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const wall = Date.UTC(d[0], d[1] - 1, d[2], Number(t[1]), Number(t[2]));
  let guess = wall;
  for (let i = 0; i < 2; i += 1) {
    const seen = zonedParts(new Date(guess), zone);
    if (!seen) return null;
    const sd = parts(seen.date);
    const st = /^(\d{2}):(\d{2})$/.exec(seen.time);
    if (!sd || !st) return null;
    const seenWall = Date.UTC(sd[0], sd[1] - 1, sd[2], Number(st[1]), Number(st[2]));
    guess += wall - seenWall;
  }
  return new Date(guess).toISOString();
}
