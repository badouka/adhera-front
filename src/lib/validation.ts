/**
 * Validation côté client, AVANT l'envoi (brief §2). La réponse du serveur reste
 * l'autorité : ces contrôles évitent un aller-retour, ils ne le remplacent pas.
 */

import type { PaymentMethod } from './types';

/** 10 Mo, comme `max:10240` (Ko) côté Laravel. */
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;

export const ALLOWED_PROOF_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/**
 * Certains navigateurs Android rendent un `type` vide pour un fichier pris à
 * l'appareil photo : on retombe alors sur l'extension.
 */
const ALLOWED_PROOF_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

export const PROOF_ACCEPT = ALLOWED_PROOF_TYPES.join(',');

export const MAX_REFERENCE_LENGTH = 255;

export type DeclarationDraft = {
  /** La saisie brute du champ montant. */
  amount: string;
  method: PaymentMethod;
  reference: string;
  proof: File | null;
};

export type DeclarationErrors = Partial<
  Record<'amount' | 'method' | 'reference' | 'proof', string>
>;

/**
 * La saisie du montant → un entier. Les espaces (y compris insécables, qu'un
 * copier-coller de « 250 000 FCFA » apporte) sont tolérés ; rien d'autre.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[\s  ]/g, '');
  if (cleaned === '' || !/^\d+$/.test(cleaned)) return null;

  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

export function proofError(file: File): string | null {
  const name = file.name.toLowerCase();
  const typeOk =
    (ALLOWED_PROOF_TYPES as readonly string[]).includes(file.type) ||
    (file.type === '' && ALLOWED_PROOF_EXTENSIONS.some((e) => name.endsWith(e)));

  if (!typeOk) {
    return 'La capture doit être une image JPG, PNG ou WebP, ou un PDF.';
  }
  if (file.size > MAX_PROOF_BYTES) {
    return 'La capture ne doit pas dépasser 10 Mo.';
  }
  return null;
}

/**
 * @param balance `due.balance` — la borne haute du montant déclarable.
 */
export function validateDeclaration(
  draft: DeclarationDraft,
  balance: number | null,
): DeclarationErrors {
  const errors: DeclarationErrors = {};

  const amount = parseAmount(draft.amount);
  if (amount === null) {
    errors.amount = 'Indiquez le montant que vous avez payé, en chiffres.';
  } else if (amount < 1) {
    errors.amount = 'Le montant doit être supérieur à zéro.';
  } else if (balance !== null && amount > balance) {
    errors.amount = 'Le montant ne peut pas dépasser ce qui reste à payer.';
  }

  // v3.5.7 : la référence n'est plus exigée d'aucun mode.
  const reference = draft.reference.trim();
  if (reference.length > MAX_REFERENCE_LENGTH) {
    errors.reference = 'La référence ne doit pas dépasser 255 caractères.';
  }

  if (draft.proof) {
    const message = proofError(draft.proof);
    if (message) errors.proof = message;
  }

  return errors;
}

export function hasErrors(errors: DeclarationErrors): boolean {
  return Object.keys(errors).length > 0;
}
