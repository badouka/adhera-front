/**
 * Le contrat de l'API bureau, recopié de `_handoff/adhera-api-bureau.md`
 * (v3.7.3-adhera-S3d : relances §9, tableau de bord §10, encaissements §11,
 * arriérés §12 ; v3.8.4-adhera-simple : l'espace simplifié, §18).
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

/**
 * `GET /admin/me` (§18.7) — route PARTAGÉE avec EventFlow. `role_label` est
 * composé par le serveur : aucune table de rôles ici.
 */
export type Me = {
  name: string;
  email: string;
  role: AdminRole | string;
  role_label: string;
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
  /**
   * §19 (v3.8.5) — le sigle, pour la ligne 1 de l'en-tête du téléphone, et rien
   * d'autre (carte, reçu, attestation et WhatsApp gardent le nom complet).
   * `null` : pas de sigle, l'en-tête montre le nom complet. Toujours servi depuis
   * v3.8.5 ; absent d'un serveur antérieur, lu comme `null`.
   */
  short_name?: string | null;
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
  /**
   * §18.6 — l'e-mail du matin, seulement s'il y a des paiements à vérifier.
   * `true` par défaut ; absent d'un serveur antérieur, lu alors comme `true`.
   */
  verification_digest_enabled?: boolean;
  /**
   * Les options vendables allumées pour l'association (v3.8.1). Clé absente
   * d'un serveur antérieur : chaque option est alors lue comme ÉTEINTE.
   */
  features?: { membership_card?: boolean };
};

/** `features.membership_card === true`, et rien d'autre. */
export function hasMembershipCard(settings: Settings): boolean {
  return settings.features?.membership_card === true;
}

/** Les champs que l'écran Paramètres envoie (F2 ; `short_name` depuis F5-bis, §19). */
export type SettingsInput = {
  issuer_name: string;
  /** §19 — toujours envoyé par l'écran Paramètres ; `null` retire le sigle. */
  short_name: string | null;
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
  /**
   * §16.1 — format libre (`0001`, `A-14`, `2021/07`), 32 caractères au plus.
   * `null` pour un candidat : la ligne reste VIDE, jamais `0000`. Absent d'un
   * serveur antérieur à v3.8.
   */
  member_number?: string | null;
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

/**
 * §12.8 — une année que la base ne porte pas. Ni `id`, ni reçu, ni statut :
 * aucune action ne s'y attache.
 */
export type MissingPeriod = {
  period_start: string;
  period_end: string;
  period_label: string | null;
  amount_due: number | null;
  /** `null` si incalculable — jamais `0`. */
  amount_due_formatted: string | null;
  /** Même sens que sur une période de `dues`. */
  is_unclaimed_arrears: boolean;
};

/** §16.4 — une attestation déjà délivrée. */
export type MemberAttestation = {
  document_id: string;
  reference: string;
  /** ISO 8601 */
  issued_at: string;
  /** `YYYY-MM-DD` */
  valid_until: string | null;
  /** RECALCULÉ à chaque lecture : une annulation d'encaissement l'éteint. */
  is_valid: boolean;
};

/** La réponse de `POST members/{id}/attestation` : la pièce, pas le PDF. */
export type IssuedAttestation = {
  document_id: string;
  reference: string;
  valid_until: string | null;
};

export type MemberDetail = MemberListItem & {
  contacts: Contact[];
  dues: MemberDue[];
  /** La plus ANCIENNE d'abord (l'inverse de `dues`). Absente avant v3.7.5. */
  missing_periods?: MissingPeriod[];
  /** La plus RÉCENTE d'abord. Absente avant v3.8. */
  attestations?: MemberAttestation[];
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
  /** §16.1 — envoyé seulement s'il a changé (`PUT` uniquement). */
  member_number?: string | null;
};

/**
 * `renewing_soon` (§18.3) : des membres À JOUR dont la couverture se termine
 * dans les `renewing_soon_days` jours. Renouveler n'est pas être en retard.
 */
export type MemberStanding = 'up_to_date' | 'not_up_to_date' | 'renewing_soon';

export type MemberFilters = {
  status?: MemberStatus | '';
  standing?: MemberStanding | '';
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
  /** §18.5 — le même message, sous la forme commune. `null` : pas de numéro. */
  share?: Share | null;
};

/**
 * §18.5 — un message WhatsApp DÉJÀ RÉDIGÉ par le serveur : le reçu, le refus
 * ou le rappel. `null` quand le membre n'a pas de numéro utilisable : l'écran
 * le dit, il ne propose pas un bouton qui échoue.
 */
export type Share = {
  /** Le numéro tel que la fiche le porte, pour être relu avant l'envoi. */
  phone: string;
  text: string;
  /** L'adresse `wa.me` — jamais le lien du membre. */
  whatsapp_url: string;
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

/**
 * La réponse de `POST members/{id}/payments`, de `validate` et de `reject`
 * (§18.5) : le paiement, et le message WhatsApp déjà rédigé. `share` est
 * absent d'un serveur antérieur à v3.8.4, lu alors comme `null`.
 */
export type PaymentWithShare = Payment & { share?: Share | null };

/** §18.1 — le paiement déjà enregistré, dans un `409 possible_duplicate`. */
export type ExistingPayment = {
  payment_id: string;
  amount: number;
  amount_formatted: string;
  method_label: string;
  /** L'heure de SAISIE (ISO 8601), pas la date de paiement. */
  recorded_at: string;
  /** `null` sur une déclaration en attente. */
  receipt_reference: string | null;
};

/** §18.4 — les trois raisons toutes prêtes d'un refus. */
export type RejectReasonCode = 'not_found' | 'wrong_amount' | 'unreadable_proof';

/** Un refus : une raison toute prête, OU un texte libre de 10 caractères. */
export type RejectInput = { reason_code: RejectReasonCode } | { reason: string };

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
  /** §18.3 — les chiffres de l'accueil. Absent d'un serveur antérieur à v3.8.4. */
  simple?: DashboardSimple | null;
};

/**
 * §18.3 — les six chiffres de l'accueil, tous calculés par le serveur. Le
 * « reste à recevoir » ne compte que les membres `active` (D2). `year` est
 * l'exercice dans le fuseau de l'association : jamais `getFullYear()` ici.
 */
export type DashboardSimple = {
  active_count: number;
  up_to_date_count: number;
  late_count: number;
  remaining: number;
  remaining_formatted: string;
  /** L'année CIVILE : ce chiffre ignore le filtre de période. */
  received_this_year: number;
  received_this_year_formatted: string;
  year: number;
  renewing_soon_count: number;
  renewing_soon_days: number;
  to_verify_count: number;
  to_verify_total: number;
  to_verify_total_formatted: string;
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
  due: 'À payer',
  partielle: 'Partielle',
  reglee: 'Payée',
  exoneree: 'Exonérée',
};

/** Le lexique (§18.8) : « à vérifier », « accepté », « refusé ». */
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  declared: 'À vérifier',
  validated: 'Accepté',
  rejected: 'Refusé',
  cancelled: 'Annulé',
};
