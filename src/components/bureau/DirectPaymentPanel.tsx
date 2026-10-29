'use client';

import { useState } from 'react';
import { createDirectPayment, isSessionError } from '@/lib/bureau/api';
import { errorMessage, invalidFields } from '@/lib/bureau/messages';
import type { MemberDetail, MemberDue, Payment } from '@/lib/bureau/types';
import {
  METHODS_REQUIRING_REFERENCE,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@/lib/types';
import { formatDate, todayInDakar } from '@/lib/dates';
import { parseAmount } from '@/lib/validation';
import { ConfirmDialog, Recap } from './ConfirmDialog';
import { dateError, isModeUnsupported, periodLabel } from './format';
import { Button, Field, inputClass, Panel } from './ui';

/**
 * La période que la saisie directe créditera, telle que la fiche la montre.
 *
 * ⚠️ C'est le serveur qui choisit (`payableDue()`, piège 8) : aucun paramètre
 * de période n'existe. On affiche la plus ancienne période encore ouverte, qui
 * est celle que le membre doit d'abord ; la réponse dira laquelle a été
 * réellement créditée.
 */
export function openDue(member: MemberDetail): MemberDue | null {
  const open = member.dues.filter((d) => d.status === 'due' || d.status === 'partielle');
  if (open.length === 0) return null;
  return [...open].sort((a, b) => a.period_start.localeCompare(b.period_start))[0] ?? null;
}

type Errors = Partial<Record<'amount' | 'method' | 'paid_on' | 'reference', string>>;

const FIELD_ERRORS: Required<Errors> = {
  amount: 'Vérifiez le montant.',
  method: 'Choisissez le mode de paiement.',
  paid_on: 'Indiquez une date de paiement valide.',
  reference: 'Vérifiez la référence (255 caractères au plus).',
};

/**
 * B9 — un versement reçu en main propre. Il est enregistré ET validé dans le
 * même geste, et un reçu est émis : la confirmation R9 le dit.
 */
export function DirectPaymentPanel({
  member,
  onDone,
  onClose,
  onModeUnsupported,
}: {
  member: MemberDetail;
  onDone: (payment: Payment) => void;
  onClose: () => void;
  onModeUnsupported: () => void;
}) {
  const due = openDue(member);
  // La borne haute, quand elle est CONNUE (null = inconnu, pas zéro).
  const balance = due ? due.balance_due : member.balance_due;
  const balanceFormatted = due ? due.balance_due_formatted : member.balance_due_formatted;

  // R1 : la valeur du champ est le seul nombre brut manipulé, jamais mis en forme.
  const [amount, setAmount] = useState(balance !== null && balance > 0 ? String(balance) : '');
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [paidOn, setPaidOn] = useState(todayInDakar());
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const referenceRequired = METHODS_REQUIRING_REFERENCE.has(method);
  const methodLabel = PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
  const period = due ? periodLabel(due.period_start, due.period_end) : '';

  function validate(): Errors {
    const next: Errors = {};
    const value = parseAmount(amount);
    if (value === null || value < 1) {
      next.amount = 'Indiquez le montant reçu, en chiffres.';
    } else if (balance !== null && value > balance) {
      next.amount = `Le montant ne peut pas dépasser ce qui reste à payer (${balanceFormatted ?? '—'}).`;
    }
    const invalidDate = dateError(paidOn, 'la date du paiement');
    if (invalidDate) next.paid_on = invalidDate;
    if (referenceRequired && reference.trim() === '') {
      next.reference = 'La référence est obligatoire pour Orange Money et Wave.';
    } else if (reference.trim().length > 255) {
      next.reference = 'La référence ne doit pas dépasser 255 caractères.';
    }
    return next;
  }

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length === 0) {
      setError(null);
      setConfirming(true);
    }
  }

  async function confirm() {
    const value = parseAmount(amount);
    if (busy || value === null) return;
    setBusy(true);
    setError(null);
    try {
      const payment = await createDirectPayment(member.id, {
        amount: value,
        method,
        paid_on: paidOn,
        reference: reference.trim() || null,
      });
      onDone(payment);
    } catch (cause) {
      if (isSessionError(cause)) return;
      if (isModeUnsupported(cause)) onModeUnsupported();
      const fields = invalidFields(cause).filter((f): f is keyof Errors => f in FIELD_ERRORS);
      if (fields.length > 0) {
        const mapped: Errors = {};
        for (const f of fields) mapped[f] = FIELD_ERRORS[f];
        setErrors(mapped);
        setConfirming(false);
      } else {
        setError(errorMessage(cause, 'Le versement n’a pas pu être enregistré.'));
      }
    } finally {
      setBusy(false);
    }
  }

  const value = parseAmount(amount);

  return (
    <Panel
      title="Enregistrer un versement"
      actions={
        <Button tone="ghost" onClick={onClose}>
          Fermer
        </Button>
      }
    >
      <p className="m-0 text-ink-muted">
        Pour un versement reçu en main propre. Il sera validé immédiatement et
        un reçu sera émis.
      </p>
      <p className="m-0 rounded-[var(--radius-sm)] bg-indigo-soft p-3 font-semibold text-indigo">
        {period
          ? `Cotisation ${period}${balanceFormatted ? ` — reste à payer ${balanceFormatted}` : ''}`
          : 'Aucune période ouverte sur la fiche : le versement sera rattaché à la cotisation que le serveur réclame.'}
      </p>

      <form className="m-0 flex flex-col gap-4" onSubmit={review} noValidate>
        <Field
          label="Montant reçu"
          required
          error={errors.amount}
          hint={balanceFormatted ? `Au plus ${balanceFormatted}.` : undefined}
        >
          {(props) => (
            <div className={`flex min-h-11 items-center rounded-[var(--radius-sm)] border bg-surface-raised px-3 ${errors.amount ? 'border-late' : 'border-line-strong'}`}>
              <input
                {...props}
                name="amount"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                className="tnum min-w-0 grow border-0 bg-transparent text-[18px] font-bold text-ink outline-none"
              />
              <span className="font-semibold text-ink-muted">FCFA</span>
            </div>
          )}
        </Field>

        <fieldset className="m-0 flex flex-col gap-[6px] border-0 p-0">
          <legend className="m-0 mb-[6px] p-0 font-semibold">Mode de paiement</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PAYMENT_METHODS.map((option) => (
              <label
                key={option.value}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border-2 px-3 font-semibold ${
                  option.value === method ? 'border-indigo bg-indigo-soft' : 'border-line bg-surface-raised'
                }`}
              >
                <input
                  type="radio"
                  name="method"
                  value={option.value}
                  checked={option.value === method}
                  onChange={() => setMethod(option.value)}
                  className="m-0 size-5 shrink-0 accent-[var(--indigo)]"
                />
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date du paiement" required error={errors.paid_on}>
            {(props) => (
              <input
                {...props}
                name="paid_on"
                type="date"
                max={todayInDakar()}
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                className={inputClass(!!errors.paid_on)}
              />
            )}
          </Field>
          <Field
            label="Référence"
            required={referenceRequired}
            optional={!referenceRequired}
            error={errors.reference}
          >
            {(props) => (
              <input
                {...props}
                name="reference"
                maxLength={255}
                autoComplete="off"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className={inputClass(!!errors.reference)}
              />
            )}
          </Field>
        </div>

        <div className="flex justify-end">
          <Button tone="primary" type="submit">
            Vérifier le versement
          </Button>
        </div>
      </form>

      {confirming && value !== null ? (
        <ConfirmDialog
          title="Enregistrer ce versement ?"
          confirmLabel="Enregistrer et émettre le reçu"
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={() => setConfirming(false)}
        >
          <Recap
            rows={[
              { label: 'Membre', value: member.name },
              {
                // R1 : le client ne formate aucun montant. On montre la saisie
                // brute, et le montant servi quand elle solde la période.
                label: 'Montant saisi',
                value: `${amount} FCFA`,
              },
              {
                label: 'Soit',
                value:
                  balance !== null && value === balance && balanceFormatted
                    ? `le solde de la période, ${balanceFormatted}`
                    : null,
              },
              { label: 'Mode', value: methodLabel },
              { label: 'Référence', value: reference.trim() || '—' },
              { label: 'Payé le', value: formatDate(paidOn) },
              { label: 'Période', value: period ? `Cotisation ${period}` : 'Choisie par le serveur' },
            ]}
          />
          <p className="m-0">
            Ce versement sera enregistré et validé immédiatement, et un reçu
            sera émis.
          </p>
        </ConfirmDialog>
      ) : null}
    </Panel>
  );
}
