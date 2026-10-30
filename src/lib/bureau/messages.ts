/**
 * Les libellés d'erreur affichés au bureau.
 *
 * R4 : on branche sur le `code` (ou le statut), jamais sur le message. Les
 * messages de validation de l'API sont en ANGLAIS (piège 10) : `errors` sert à
 * désigner le champ, le libellé est le nôtre. Le `404` d'un membre nomme une
 * classe PHP (piège 11) : il n'est jamais recopié.
 */

import { ApiError } from '../api';

/** Le verrou par compte de `admin/login` (§2) : dix échecs par heure. */
export const TOO_MANY_ATTEMPTS = 'too_many_attempts';

/**
 * Le délai d'attente d'un `429`, en minutes entières, arrondi au supérieur :
 * « Trop de tentatives. Réessayez dans 42 minutes. » Jamais « quelques
 * minutes » : un délai vague fait réessayer trop tôt, et réessayer prolonge le
 * verrou.
 *
 * Sans délai lisible, on retombe sur la borne du limiteur qui a répondu,
 * reconnu à son `code` (R4, piège 17) : sans code, c'est le limiteur par IP
 * (10 / minute) ; avec `too_many_attempts`, le verrou par compte (1 heure).
 */
export function tooManyAttemptsMessage(retryAfter: number | null, code: string | null): string {
  const seconds = retryAfter ?? (code === TOO_MANY_ATTEMPTS ? 3600 : 60);
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`;
}

const BY_CODE: Record<string, string> = {
  feature_disabled:
    'Ce service n’est pas inclus dans l’offre de votre association. Contactez DIGISSOL.',
  cotisation_mode_unsupported:
    'Le mode de cotisation de votre association n’est pas encore pris en charge. Contactez DIGISSOL.',
  category_in_use:
    'Cette catégorie est utilisée : désactivez-la plutôt que de la supprimer.',
  mime_not_allowed: 'Ce type de fichier n’est pas accepté : envoyez un JPEG ou un PNG.',
  file_too_large: 'Le fichier dépasse 2 Mo.',
  logo_missing: 'Aucun fichier n’a été reçu. Choisissez une image, puis réessayez.',
  upload_invalid: 'Le fichier n’a pas pu être lu. Essayez avec une autre image.',
  proof_missing: 'Aucune capture n’est jointe à ce paiement.',
  member_is_not_an_organisation:
    'Seule une organisation peut avoir des contacts rattachés.',
  unknown_member: 'Membre introuvable.',
  unknown_category: 'Cette catégorie n’existe plus. Rechargez la page.',
  nothing_due: 'Aucune cotisation n’est réclamée à ce membre pour le moment.',
  amount_exceeds_balance: 'Le montant dépasse ce qui reste à payer.',
  amount_due_unknown:
    'Le montant de la cotisation de ce membre n’est pas fixé : vérifiez sa catégorie.',
};

/**
 * Le message à afficher pour un échec. `fallback` dit ce qui a échoué, dans
 * les mots de l'écran (« Le versement n’a pas pu être validé. »).
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;

  if (error.code && error.code in BY_CODE) return BY_CODE[error.code] as string;

  if (error.status === 0) {
    return 'Connexion impossible. Vérifiez votre réseau, puis réessayez.';
  }
  if (error.status === 429) {
    const retryAfter =
      'retryAfter' in error && typeof error.retryAfter === 'number' ? error.retryAfter : null;
    return tooManyAttemptsMessage(retryAfter, error.code);
  }
  if (error.status === 403) {
    return 'Cette action n’est pas autorisée pour votre association.';
  }
  if (error.status >= 500) {
    return `${fallback} Le service ne répond pas : réessayez dans un instant.`;
  }

  // Une erreur MÉTIER d'Adhera (avec `code`) est rédigée en français par le
  // serveur : c'est le meilleur libellé disponible pour un code que cet écran
  // ne connaît pas encore. Une erreur de validation (sans `code`) ne l'est pas.
  if (error.code && (error.status === 409 || error.status === 422) && error.message) {
    return error.message;
  }

  return fallback;
}

/** Les champs refusés d'un `422`, sans leurs messages anglais. */
export function invalidFields(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.status !== 422) return [];
  return Object.keys(error.errors);
}
