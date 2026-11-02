/**
 * « Garder sur mon téléphone » (F4 § 1.4) : ce que le navigateur permet.
 *
 * Quatre cas, et un cinquième où le bouton ne sert à rien et ne s'affiche pas :
 * - `installed` : la carte est déjà ouverte depuis l'écran d'accueil ;
 * - `in-app` : le navigateur intégré de WhatsApp, Facebook ou Instagram. C'est
 *   le cas réel — le lien arrive par WhatsApp — et l'installation y est
 *   impossible : on invite à rouvrir le lien dans Chrome ou Safari ;
 * - `ios` : Safari ne propose aucune invite, on montre le geste ;
 * - `prompt` : Chrome (Android) a émis `beforeinstallprompt` ;
 * - `none` : rien de tout cela (Firefox, un ordinateur…).
 */

export type InstallEnv = 'installed' | 'in-app' | 'ios' | 'prompt' | 'none';

export type InstallSignals = {
  userAgent: string;
  /** `matchMedia('(display-mode: standalone)')`, ou `navigator.standalone` (iOS). */
  standalone: boolean;
  /** Vrai si une invite `beforeinstallprompt` a été retenue. */
  canPrompt: boolean;
  /** Un iPad récent se déclare « Macintosh » : il se reconnaît au toucher. */
  maxTouchPoints?: number;
};

/**
 * Les navigateurs intégrés : WhatsApp, Facebook (FBAN / FBAV / FB_IAB),
 * Messenger, Instagram, et toute WebView Android (`; wv)`).
 */
const IN_APP = /WhatsApp|FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|;\s?wv\)/i;

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP.test(userAgent);
}

export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function detectInstallEnv(signals: InstallSignals): InstallEnv {
  if (signals.standalone) return 'installed';
  if (isInAppBrowser(signals.userAgent)) return 'in-app';
  if (isIos(signals.userAgent, signals.maxTouchPoints)) return 'ios';
  if (signals.canPrompt) return 'prompt';
  return 'none';
}

/* ─────────────── L'invite d'installation, retenue tôt ─────────────── */

/** L'événement de Chrome, absent des types du DOM. */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: InstallPromptEvent | null = null;
let listening = false;
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

/**
 * Commence à écouter `beforeinstallprompt`. L'événement peut arriver avant que
 * le bouton ne soit monté : on le retient ici, une fois pour toutes.
 */
export function listenForInstallPrompt(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    // Sans cela, Chrome afficherait sa propre bannière, hors de notre texte.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export function pendingInstallPrompt(): InstallPromptEvent | null {
  return deferred;
}

/** Lance l'invite retenue. Elle ne sert qu'une fois. */
export async function runInstallPrompt(): Promise<'accepted' | 'dismissed' | null> {
  const event = deferred;
  if (!event) return null;
  deferred = null;
  notify();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome;
}

export function subscribeInstallPrompt(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** Pour les tests : repart d'un état vierge. */
export function resetInstallPromptForTests(): void {
  deferred = null;
  listening = false;
  subscribers.clear();
}

/** L'appareil affiche-t-il déjà la carte depuis son écran d'accueil ? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const media = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const ios = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return media || ios;
}
