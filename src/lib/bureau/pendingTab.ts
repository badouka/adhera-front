/**
 * Un onglet ouvert AU TOUCHER, dirigé plus tard vers une adresse servie par
 * l'API (`share.whatsapp_url`). Les navigateurs mobiles bloquent un
 * `window.open` lancé après un `await` : l'onglet est donc ouvert tout de
 * suite, coupé de `opener` (l'équivalent de `noopener`), puis dirigé — ou
 * refermé si rien ne doit s'ouvrir.
 */
export type PendingTab = {
  /** Vrai si l'onglet a pu être dirigé ; faux s'il avait été bloqué. */
  go: (url: string) => boolean;
  close: () => void;
};

export function openPendingTab(): PendingTab {
  let tab: Window | null = null;
  try {
    tab = window.open('', '_blank');
    if (tab) tab.opener = null;
  } catch {
    tab = null;
  }
  return {
    go(url) {
      if (!tab || tab.closed) return false;
      tab.location.replace(url);
      return true;
    },
    close() {
      if (tab && !tab.closed) tab.close();
    },
  };
}
