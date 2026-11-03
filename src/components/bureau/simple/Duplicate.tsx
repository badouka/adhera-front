'use client';

import { useBureau } from '@/components/bureau/BureauContext';
import { AlertIcon } from '@/components/Icons';
import type { ExistingPayment } from '@/lib/bureau/types';
import { zonedParts } from '@/lib/dates';
import { bigButtonClass, Label } from '../ui';

/** « à 21 h 21 », lu dans le fuseau de l'association. */
export function recordedAtLabel(recordedAt: string, zone: string | null | undefined): string {
  const parts = zonedParts(recordedAt, zone ?? 'Africa/Dakar');
  if (!parts) return '';
  const [h, m] = parts.time.split(':');
  return `à ${Number(h)} h ${m}`;
}

/**
 * Écran 5 — « Est-ce le même paiement ? » (§18.1). Sur `409
 * possible_duplicate`, le paiement déjà enregistré (`existing`) et celui qu'on
 * vient de saisir, côte à côte, et deux réponses.
 *
 * « Oui, c'est le même » n'envoie RIEN. « Non, … a payé deux fois » rejoue la
 * requête avec `confirm_duplicate` — c'est une réponse, jamais un défaut.
 * Le même écran sert à l'enregistrement et à « J'ai bien reçu cet argent ».
 */
export function DuplicateQuestion({
  existing,
  typedAmount,
  typedMethod,
  nowLabel = 'Vous venez de saisir',
  nowWhen = 'maintenant',
  memberName,
  firstName,
  busy,
  error,
  onSame,
  onTwice,
}: {
  existing: ExistingPayment;
  /** Le montant saisi, déjà mis en forme par l'écran de saisie. */
  typedAmount: string;
  typedMethod: string;
  /** « Vous venez de saisir » ; « Cheikh signale » pour un paiement à vérifier. */
  nowLabel?: string;
  nowWhen?: string;
  memberName: string;
  firstName: string;
  busy: boolean;
  error: string | null;
  onSame: () => void;
  onTwice: () => void;
}) {
  const { settings } = useBureau();
  const at = existing.recorded_at ? recordedAtLabel(existing.recorded_at, settings.timezone) : '';

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4" data-testid="duplicate">
      <div className="flex items-center gap-[10px] text-due">
        <AlertIcon size={26} />
        <h1 className="title m-0 text-ink">Est-ce le même paiement ?</h1>
      </div>
      <p className="m-0">
        Ce paiement de {memberName} est déjà enregistré aujourd’hui.
      </p>

      <div className="grid grid-cols-2 gap-[10px]">
        <div className="flex flex-col gap-[2px] rounded-[var(--radius-md)] border border-line bg-surface-raised p-3">
          <Label>Déjà enregistré</Label>
          <b className="money tnum text-[clamp(16px,5vw,20px)]">{existing.amount_formatted}</b>
          <span>{existing.method_label}</span>
          {at ? <span>{at}</span> : null}
          {existing.receipt_reference ? (
            <span className="small text-ink-muted break-all">
              Reçu n° {existing.receipt_reference}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-[2px] rounded-[var(--radius-md)] bg-due-soft p-3">
          <Label className="text-due">{nowLabel}</Label>
          <b className="money tnum text-[clamp(16px,5vw,20px)]">{typedAmount}</b>
          <span>{typedMethod}</span>
          <span>{nowWhen}</span>
        </div>
      </div>

      <p className="m-0">
        Si {memberName} n’a payé qu’une seule fois aujourd’hui, c’est le même paiement.
      </p>

      {error ? (
        <p role="alert" className="m-0 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-[10px]">
        <button
          type="button"
          onClick={onSame}
          disabled={busy}
          className={bigButtonClass('primary', 'flex-col gap-0')}
        >
          Oui, c’est le même
          <small className="block text-[14px] font-normal">Ne rien enregistrer</small>
        </button>
        <button
          type="button"
          onClick={onTwice}
          disabled={busy}
          className={bigButtonClass('outline', 'flex-col gap-0')}
        >
          {busy ? 'Enregistrement…' : `Non, ${firstName} a payé deux fois`}
          <small className="block text-[14px] font-normal text-ink-muted">
            Enregistrer ce deuxième paiement
          </small>
        </button>
      </div>
    </div>
  );
}
