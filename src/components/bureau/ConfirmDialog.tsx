'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button, type ButtonTone } from './ui';

/**
 * R9 — la confirmation qui récapitule.
 *
 * Toute action qui touche à l'argent ou à l'accès passe par ici : valider,
 * rejeter, saisir un versement, régénérer un lien, déclarer une sortie. Le
 * bureau travaille sur téléphone, vite : le récapitulatif reprend le nom, le
 * montant formaté par le serveur, le mode et la référence, et le bouton dit
 * exactement ce qui va se passer.
 *
 * Un `<div role="dialog">` plutôt qu'un `<dialog>` natif : le rendu est le même
 * partout (WebView Android comprises) et testable sous jsdom.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  confirmTone = 'primary',
  busy = false,
  error,
  onConfirm,
  onCancel,
  confirmDisabled = false,
  cancelLabel = 'Annuler',
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmTone?: ButtonTone;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  /** Quand le geste confirmé est lui-même une annulation, « Annuler » prête à confusion. */
  cancelLabel?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Le focus entre dans la boîte, puis revient à ce qui l'a ouverte.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !busy) {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;

    // Le focus ne sort pas de la boîte tant qu'elle est ouverte.
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="flex max-h-[92dvh] w-full max-w-[480px] flex-col gap-4 overflow-y-auto rounded-t-[var(--radius-md)] bg-surface-raised p-4 sm:rounded-[var(--radius-md)] sm:p-6"
      >
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="title m-0">
          {title}
        </h2>

        {children}

        {error ? (
          <p
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="m-0 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button tone="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            tone={confirmTone}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? 'Envoi…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Le récapitulatif : une liste « libellé — valeur », valeurs en gras. */
export function Recap({
  rows,
}: {
  rows: ReadonlyArray<{ label: string; value: ReactNode | null | undefined }>;
}) {
  return (
    <dl className="m-0 flex flex-col gap-2 rounded-[var(--radius-sm)] border border-line bg-surface p-3">
      {rows
        .filter((row) => row.value !== null && row.value !== undefined && row.value !== '')
        .map((row) => (
          <div key={row.label} className="flex flex-wrap justify-between gap-x-4 gap-y-0">
            <dt className="text-ink-muted">{row.label}</dt>
            <dd className="tnum m-0 min-w-0 text-right font-bold break-words">
              {row.value}
            </dd>
          </div>
        ))}
    </dl>
  );
}
