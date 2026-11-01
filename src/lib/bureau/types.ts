/**
 * Le contrat de l'API bureau, recopié de `_handoff/adhera-api-bureau.md`
 * (v3.7.3-adhera-S3d : relances §9, tableau de bord §10, encaissements §11,
 * arriérés §12).
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

/**
 * Ce que l'association réclame (§12.1) : l'année en cours seulement (défaut),
 * ou toutes les années impayées. Change la LECTURE, jamais les données.
 */
export type ArrearsPolicy = 'current_only' | 'all';
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
  /**
   * Le rapport du lundi au président et au trésorier (§10). `true` par défaut ;
   * absent d'un serveur antérieur à v3.7.1, lu alors comme `true`.
   */
  weekly_report_enabled?: boolean;
  /** §12.1 — absent d'un serveur antérieur à S3d, lu alors comme le défaut. */
  arrears_policy?: ArrearsPolicy;
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
  /**
   * Le libellé d'affichage — et le seul qu'on affiche : « Prénom Nom » dérivé
   * pour une personne, raison sociale saisie pour une organisation (v3.5.7).
   */
  name: string;
  /**
   * Pour le FORMULAIRE seulement. `null` pour une organisation, et possible
   * sur une fiche ancienne dont la reprise n'a pas su découper le nom.
   */
  first_name?: string | null;
  last_name?: string | null;
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
  /**
   * Renseigné si le versement a été annulé (§11.4) : le reçu reste listé.
   * Toujours présent sur la fiche du bureau depuis S3d (§12.4), `null` sinon.
   */
  cancelled_at: string | null;
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
  /**
   * §12.3 — une période `due` / `partielle` que la politique d'arriérés écarte :
   * visible, jamais réclamée, hors du reste à payer. Toujours `false` sous `all`.
   * Absent d'un serveur antérieur à S3d, lu alors comme `false`.
   */
  is_unclaimed_arrears?: boolean;
};

export type ContactRole = 'principal' | 'billing' | 'delegate';

export type Contact = {
  id: string;
  member_id: string;
  /** Dérivé de `first_name` + `last_name` : c'est lui qu'on affiche. */
  name: string;
  /** Nullables en base : la reprise a pu laisser un prénom vide. */
  first_name?: string | null;
  last_name?: string | null;
  role_title: string | null;
  phone: string | null;
  email: string | null;
  role: ContactRole;
};

/** Un contact est une personne : prénom et nom sont REQUIS (v3.5.7). */
export type ContactInput = {
  first_name: string;
  last_name: string;
  role: ContactRole;
  role_title: string | null;
  phone: string | null;
  email: string | null;
};

export type MemberDetail = MemberListItem & {
  contacts: Contact[];
  dues: MemberDue[];
};

/**
 * Le nom dépend du type (v3.5.7) : `first_name` + `last_name` pour une
 * personne (son `name` est dérivé, et ignoré s'il est envoyé), `name` pour une
 * organisation (ses `first_name` / `last_name` sont REFUSÉS).
 */
export type MemberInput = {
  type: MemberType;
  first_name?: string;
  last_name?: string;
  name?: string;
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

export type PaymentStatus = 'declared' | 'validated' | 'rejected' | 'cancelled';

/** `all` est un mot du FILTRE, jamais une valeur stockée (piège 14). */
export type PaymentFilterStatus = Exclude<PaymentStatus, 'cancelled'> | 'all';

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
  /** L'annulation d'un encaissement validé (§11.3) : rien n'est supprimé. */
  cancelled_at?: string | null;
  cancelled_by_user_id?: number | null;
  cancelled_by_name?: string | null;
  cancel_reason?: string | null;
};

export type DirectPaymentInput = {
  amount: number;
  method: PaymentMethod;
  paid_on: string;
  reference: string | null;
};

export type ProofUrl = {
  download_url: string;
  expires_in_minutes?: number;
  original_name?: string;
  mime_type?: string;
  size?: number;
  /** Ancienne clé supposée par F2 : gardée en repli. */
  url?: string;
};

/* ─────────────────────── Tableau de bord (§10) ─────────────────────── */

