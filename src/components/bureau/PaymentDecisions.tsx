'use client';

import { useState } from 'react';
import { isSessionError, rejectPayment, validatePayment } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import type { Payment } from '@/lib/bureau/types';
import { formatDateTime, todayInDakar } from '@/lib/dates';
import { ConfirmDialog, Recap } from './ConfirmDialog';
import { dateError, isModeUnsupported, periodLabel } from './format';
import { Field, inputClass } from './ui';

/** Le motif d'un rejet : le membre le lira. 10 caractères au moins. */
export const MIN_REJECTION_LENGTH = 10;

function recapRows(payment: Payment) {
  return [
    { label: 'Membre', value: payment.member_name },
    { label: 'Montant', value: payment.amount_formatted },
    { label: 'Mode', value: payment.method_label },
    { label: 'Référence', value: payment.reference?.trim() || '—' },
    {
      label: 'Période',
      value: periodLabel(payment.due?.period_start, payment.due?.period_end),
    },
    { label: 'Déclaré le', value: formatDateTime(payment.declared_at) },
  ];
}

/**
 * B3 — Valider. La date du paiement est préremplie avec `paid_on`. Une
 * validation crédite la période et ne se réécrit jamais : la confirmation le
 * dit avant le clic.
 */
export function ValidateDialog({
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
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    const invalid = dateError(paidOn, 'la date du paiement');
    setFieldError(invalid);
    if (invalid) return;

    setBusy(true);
    setError(null);
    try {
      onDone(await validatePayment(payment.id, paidOn));
    } catch (cause) {
      if (isSessionError(cause)) return;
      if (isModeUnsupported(cause)) onModeUnsupported();
      setError(errorMessage(cause, 'Le versement n’a pas pu être validé.'));
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title="Valider ce versement ?"
      confirmLabel="Valider et émettre le reçu"
      busy={busy}
      error={error}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      <Recap rows={recapRows(payment)} />
      <Field
        label="Date du paiement"
        error={fieldError}
        hint="Celle qui figurera sur le reçu."
      >
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
      <p className="m-0">
        Vérifiez d’abord que ce montant est bien arrivé sur le compte de
        l’association. Un versement validé ne peut plus être modifié.
      </p>
    </ConfirmDialog>
  );
}

/**
 * B4 — Rejeter. Le motif est obligatoire et reste dans `rejection_reason`.
 *
 * ⚠️ La page du membre ne le montre pas : sa charge publique ne porte ni rejet
 * ni motif (contrat §8). Le membre voit seulement sa déclaration disparaître et
 * peut en refaire une ; l'écran ne promet donc rien de plus au bureau.
 */
export function RejectDialog({
  payment,
  onDone,
  onCancel,
}: {
  payment: Payment;
  onDone: (rejected: Payment) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    const text = reason.trim();
    const invalid =
      text.length < MIN_REJECTION_LENGTH
        ? `Expliquez le motif en ${MIN_REJECTION_LENGTH} caractères au moins : le membre le lira.`
        : null;
    setFieldError(invalid);
    if (invalid) return;

    setBusy(true);
    setError(null);
    try {
      onDone(await rejectPayment(payment.id, text));
    } catch (cause) {
      if (isSessionError(cause)) return;
      setError(errorMessage(cause, 'La déclaration n’a pas pu être rejetée.'));
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title="Rejeter cette déclaration ?"
      confirmLabel="Rejeter la déclaration"
      confirmTone="danger"
      busy={busy}
      error={error}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      <Recap rows={recapRows(payment)} />
      <Field
        label="Motif du rejet"
        required
        error={fieldError}
        hint="Le motif reste visible dans l’onglet « Rejetés », mais ne s’affiche pas sur la page du membre. Celui-ci pourra déclarer à nouveau son versement."
      >
        {(props) => (
          <textarea
            {...props}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass(!!fieldError, 'py-2')}
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}
