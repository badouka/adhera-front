'use client';

import { createContext, useContext } from 'react';
import type { BureauSession } from '@/lib/bureau/session';
import type { Settings } from '@/lib/bureau/types';

export type BureauContextValue = {
  session: BureauSession;
  settings: Settings;
  /** Après un `PUT settings` ou un envoi de logo : la charge renvoyée fait foi. */
  setSettings: (next: Settings) => void;
  /**
   * Faux si `settings.mode_is_supported` l'est, ou si une route a répondu
   * `409 cotisation_mode_unsupported` depuis. Une seule bannière, dans le cadre.
   */
  modeSupported: boolean;
  markModeUnsupported: () => void;
};

export const BureauContext = createContext<BureauContextValue | null>(null);

export function useBureau(): BureauContextValue {
  const value = useContext(BureauContext);
  if (!value) throw new Error('useBureau() hors de <BureauFrame>');
  return value;
}
