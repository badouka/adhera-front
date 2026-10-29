/**
 * Le contrat de l'API bureau, recopié de `_handoff/adhera-api-bureau.md`
 * (v3.5.6-adhera-recus-bureau).
 *
 * R1 : les champs `*_formatted` sont les SEULS montants affichables. Les champs
 * numériques ne servent qu'au calcul (borne d'un formulaire), jamais au rendu.
 */

import type { PaymentMethod } from '../types';

export type { PaymentMethod } from '../types';

/* ───────────────────────── Authentification ───────────────────────── */

/** `admin.role` : le serveur ne le lit pour RIEN décider (§2, E6). */
export type AdminRole =
  | 'president'
  | 'tresorier'
  | 'secretaire'
  | 'membre_bureau'
  | 'super_admin';

export type Admin = {
  id: number;
  name: string;
  email: string;
  role: AdminRole | string;
};

/** `POST /admin/login` → `data` de l'enveloppe EventFlow. */
export type LoginData = {
  token: string;
  admin: Admin;
};

/* ───────────────────────────── Réglages ───────────────────────────── */

export type MemberTypes = 'personnes' | 'organisations' | 'mixte';
export type ModeCotisation = 'anniversaire' | 'exercice_civil';

export type Settings = {
  issuer_name: string | null;
  /** Versionnée par son contenu : jamais en dur, jamais recomposée (§3). */
  logo_url: string | null;
  member_types: MemberTypes;
  mode_cotisation: ModeCotisation;
  om_merchant_number: string | null;
  wave_merchant_number: string | null;
  /** Texte libre, rendu en TEXTE, jamais en HTML. 5 000 caractères. */
  payment_instructions: string | null;
  timezone: string | null;
  metadata: unknown;
  /** À lire avant tout affichage de cotisation (§3). */
  mode_is_supported: boolean;
};

/** Les seuls champs que `PUT settings` laisse modifier depuis F2. */
export type SettingsInput = {
  issuer_name: string;
  om_merchant_number: string | null;
  wave_merchant_number: string | null;
  payment_instructions: string | null;
};

/* ──────────────────────────── Catégories ──────────────────────────── */

export type CategoryMode = 'forfait' | 'bareme' | 'exonere' | 'minimum';

export type Category = {
  id: number;
  label: string;
  mode: CategoryMode;
  amount: number | null;
  amount_formatted: string | null;
  sort_order: number;
  is_active: boolean;
  /** Faux : le produit ne sait pas dériver un montant (§4). */
  is_calculable: boolean;
};

export type CategoryInput = {
  label: string;
  mode: Exclude<CategoryMode, 'bareme'>;
  amount: number | null;
  sort_order: number;
};

/* ────────────────────────────── Membres ───────────────────────────── */

export type MemberType = 'personne' | 'organisation';
export type MemberStatus = 'active' | 'former' | 'pending';
export type LeftReason = 'resigned' | 'struck_off' | 'deceased' | 'other';

export type MemberListItem = {
  id: string;
  type: MemberType;
  name: string;
  phone: string | null;
  email: string | null;
  region: string | null;
  category_id: number | null;
  category_label: string | null;
  /** `YYYY-MM-DD` */
  joined_at: string | null;
  status: MemberStatus;
  left_at: string | null;
  left_reason: LeftReason | null;
  is_up_to_date: boolean;
  covered_until: string | null;
  next_due_date: string | null;
  /** `null` = INCONNU, jamais « rien à payer » (§5, piège 4). */
  balance_due: number | null;
  balance_due_formatted: string | null;
};

export type DueStatus = 'due' | 'partielle' | 'reglee' | 'exoneree';

/** Un reçu d'une période : le montant est celui du VERSEMENT (§5). */
export type DueReceipt = {
  id: string;
  reference: string;
  /** ISO 8601 */
  issued_at: string;
  amount_formatted: string;
};

export type MemberDue = {
  id: string;
  period_start: string;
  /** INCLUSIVE (décision D1). */
  period_end: string;
  due_date: string | null;
  status: DueStatus;
  origin: string | null;
  amount_due: number | null;
  amount_due_formatted: string | null;
  amount_paid: number | null;
  amount_paid_formatted: string | null;
  balance_due: number | null;
  balance_due_formatted: string | null;
  settled_at: string | null;
  /** Le plus récent d'abord (v3.5.6). */
  receipts: DueReceipt[];
  receipt_available: boolean;
};

