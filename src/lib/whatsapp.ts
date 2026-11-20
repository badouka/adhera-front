/**
 * Le SEUL endroit du code qui compose une adresse WhatsApp (F6). Partout
 * ailleurs, le lien `wa.me` est servi par l'API (`share.whatsapp_url`, §18.5,
 * §22.8) et passé tel quel. Depuis S8, le serveur sert aussi le lien que le
 * visiteur s'envoie, le premier message au candidat et l'invitation à adhérer.
 * Il reste deux adresses composées ici :
 *
 * - le membre qui envoie son lien d'invitation (`referral.share_text`, §17.8) :
 *   le texte est servi, pas l'adresse ;
 * - la conversation avec Adhera (`src/lib/adhera.ts`, F7) : aucun texte.
 *
 * Le texte n'est jamais réécrit ici : il est encodé, c'est tout. Le lien
 * s'ouvre toujours avec `rel="noopener noreferrer"` — la page d'où l'on part
 * porte parfois un jeton dans son adresse.
 */

import { whatsappNumber } from './phone';

const WA = 'https://wa.me/';

/**
 * `wa.me/{numéro}?text=…` si le numéro est reconnu, sinon `wa.me/?text=…` —
 * WhatsApp demande alors à qui l'envoyer, et l'on ne devine pas d'indicatif.
 */
export function whatsappLink(text: string, phone?: string | null): string {
  const to = phone ? whatsappNumber(phone) : null;
  return `${WA}${to ?? ''}?${new URLSearchParams({ text }).toString().replace(/\+/g, '%20')}`;
}

/** Une conversation avec un numéro DÉJÀ au format `wa.me` (indicatif, sans « + »), sans texte. */
export function whatsappChat(number: string): string {
  return `${WA}${number}`;
}
