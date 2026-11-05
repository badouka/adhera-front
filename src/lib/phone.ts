/**
 * F6 § 6 — un téléphone se LIT espacé (« 76 123 45 67 ») et se COPIE en
 * chiffres seuls (« 761234567 »), pour être collé tel quel dans Wave, Orange
 * Money ou le clavier du téléphone.
 *
 * Seules deux formes sont reconnues : le numéro sénégalais à 9 chiffres, et le
 * même précédé de l'indicatif 221 (`+221`, `00221` ou `221`). Toute autre
 * forme — un numéro étranger, un fixe mal saisi — s'affiche telle que la fiche
 * la porte : on n'invente pas un découpage qu'on ne connaît pas.
 */

/** Les chiffres seuls, sans espace, sans point, sans « + ». */
export function phoneDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

function groupLocal(nine: string): string {
  return `${nine.slice(0, 2)} ${nine.slice(2, 5)} ${nine.slice(5, 7)} ${nine.slice(7, 9)}`;
}

/** « 77 123 45 67 », « +221 77 123 45 67 », ou le texte d'origine rogné. */
export function spacedPhone(raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  if (!/^[+\d\s.\-()]+$/.test(text)) return text;
  const digits = phoneDigits(text);
  if (digits.length === 9) return groupLocal(digits);
  const international = /^(?:00)?221(\d{9})$/.exec(digits);
  if (international?.[1]) return `+221 ${groupLocal(international[1])}`;
  return text;
}

/**
 * Le numéro pour `wa.me` (indicatif compris, sans « + ») : un numéro à
 * 9 chiffres est sénégalais. `null` si la forme n'est pas reconnue — on ne
 * devine pas un indicatif.
 */
export function whatsappNumber(raw: string | null | undefined): string | null {
  const digits = phoneDigits(raw);
  if (digits.length === 9) return `221${digits}`;
  const international = /^(?:00)?(221\d{9})$/.exec(digits);
  if (international?.[1]) return international[1];
  // Un numéro étranger saisi avec son indicatif (« +33 6 12 34 56 78 »).
  if ((raw ?? '').trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return digits;
  return null;
}