export type ContactRole = 'principal' | 'billing' | 'delegate';

export type Contact = {
  id: string;
  member_id: string;
  name: string;
  role_title: string | null;
  phone: string | null;
  email: string | null;
  role: ContactRole;
};

export type ContactInput = {
  name: string;
  role: ContactRole;
  role_title: string | null;
  phone: string | null;
  email: string | null;
};

export type MemberDetail = MemberListItem & {
  contacts: Contact[];
  dues: MemberDue[];
};

export type MemberInput = {
  type: MemberType;
  name: string;
  phone: string | null;
  email: string | null;
  region: string | null;
  category_id: number | null;
  joined_at: string | null;
};

export type MemberFilters = {
  status?: MemberStatus | '';
  standing?: 'up_to_date' | 'not_up_to_date' | '';
  type?: MemberType | '';
  category_id?: number | '';
  search?: string;
};

export type MemberLink = {
  url: string;
  rotated_at: string | null;
};

export type WhatsappMessage = {
  /** Porte des U+00A0 voulus : ne JAMAIS normaliser (§5). */
  message: string;
  /**
   * `null` quand le membre n'a pas de numéro mobile utilisable (pas de
   * téléphone, ou un fixe). Absent du contrat v3.5.6, constaté sur demo-asso.
   */
  wa_url: string | null;
  phone_is_usable?: boolean;
};

/* ───────────────────────────── Versements ─────────────────────────── */

export type PaymentStatus = 'declared' | 'validated' | 'rejected';

/** `all` est un mot du FILTRE, jamais une valeur stockée (piège 14). */
export type PaymentFilterStatus = PaymentStatus | 'all';

export type PaymentDue = {
  period_start: string;
  period_end: string;
  status: DueStatus;
  [key: string]: unknown;
};

export type Payment = {
  id: string;
  due_id: string | null;
  member_id: string;
  member_name: string;
  amount: number;
  amount_formatted: string;
  method: PaymentMethod;
  method_label: string;
  reference: string | null;
  /** `YYYY-MM-DD` */
  paid_on: string | null;
  status: PaymentStatus;
  declared_at: string | null;
  decided_at: string | null;
  decided_by_user_id: number | null;
  decided_by_name: string | null;
  rejection_reason: string | null;
  has_proof: boolean;
  /** Le reçu émis POUR CE VERSEMENT, ou null (§6). */
  receipt: { id: string; reference: string } | null;
  due: PaymentDue | null;
};

export type DirectPaymentInput = {
  amount: number;
  method: PaymentMethod;
  paid_on: string;
  reference: string | null;
};

export type ProofUrl = { url: string };

/* ───────────────────────────── Libellés ───────────────────────────── */

export const LEFT_REASONS: ReadonlyArray<{ value: LeftReason; label: string }> = [
  { value: 'resigned', label: 'Démission' },
  { value: 'struck_off', label: 'Radiation' },
  { value: 'deceased', label: 'Décès' },
  { value: 'other', label: 'Autre' },
];

export const CATEGORY_MODES: Record<CategoryMode, string> = {
  forfait: 'Forfait',
  minimum: 'Montant minimum',
  exonere: 'Exonéré',
  bareme: 'Barème',
};

export const CONTACT_ROLES: ReadonlyArray<{ value: ContactRole; label: string }> = [
  { value: 'principal', label: 'Contact principal' },
  { value: 'billing', label: 'Facturation' },
  { value: 'delegate', label: 'Délégué' },
];

export const MEMBER_TYPES_LABELS: Record<MemberTypes, string> = {
  personnes: 'Personnes',
  organisations: 'Organisations',
  mixte: 'Personnes et organisations',
};

export const MODE_COTISATION_LABELS: Record<ModeCotisation, string> = {
  anniversaire: 'À la date anniversaire d’adhésion',
  exercice_civil: 'Par exercice civil',
};

export const DUE_STATUS_LABELS: Record<DueStatus, string> = {
  due: 'À régler',
  partielle: 'Partielle',
  reglee: 'Réglée',
  exoneree: 'Exonérée',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  declared: 'À valider',
  validated: 'Validé',
  rejected: 'Rejeté',
};
