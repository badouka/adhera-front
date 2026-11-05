/**
 * §21.1 — 5 Mo par fichier, photo comme pièce. La borne n'est pas servie ; on
 * la vérifie AVANT l'envoi parce qu'un fichier trop lourd coûte plusieurs
 * mégaoctets de 3G pour un refus certain. Le serveur reste l'autorité (types,
 * contenu, extension).
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Le message du serveur pour ce refus, repris mot pour mot (§21.1). */
export const TOO_LARGE = 'Le fichier dépasse la taille maximale de 5 MB.';

/** Les photos que le serveur accepte (JPEG, PNG, WebP) : le filtre du sélecteur. */
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
