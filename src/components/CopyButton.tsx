'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyIcon } from './Icons';

type Outcome = 'idle' | 'copied' | 'selected';

/**
 * Copie un numéro marchand. `navigator.clipboard` manque sur les WebView
 * anciennes et sur tout contexte non sécurisé : on retombe alors sur
 * `execCommand`, puis, en dernier ressort, sur la sélection du texte affiché —
 * le membre n'a plus qu'à appuyer longuement.
 *
 * La confirmation est un TEXTE (« Copié »), pas seulement une icône, et reste
 * deux secondes.
 */
export function CopyButton({
  value,
  label,
  selectRef,
}: {
  value: string;
  /** Ce que lit un lecteur d'écran : « Copier le numéro Orange Money ». */
  label: string;
  /** L'élément à sélectionner si le presse-papiers est indisponible. */
  selectRef?: React.RefObject<HTMLElement | null>;
}) {
  const [outcome, setOutcome] = useState<Outcome>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const flash = useCallback((next: Outcome) => {
    setOutcome(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOutcome('idle'), 2000);
  }, []);

  const selectFallback = useCallback(() => {
    const node = selectRef?.current;
    const selection = window.getSelection();
    if (node && selection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
      flash('selected');
      return;
    }
    flash('selected');
  }, [flash, selectRef]);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        flash('copied');
        return;
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
      if (ok) {
        flash('copied');
        return;
      }
    } catch {
      // execCommand absent ou désactivé.
    }

    selectFallback();
  }, [flash, selectFallback, value]);

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className="small inline-flex min-h-11 shrink-0 items-center gap-[6px] rounded-[var(--radius-sm)] border border-line-strong bg-surface-raised px-3 font-semibold text-ink"
      >
        {outcome === 'copied' ? null : <CopyIcon />}
        {outcome === 'copied' ? 'Copié' : 'Copier'}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {outcome === 'copied'
          ? `${label} : copié.`
          : outcome === 'selected'
            ? `${label} : sélectionné, appuyez longuement pour le copier.`
            : ''}
      </span>
    </>
  );
}