export type Dashboard = {
  /** Bornes INCLUSES, `YYYY-MM-DD`. */
  period: { from: string; to: string };
  members: {
    /** `active = up_to_date + not_up_to_date`, toujours. */
    active: number;
    /** Un exonéré y est compté. */
    up_to_date: number;
    not_up_to_date: number;
    pending: number;
    former: number;
  };
  money: {
    /** Versements VALIDÉS, datés par leur paiement, sur la fenêtre. */
    collected: number;
    collected_formatted: string;
    /** SIGNALÉS : jamais additionnés à l'encaissé, non bornés par la fenêtre. */
    declared_pending: number;
    declared_pending_formatted: string;
    declared_pending_count: number;
    outstanding: number;
    outstanding_formatted: string;
    /** Non nul ⇒ `outstanding` est partiel (piège 28). */
    outstanding_unknown_count: number;
    /** Le taux à jour, entier. `null` s'il n'y a aucun membre actif — jamais 0. */
    recovery_rate: number | null;
  };
  by_category: Array<{
    category_id: number | null;
    label: string;
    members: number;
    up_to_date: number;
    collected: number;
    collected_formatted: string;
  }>;
  /** Toujours les 5 moyens, à 0 s'il n'y a rien. */
  by_method: Array<{
    method: PaymentMethod | string;
    label: string;
    collected: number;
    collected_formatted: string;
  }>;
  /** 12 mois glissants, mois vides compris. Ne retombe PAS sur `collected`. */
  evolution: Array<{
    /** `YYYY-MM` */
    month: string;
    label: string;
    collected: number;
    collected_formatted: string;
  }>;
  upcoming: { days: number; count: number };
  outreach: OutreachSummary;
};

/* ─────────────────────── Relances et file WhatsApp (§9) ─────────────── */

export type OutreachStep = 'j-30' | 'j-7' | 'j+1';

export type OutreachSummary = {
  pending: { 'j-30': number; 'j-7': number; 'j+1': number; campagne: number };
  /** Un comptage SANS écartement : il peut dépasser la file servie. */
  total: number;
};

export type OutreachItem = {
  id: string;
  member: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    name: string;
    phone: string | null;
  };
  /** `null` pour une campagne du bureau. */
  step: OutreachStep | null;
  /** `YYYY-MM-DD`, ou null. */
  due_on: string | null;
  campaign: { id: string; segment: string; automatic: boolean } | null;
  /** Composé À LA LECTURE par le serveur : jamais mis en cache, jamais recomposé. */
  message: string;
  /** `null` ⇒ numéro non reconnu : proposer la copie, jamais un lien deviné. */
  wa_url: string | null;
  phone_is_usable: boolean;
  url: string;
};

export type OutreachDecision = {
  id: string;
  status: string;
  sent_at: string | null;
  skip_reason: string | null;
};

export type CampaignSegment = 'non_a_jour' | 'tous_actifs';

export type ChannelProgress = {
  total: number;
  sent: number;
  pending: number;
  skipped: number;
  failed: number;
};

export type Campaign = {
  id: string;
  type: string;
  /** `non_a_jour`, `tous_actifs`, ou `auto:j-30` / `auto:j-7` / `auto:j+1`. */
  segment: string;
  /** `draft` (programmée), `sent`, `cancelled`. */
  status: string;
  automatic: boolean;
  step: OutreachStep | null;
  send_email: boolean;
  scheduled_at: string | null;
  created_at: string;
  channels: { whatsapp: ChannelProgress; email: ChannelProgress };
  /** INDICATIF : on branche sur la réponse, jamais sur ce drapeau (piège 30). */
  cancellable?: boolean;
};

/** La réponse de `POST campaigns` : la campagne, plus quatre clés de lancement. */
export type LaunchedCampaign = Campaign & {
  launched: boolean;
  whatsapp_queued: number;
  emails_queued: number;
  /** Ni e-mail ni téléphone : à joindre autrement. */
  unreachable: number;
  /**
   * Avaient déjà un message WhatsApp en attente (§12.5) : ils SERONT servis.
   * Jamais additionnés à `unreachable`. Absent d'un serveur antérieur à S3d.
   */
  already_queued?: number;
};

export type CampaignInput = {
  segment: CampaignSegment;
  send_email: boolean;
  /** ISO 8601, dans le futur ; `null` = maintenant. */
  scheduled_at: string | null;
};

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
  rejected: 'Refusé',
  cancelled: 'Annulé',
};
