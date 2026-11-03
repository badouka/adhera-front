import { getWhatsapp, isSessionError } from './api';
import { errorMessage } from './messages';
import { openPendingTab } from './pendingTab';

export type RemindOutcome =
  | { kind: 'opened' }
  /** L'onglet a été bloqué : le lien est rendu pour un second toucher. */
  | { kind: 'blocked'; url: string }
  | { kind: 'no-phone' }
  | { kind: 'error'; message: string }
  | { kind: 'session' };

/**
 * « Lui envoyer un rappel par WhatsApp » : le message est DÉJÀ RÉDIGÉ par le
 * serveur (`GET members/{id}/whatsapp`, bloc `share`, §18.5). L'onglet s'ouvre
 * au toucher, puis va sur `share.whatsapp_url` — jamais sur le lien du membre.
 * Rien n'est envoyé sans que le trésorier appuie sur « Envoyer » dans WhatsApp.
 */
export async function remindByWhatsapp(memberId: string): Promise<RemindOutcome> {
  const tab = openPendingTab();
  try {
    const answer = await getWhatsapp(memberId);
    // `share.whatsapp_url` EST `wa_url` (§18.5) : l'ancienne clé en repli.
    const url = answer.share ? answer.share.whatsapp_url : (answer.wa_url ?? null);
    if (!url) {
      tab.close();
      return { kind: 'no-phone' };
    }
    return tab.go(url) ? { kind: 'opened' } : { kind: 'blocked', url };
  } catch (cause) {
    tab.close();
    if (isSessionError(cause)) return { kind: 'session' };
    return { kind: 'error', message: errorMessage(cause, 'Le rappel n’a pas pu être préparé.') };
  }
}
