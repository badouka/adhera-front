/**
 * Suivre un lien depuis le code, par un seul point : les tests le remplacent,
 * jsdom ne sachant pas naviguer.
 */
export const browser = {
  open(url: string): void {
    window.location.assign(url);
  },
};
