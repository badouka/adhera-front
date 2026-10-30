'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { isSessionError, rejectPayment, validatePayment } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import type { Payment } from '@/lib/bureau/types';
import { formatDate, todayInDakar } from '@/lib/dates';
import { dateError, isModeUnsupported } from './format';
import { Button, Field, inputClass } from './ui';

/** Le motif d'un refus : le membre le lira. 10 caractères au moins. */
export const MIN_REJECTION_LENGTH = 10;

/**
 * « Moussa Ndiaye — 100 000 FCFA — Wave — sans référence » : le cœur du
 * récapitulatif R9. Le montant ne se coupe jamais en deux lignes.
 */
function PaymentSummary({ payment }: { payment: Payment }) {
  return (
    <>
      {payment.member_name} — <span className="money">{payment.amount_formatted}</span> —{' '}
      {payment.method_label} — {payment.reference?.trim() || 'sans référence'}
    </>
  );
}

function PanelError({ message }: { message: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  if (!message) return null;
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="m-0 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late"
    >
      {message}
    </p>
  );
}

/**
 * B3 — « Reçu ✓ ». La confirmation R9 est un panneau léger, posé dans la
 * ligne : le récapitulatif tient sur une ligne, et un seul bouton confirme.
 * Une validation crédite la période et ne se réécrit jamais.
 */
export function ValidatePanel({
  payment,
  onDone,
  onCancel,
  onModeUnsupported,
}: {
  payment: Payment;
  onDone: (validated: Payment) => void;
  onCancel: () => void;
  onModeUnsupported: () => void;
}) {
  const [paidOn, setPaidOn] = useState(payment.paid_on ?? todayInDakar());
  const [dateOpen, setDateOpen] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Le focus va au bouton qui conclut : un toucher de plus, rien d'autre.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  async function confirm() {
    if (busy) return;
    const invalid = dateError(paidOn, 'la date du paiement');
    setFieldError(invalid);
    if (invalid) {
      setDateOpen(true);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      onDone(await validatePayment(payment.id, paidOn));
    } catch (cause) {
      if (isSessionError(cause)) return;
      if (isModeUnsupported(cause)) onModeUnsupported();
      setError(errorMessage(cause, 'Le paiement n’a pas pu être confirmé.'));
      setBusy(false);
    }
  }

  return (
    <div
      role="group"
      aria-label="Confirmer la réception"
      className="flex flex-col gap-3 rounded-[var(--radius-sm)] border-2 border-indigo bg-indigo-soft p-3"
    >
      <p className="m-0 font-semibold break-words" data-testid="recap">
        <PaymentSummary payment={payment} />
        {formatDate(paidOn) ? ` — payé le ${formatDate(paidOn)}` : ''} — un reçu sera
        émis
      </p>

      {dateOpen ? (
        <Field label="Date du paiement" error={fieldError} hint="Celle qui figurera sur le reçu.">
          {(props) => (
            <input
              {...props}
              type="date"
              value={paidOn}
              max={todayInDakar()}
              onChange={(e) => setPaidOn(e.target.value)}
              className={inputClass(!!fieldError)}
            />
          )}
        </Field>
      ) : null}

      <PanelError message={error} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          ref={confirmRef}
          tone="primary"
          onClick={confirm}
          disabled={busy}
          className="min-h-12 text-[17px] sm:min-w-[180px]"
        >
          {busy ? 'Envoi…' : 'Confirmer'}
        </Button>
        <Button tone="ghost" onClick={onCancel} disabled={busy}>
          Annuler
        </Button>
        {dateOpen ? null : (
          <Button tone="ghost" onClick={() => setDateOpen(true)} disabled={busy} className="sm:ml-auto">
            Autre date de paiement ?
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * B4 — Refuser. Le motif est obligatoire, et depuis v3.5.7 il est LU PAR LE
 * MEMBRE sur sa page (`last_rejection.reason`) : l'écran le dit au moment de
 * la saisie, c'est le seul endroit où l'on peut encore éviter une note
 * interne.
 */
export function RejectPanel({
  payment,
  onDone,
  onCancel,
}: {
  payment: Payment;
  onDone: (rejected: Payment) => void;
  onCancel: () => void;
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

  async function confirm() {
    if (busy) return;
    const text = reason.trim();
    const invalid =
      text.length < MIN_REJECTION_LENGTH
        ? `Expliquez le motif en ${MIN_REJECTION_LENGTH} caractères au moins : le membre le lira.`
        : null;
    setFieldError(invalid);
    if (invalid) {
      reasonRef.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      onDone(await rejectPayment(payment.id, text));
    } catch (cause) {
      if (isSessionError(cause)) return;
      setError(errorMessage(cause, 'Le paiement n’a pas pu être refusé.'));
      setBusy(false);
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-3 rounded-[var(--radius-sm)] border-2 border-late bg-late-soft p-3"
    >
      <p id={`${ids}-title`} className="m-0 font-semibold break-words">
        Refuser : <PaymentSummary payment={payment} />
      </p>
      <Field
        label="Motif du refus"
        required
        error={fieldError}
        hint="Ce motif sera affiché au membre sur sa page."
      >
        {(props) => (
          <textarea
            {...props}
            ref={reasonRef}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass(!!fieldError, 'py-2')}
          />
        )}
      </Field>

      <PanelError message={error} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button tone="danger" onClick={confirm} disabled={busy}>
          {busy ? 'Envoi…' : 'Refuser le paiement'}
        </Button>
        <Button tone="ghost" onClick={onCancel} disabled={busy}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
