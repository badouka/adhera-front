/**
 * Joindre Adhera, c'est-à-dire DIGISSOL (brief F7 § 5) : quand l'adhésion en
 * ligne est éteinte (P3), ou quand la licence de l'association arrête l'espace
 * du bureau (B11).
 *
 * Ces coordonnées sont PUBLIQUES, et elles vivent ICI seulement : un
 * garde-fou de `tests/guards.test.ts` refuse le numéro et l'adresse dans tout
 * autre fichier de `src/`. Ce ne sont jamais celles d'une association : côté
 * membre, c'est l'association qu'on contacte, jamais Adhera.
 */

import { whatsappChat } from './whatsapp';

/** Le numéro WhatsApp, indicatif compris, sans « + » (la forme de `wa.me`). */
const ADHERA_WHATSAPP_NUMBER = '221782414064';

export const ADHERA_CONTACT = {
  /** `https://wa.me/221782414064` — une conversation, sans message déjà écrit. */
  whatsappUrl: whatsappChat(ADHERA_WHATSAPP_NUMBER),
  email: 'contact@adhera.africa',
} as const;
