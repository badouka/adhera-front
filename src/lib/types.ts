/**
 * Le contrat de `GET /m/{token}`, tel que le sert EventFlow en v3.5.1.
 *
 * R1 : les champs `*_formatted` sont les SEULS montants affichables. Les champs
 * numériques ne servent qu'au calcul (borne du formulaire), jamais au rendu.
 */

export type Organisation = {
  /** Peut être une chaîne vide : ne rien afficher plutôt qu'un vide. */
  name: string;
  om_merchant_number: string | null;
  wave_merchant_number: string | null;
  /** Texte libre, à rendre en TEXTE avec ses retours à la ligne, jamais en HTML. */
  payment_instructions: string | null;
};

export type Member = {
  /** Le nom seul : l'API ne sert rien d'autre. */
  name: string;
};

export type Standing = {
  is_up_to_date: boolean;
  /** `YYYY-MM-DD`, ou null. */
  covered_until: string | null;
};

export type DueStatus = 'due' | 'partielle';

export type Due = {
  /** `YYYY-MM-DD` */
  period_start: string;
  /** `YYYY-MM-DD` */
  period_end: string;
  /** Peut être null : état E5, montant pas encore fixé. */
  amount_due: number | null;
  amount_due_formatted: string | null;
  amount_paid: number;
  amount_paid_formatted: string;
  balance: number | null;
  balance_formatted: string | null;
  status: DueStatus;
};

export type PendingDeclaration = {
  amount: number;
  amount_formatted: string;
  /** ISO 8601 */
  declared_at: string;
};

export type Receipt = {
  id: string;
  reference: string;
  amount_formatted: string;
  /** ISO 8601 */
  issued_at: string;
};

export type MemberPayload = {
  organisation: Organisation;
  member: Member;
  standing: Standing;
  due: Due | null;
  pending_declaration: PendingDeclaration | null;
  receipts: Receipt[];
};

/** Les cinq modes acceptés par `POST /m/{token}/payments`. */
export type PaymentMethod = 'om' | 'wave' | 'virement' | 'cheque' | 'especes';

/** Libellés à reprendre tels quels (brief §2). */
export const PAYMENT_METHODS: ReadonlyArray<{
  value: PaymentMethod;
  label: string;
}> = [
  { value: 'om', label: 'Orange Money' },
  { value: 'wave', label: 'Wave' },
  { value: 'virement', label: 'Virement bancaire' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'especes', label: 'Espèces' },
];

/** Les modes pour lesquels `reference` est obligatoire. */
export const METHODS_REQUIRING_REFERENCE: ReadonlySet<PaymentMethod> = new Set<
  PaymentMethod
>(['om', 'wave']);

export type DeclarationResult = {
  declared: boolean;
  amount: number;
  amount_formatted: string;
  declared_at: string;
  message: string;
};

/**
 * L'état de l'écran. R4 : on branche sur le `code` de l'API, jamais sur son
 * message.
 */
export type ScreenState =
  /** E1 — lien invalide (404 member_not_found, ou hôte hors adhera.africa). */
  | { kind: 'E1' }
  /** E8 — service indisponible (403 / 409). */
  | { kind: 'E8' }
  /** E9 — erreur technique (429, 5xx, réseau). */
  | { kind: 'E9'; rateLimited: boolean }
  /** Chargement en cours. */
  | { kind: 'loading' }
  /** Charge utile obtenue : l'état précis se déduit par `resolveMemberState`. */
  | { kind: 'ready'; payload: MemberPayload };

/** Les états déduits d'une charge utile valide. */
export type MemberState = 'E2' | 'E3' | 'E3b' | 'E4' | 'E5' | 'E6';
