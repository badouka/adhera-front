/**
 * Le SEUL endroit du code qui compose une adresse WhatsApp (F6). Partout
 * ailleurs, le lien `wa.me` est servi par l'API (`share.whatsapp_url`, §18.5) et
 * passé tel quel. Trois messages n'ont pas d'adresse servie :
 *
 * - le visiteur qui s'envoie son lien personnel (§17.4 : « il faut
 *   l'afficher, et inviter à le garder ») ;
 * - le membre qui envoie son lien d'invitation (`referral.share_text`, §17.8) ;
 * - le bureau qui partage le lien pour adhérer dans ses groupes.
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
