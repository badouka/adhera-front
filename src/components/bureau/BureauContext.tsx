'use client';

import { createContext, useContext, useEffect } from 'react';
import type { BureauSession } from '@/lib/bureau/session';
import type { Me, Settings } from '@/lib/bureau/types';

/** « Retour » d'un écran d'un geste : un lien, ou un geste dans la page. */
export type BackLink = { href: string; label: string; onClick?: () => void };

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
  /** `GET admin/me` (§18.7) ; `null` tant qu'il n'a pas répondu. */
  me: Me | null;
  /** Après « Mon profil » : la réponse du `PUT` fait foi. */
  setMe: (next: Me) => void;
  /** Le nombre de paiements à vérifier, sur l'entrée « Paiements ». */
  toVerify: number | null;
  /** Après une décision : le compteur est relu. */
  refreshToVerify: () => void;
  setBack: (back: BackLink | null) => void;
};

export const BureauContext = createContext<BureauContextValue | null>(null);

export function useBureau(): BureauContextValue {
  const value = useContext(BureauContext);
  if (!value) throw new Error('useBureau() hors de <BureauFrame>');
  return value;
}

/**
 * Un écran d'un geste porte « Retour » à la place de l'en-tête et de la barre
 * du bas (maquette). `null` : l'écran garde la navigation.
 */
export function useBackBar(back: BackLink | null): void {
  const { setBack } = useBureau();
  const href = back?.href ?? null;
  const label = back?.label ?? null;
  const onClick = back?.onClick;
  useEffect(() => {
    setBack(href !== null && label !== null ? { href, label, onClick } : null);
    return () => setBack(null);
  }, [setBack, href, label, onClick]);
}
