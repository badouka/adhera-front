/**
 * Le contrat de `GET /m/{token}`, tel que le sert EventFlow en v3.5.7.
 *
 * R1 : les champs `*_formatted` sont les SEULS montants affichables. Les champs
 * numériques ne servent qu'au calcul (borne du formulaire), jamais au rendu.
 */

export type Organisation = {
  /** Peut être une chaîne vide : ne rien afficher plutôt qu'un vide. */
  name: string;
  /** Versionnée par son contenu : relue à chaque chargement, jamais recomposée. */
  logo_url: string | null;
  /**
   * L'icône CARRÉE (512 × 512) tirée du logo par le serveur, pour l'écran
   * d'accueil du téléphone : le manifeste et l'apple-touch-icon. Versionnée et
   * jamais recomposée, comme `logo_url`. `null` (ou absente d'un serveur plus
   * ancien) : on retombe sur `logo_url`.
   */
  icon_url?: string | null;
  om_merchant_number: string | null;
  wave_merchant_number: string | null;
  /** Texte libre, à rendre en TEXTE avec ses retours à la ligne, jamais en HTML. */
  payment_instructions: string | null;
};

export type Member = {
  /** Le libellé d'affichage, « Prénom Nom » pour une personne. */
  name: string;
  /** Nullables : une fiche ancienne peut ne pas les porter (v3.5.7). */
  first_name: string | null;
  last_name: string | null;
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
  /** « du 1er janvier 2026 au 31 décembre 2026 », rédigé par le serveur. */
  period_label: string | null;
  category_label: string | null;
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
  method_label: string | null;
  /** Facultative depuis v3.5.7 : servie si le membre l'a saisie. */
  reference: string | null;
  /** ISO 8601 */
  declared_at: string;
};

/**
 * Le paiement le plus récent de la période payable, s'il a été refusé
 * (v3.5.7). `reason` est écrit par le bureau À L'ADRESSE du membre : il
 * s'affiche tel quel, en texte.
 */
export type LastRejection = {
  amount_formatted: string;
  method_label: string | null;
  reference: string | null;
  reason: string;
  /** ISO 8601 */
  decided_at: string;
};

export type Receipt = {
  id: string;
  reference: string;
  amount_formatted: string;
  /** ISO 8601 */
  issued_at: string;
  /**
   * Renseigné si le bureau a annulé l'encaissement (§11.4) : le reçu reste
   * LISTÉ et téléchargeable, et son PDF dit « ANNULÉ ». Jamais caché.
   */
  cancelled_at?: string | null;
};

/**
 * La carte de membre (§16.2, v3.8-S4a), prête à afficher. Ni région, ni
 * téléphone, ni e-mail : c'est ce qu'on montre à un guichet.
 */
export type MemberCard = {
  /** Peut être `""` (FON-18) : rien ne s'affiche à sa place. */
  organisation_name: string;
  /** `null` : la zone est masquée, jamais de logo de repli. */
  logo_url: string | null;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  type: 'personne' | 'organisation' | string;
  category_label: string | null;
  /** `null` : la ligne disparaît (jamais « N° — »). */
  member_number: string | null;
  /** `YYYY-MM-DD`, ou `null` : la ligne disparaît. */
  member_since: string | null;
  is_up_to_date: boolean;
  /**
   * `null` dans TROIS cas : pas à jour, exonéré (à jour quand même), ancien.
   * Ne s'affiche que si `is_up_to_date` ET non nul.
   */
  valid_until: string | null;
  /** Composé par le serveur : « À jour » ou « Cotisation à régler », tel quel. */
  standing_label: string;
  /** L'adresse que le QR encode : on ne la recompose jamais. */
  verify_url: string;
  /**
   * §20.7 (v3.10-S6) — deux lignes au plus, sous le type de membre : les
   * questions cochées « sur la carte » ET répondues. `[]` : rien. Absente d'un
   * serveur antérieur, lue comme `[]`. ⚠️ Jamais sur la vérification `/v/`.
   */
  lines?: CardLine[];
};

export type CardLine = { label: string; value: string };

/**
 * §17.5 — l'état d'une demande d'adhésion. C'est CETTE clé qui dit quelle page
 * afficher, jamais `due === null` (vrai aussi pour un exonéré, piège 1).
 */
export type ApplicationStatus = 'under_review' | 'awaiting_first_payment' | 'rejected';

export type Application = {
  status: ApplicationStatus | string;
  /** ISO 8601 */
  submitted_at: string | null;
  /** Écrit par l'association POUR le candidat : affiché tel quel, en texte. */
  rejection_reason: string | null;
};

/**
 * §17.8 — le lien d'invitation d'un membre actif. ⚠️ AUCUN montant : avec un
 * seul filleul, une somme dirait ce qu'il a payé.
 */
export type Referral = {
  /** Ne jamais le recomposer : le code n'est servi nulle part ailleurs. */
  invite_url: string;
  /** Tutoyé, à la première personne : à passer TEL QUEL au partage. */
  share_text: string;
  joined_count: number;
  pending_count: number;
};

export type MemberPayload = {
  organisation: Organisation;
  member: Member;
  standing: Standing;
  due: Due | null;
  pending_declaration: PendingDeclaration | null;
  last_rejection: LastRejection | null;
  receipts: Receipt[];
  /**
   * `null` quand la clé `membership_card` est éteinte — et absente d'un serveur
   * antérieur à v3.8 : lue alors comme `null`.
   */
  card?: MemberCard | null;
  /** Gouverne SEUL le bouton d'attestation. Absent = `false`. */
  attestation_available?: boolean;
  /** §17.5 — `null` pour un membre actif ; absente d'un serveur antérieur à S5. */
  application?: Application | null;
  /** §17.8 — `null` si `membership_join` est éteinte, ou pour un non-actif. */
  referral?: Referral | null;
};

/* ───────────────── Vérification publique (§16.5) ───────────────── */

/** Un IDENTIFIANT, à tester, jamais à afficher tel quel. */
export type VerificationStanding = 'up_to_date' | 'not_up_to_date' | 'former';

export type VerifiedAttestation = {
  reference: string;
  /** ISO 8601 */
  issued_at: string;
  /** `YYYY-MM-DD`, ou null. */
  valid_until: string | null;
  is_valid: boolean;
};

export type Verification = {
  organisation: { name: string; logo_url: string | null };
  member: {
    display_name: string;
    type: string;
    category_label: string | null;
    member_number: string | null;
    member_since: string | null;
  };
  standing: VerificationStanding;
  /** Toujours `null` pour un ancien membre. */
  valid_until: string | null;
  /** ISO 8601 — l'instant de la vérification, à afficher. */
  checked_at: string;
  /** `null` sans `?attestation=`, ou si la référence ne correspond pas. */
  attestation: VerifiedAttestation | null;
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
