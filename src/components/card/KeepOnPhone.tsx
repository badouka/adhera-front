'use client';

import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/CopyButton';
import {
  detectInstallEnv,
  isStandalone,
  listenForInstallPrompt,
  pendingInstallPrompt,
  runInstallPrompt,
  subscribeInstallPrompt,
  type InstallEnv,
} from '@/lib/install';

function currentEnv(): InstallEnv {
  return detectInstallEnv({
    userAgent: navigator.userAgent,
    standalone: isStandalone(),
    canPrompt: pendingInstallPrompt() !== null,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
}

/** L'icône « Partager » de Safari : un carré ouvert, une flèche qui en sort. */
function ShareGlyph() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="inline-block shrink-0 align-[-5px] text-indigo"
    >
      <path d="M12 3v12" />
      <path d="m7.5 7.5 4.5-4.5 4.5 4.5" />
      <path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" />
    </svg>
  );
}

/** L'entrée « Sur l'écran d'accueil » : un carré et un plus. */
function AddGlyph() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className="inline-block shrink-0 align-[-5px] text-indigo"
    >
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

const BUTTON =
  'flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border-2 border-indigo bg-surface-raised font-bold text-indigo';

/**
 * « Garder sur mon téléphone » (F4 § 1.4). Le bouton n'existe que s'il peut
 * servir : invite de Chrome, notice de Safari, ou — dans le navigateur intégré
 * de WhatsApp, où l'on ne peut rien installer — l'invitation à rouvrir le lien
 * ailleurs. Une carte déjà ouverte depuis l'écran d'accueil ne le montre pas.
 */
export function KeepOnPhone() {
  const [env, setEnv] = useState<InstallEnv>('none');
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    listenForInstallPrompt();
    const update = () => setEnv(currentEnv());
    update();
    const unsubscribe = subscribeInstallPrompt(update);
    const media = window.matchMedia?.('(display-mode: standalone)');
    media?.addEventListener?.('change', update);
    return () => {
      unsubscribe();
      media?.removeEventListener?.('change', update);
    };
  }, []);

  if (env === 'installed' || env === 'none') return null;

  if (env === 'in-app') {
    const link = `${window.location.origin}${window.location.pathname}`;
    return (
      <div
        className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4"
        data-testid="keep-in-app"
      >
        <p className="m-0 font-semibold">
          Ouvrez ce lien dans Chrome (ou Safari sur iPhone) pour garder votre carte.
        </p>
        <CopyButton value={link} label="Copier le lien de ma carte" text="Copier le lien" large />
      </div>
    );
  }

  if (env === 'ios') {
    return (
      <div className="flex flex-col gap-2" data-testid="keep-ios">
        <button
          type="button"
          className={BUTTON}
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((open) => !open)}
        >
          Garder sur mon téléphone
        </button>
        {helpOpen ? (
          <ol className="m-0 flex list-none flex-col gap-2 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4 pl-4">
            <li className="flex items-center gap-2">
              <span className="font-bold">1.</span>
              <span>
                Touchez Partager <ShareGlyph /> en bas de l’écran,
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="font-bold">2.</span>
              <span>
                puis « Sur l’écran d’accueil » <AddGlyph />.
              </span>
            </li>
          </ol>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={BUTTON}
      data-testid="keep-prompt"
      onClick={() => {
        void runInstallPrompt().catch(() => undefined);
      }}
    >
      Garder sur mon téléphone
    </button>
  );
}
