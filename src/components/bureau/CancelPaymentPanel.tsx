'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { cancelPayment, isSessionError } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import type { Payment } from '@/lib/bureau/types';
import { formatShortDate } from '@/lib/dates';
import { Button, Field, inputClass } from './ui';

/** Le motif d'une annulation : 10 caractères au moins, espaces de bord non comptées (§11.3). */
export const MIN_CANCEL_LENGTH = 10;

/**
 * « Annuler cet encaissement » — sur un versement VALIDÉ seulement (un
 * versement signalé se refuse, il ne s'annule pas).
 *
 * Le récapitulatif R9 dit les conséquences : la cotisation redevient due, le
 * reçu est marqué annulé, rien n'est supprimé. Irréversible : une erreur se
 * corrige en ressaisissant le versement.
 */
export function CancelPaymentPanel({
  payment,
  memberName,
  onDone,
  onClose,
  onStale,
}: {
  payment: Payment;
  memberName: string;
  onDone: (cancelled: Payment) => void;
  onClose: () => void;
  /** `422 payment_not_cancellable` : l'état a changé, la fiche recharge. */
  onStale: (message: string) => void;
}) {
  const ids = useId();
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  const when = formatShortDate(payment.paid_on);
  const details = [payment.method_label, when].filter(Boolean).join(', ');

  async function confirm() {
    if (busy) return;
    const text = reason.trim();
    if (text.length < MIN_CANCEL_LENGTH) {
      setFieldError(`Expliquez le motif en ${MIN_CANCEL_LENGTH} caractères au moins.`);
      reasonRef.current?.focus();
      return;
    }
    setFieldError(null);
    setBusy(true);
    setError(null);
    try {
      onDone(await cancelPayment(payment.id, text));
    } catch (cause) {
      if (isSessionError(cause)) return;
      if (cause instanceof ApiError && cause.code === 'payment_not_cancellable') {
        onStale(errorMessage(cause, ''));
        return;
      }
      if (cause instanceof ApiError && cause.code === 'reason_required') {
        setFieldError(errorMessage(cause, ''));
      } else {
        setError(errorMessage(cause, 'L’encaissement n’a pas pu être annulé.'));
      }
      setBusy(false);
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={`${ids}-recap`}
      className="flex flex-col gap-3 rounded-[var(--radius-sm)] border-2 border-late bg-late-soft p-3"
    >
      <p id={`${ids}-recap`} className="m-0 font-semibold break-words" data-testid="cancel-recap">
        Annuler <span className="money">{payment.amount_formatted}</span>
        {details ? ` (${details})` : ''} de {memberName} ? Sa cotisation redeviendra due
        {payment.receipt ? ` et le reçu ${payment.receipt.reference} sera marqué annulé` : ''}.
        Rien n’est supprimé.
      </p>
      <Field
        label="Motif de l’annulation"
        required
        error={fieldError}
        hint="Il figurera sur le reçu annulé, que le membre peut télécharger."
      >
        {(props) => (
          <textarea
            {...props}
            ref={reasonRef}
            rows={2}
            maxLength={255}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass(!!fieldError, 'py-2')}
          />
        )}
      </Field>
      {error ? (
        <p role="alert" className="m-0 rounded-[var(--radius-sm)] bg-surface-raised p-3 font-semibold text-late">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button tone="danger" onClick={() => void confirm()} disabled={busy}>
          {busy ? 'Envoi…' : 'Annuler l’encaissement'}
        </Button>
        <Button tone="ghost" onClick={onClose} disabled={busy}>
          Ne rien changer
        </Button>
      </div>
    </div>
  );
}
