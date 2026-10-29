'use client';

import { useEffect, useRef, useState } from 'react';
import { CopyIcon } from '@/components/Icons';
import { buttonClass } from './ui';

/**
 * Copie `value` TELLE QUELLE dans le presse-papiers. Pour le message WhatsApp,
 * c'est essentiel : ses espaces insécables (U+00A0) sont voulus (§5).
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission refusée ou contexte non sécurisé : on tente le repli.
  }
  try {
    const scratch = document.createElement('textarea');
    scratch.value = value;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.top = '-1000px';
    document.body.appendChild(scratch);
    scratch.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(scratch);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Le bouton Copier de F1, avec un libellé VISIBLE qui dit ce qu'il copie
 * (« Copier le message », « Copier le lien ») : deux « Copier » côte à côte ne
 * se distingueraient pas.
 */
export function CopyAction({ value, label }: { value: string; label: string }) {
  const [outcome, setOutcome] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function onClick() {
    const ok = await copyText(value);
    setOutcome(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOutcome('idle'), 2000);
  }

  return (
    <>
      <button type="button" onClick={onClick} className={buttonClass('secondary')}>
        <CopyIcon />
        {outcome === 'copied' ? 'Copié' : label}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {outcome === 'copied'
          ? `${label} : copié.`
          : outcome === 'failed'
            ? `${label} : la copie a échoué, sélectionnez le texte à la main.`
            : ''}
      </span>
    </>
  );
}
