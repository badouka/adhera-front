'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createDirectPayment, isSessionError } from '@/lib/bureau/api';
import { errorMessage, invalidFields } from '@/lib/bureau/messages';
import type { MemberDetail, MemberDue, Payment } from '@/lib/bureau/types';
import { todayInDakar } from '@/lib/dates';
import { formatTypedAmount } from '@/lib/typedAmount';
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/types';
import { parseAmount } from '@/lib/validation';
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

/** Espèces d'abord : c'est le cas le plus fréquent d'un encaissement. */
const METHOD_ORDER: PaymentMethod[] = ['especes', 'wave', 'om', 'virement', 'cheque'];

type Errors = Partial<Record<'amount' | 'method' | 'paid_on' | 'reference', string>>;

const FIELD_ERRORS: Required<Errors> = {
  amount: 'Vérifiez le montant.',
  method: 'Choisissez le mode de paiement.',
  paid_on: 'Indiquez une date de paiement valide.',
  reference: 'Vérifiez la référence (255 caractères au plus).',
};

/**
 * « Encaisser » — un versement reçu en main propre (B9). Il est enregistré ET
 * validé dans le même geste, et un reçu est émis.
 *
 * R9 tient dans le panneau : le récapitulatif est la ligne posée au-dessus du
 * bouton, et le bouton dit le montant. Pas de seconde fenêtre.
 */
export function DirectPaymentPanel({
  member,
  onDone,
  onClose,
  onModeUnsupported,
  closeLabel = 'Fermer',
}: {
  member: MemberDetail;
  onDone: (payment: Payment) => void;
  onClose: () => void;
  onModeUnsupported: () => void;
  closeLabel?: string;
}) {
  const ids = useId();
  const due = openDue(member);
  // La borne haute, quand elle est CONNUE (null = inconnu, pas zéro).
  const balance = due ? due.balance_due : member.balance_due;
  const balanceFormatted = due ? due.balance_due_formatted : member.balance_due_formatted;

  // R1 : la valeur du champ est le seul nombre brut manipulé.
  const [amount, setAmount] = useState(balance !== null && balance > 0 ? String(balance) : '');
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [paidOn, setPaidOn] = useState(todayInDakar());
  const [reference, setReference] = useState('');
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const methodLabel = PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
  const period = due ? periodLabel(due.period_start, due.period_end) : '';

  const typed = parseAmount(amount);
  // Le montant annoncé : celui du serveur tant que la saisie est le solde, la
  // saisie réaffichée sinon (exception unique à R1, brief § D).
  const shownAmount =
    typed !== null && typed === balance && balanceFormatted
      ? balanceFormatted
      : typed !== null && typed > 0
        ? formatTypedAmount(typed)
        : null;

  function validate(): Errors {
    const next: Errors = {};
    if (typed === null || typed < 1) {
      next.amount = 'Indiquez le montant reçu, en chiffres.';
    } else if (balance !== null && typed > balance) {
      next.amount = `Le montant ne peut pas dépasser ce qui reste à payer (${balanceFormatted ?? '—'}).`;
    }
    const invalidDate = dateError(paidOn, 'la date du paiement');
    if (invalidDate) next.paid_on = invalidDate;
    if (reference.trim().length > 255) {
      next.reference = 'La référence ne doit pas dépasser 255 caractères.';
    }
    return next;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const next = validate();
    setErrors(next);
    if (next.reference) setReferenceOpen(true);
    if (Object.keys(next).length > 0 || typed === null) return;

    setBusy(true);
    setError(null);
    try {
      const payment = await createDirectPayment(member.id, {
        amount: typed,
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
        if (mapped.reference) setReferenceOpen(true);
      } else {
        setError(errorMessage(cause, 'Le paiement n’a pas pu être encaissé.'));
      }
      setBusy(false);
    }
  }

  return (
    <Panel
      title={member.name}
      actions={
        <Button tone="ghost" onClick={onClose} disabled={busy}>
          {closeLabel}
        </Button>
      }
    >
      <p className="m-0 rounded-[var(--radius-sm)] bg-indigo-soft p-3 font-semibold text-indigo">
        {period ? (
          <>
            Cotisation {period}
            {balanceFormatted ? (
              <>
                {' '}
                — reste <span className="money">{balanceFormatted}</span>
              </>
            ) : null}
          </>
        ) : (
          'Aucune période ouverte sur la fiche : le paiement ira à la cotisation que le serveur réclame.'
        )}
      </p>

      <form className="m-0 flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field
          label="Montant reçu"
          error={errors.amount}
          hint={
            shownAmount && typed !== balance ? (
              <>
                Soit <span className="money font-semibold text-ink">{shownAmount}</span>
              </>
            ) : undefined
          }
        >
          {(props) => (
            <div
              className={`flex min-h-12 items-center rounded-[var(--radius-sm)] border bg-surface-raised px-3 ${errors.amount ? 'border-late' : 'border-line-strong'}`}
            >
              <input
                {...props}
                name="amount"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={amount}
                // Le solde prérempli se remplace d'une frappe, sans l'effacer chiffre
                // par chiffre.
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                className="tnum min-w-0 grow border-0 bg-transparent text-[20px] font-bold text-ink outline-none"
              />
              <span className="font-semibold text-ink-muted">FCFA</span>
            </div>
          )}
        </Field>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="m-0 mb-2 p-0 font-semibold">Mode</legend>
          <div className="flex flex-wrap gap-2">
            {METHOD_ORDER.map((value) => {
              const selected = value === method;
              return (
                <label
                  key={value}
                  className={`inline-flex min-h-11 cursor-pointer items-center rounded-[var(--radius-pill)] border-2 px-4 font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${
                    selected
                      ? 'border-indigo bg-indigo text-on-indigo'
                      : 'border-line-strong bg-surface-raised text-ink'
                  }`}
                >
                  <input
                    type="radio"
                    name={`${ids}-method`}
                    value={value}
                    checked={selected}
                    onChange={() => setMethod(value)}
                    className="sr-only"
                  />
                  {PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date du paiement" error={errors.paid_on}>
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
          {referenceOpen ? (
            <Field label="Référence" optional error={errors.reference}>
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
          ) : (
            <button
              type="button"
              onClick={() => setReferenceOpen(true)}
              className="flex min-h-11 items-center self-end bg-transparent p-0 text-left font-semibold text-indigo underline underline-offset-2"
            >
              Ajouter une référence (facultatif)
            </button>
          )}
        </div>

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

        <div className="flex flex-col gap-2">
          {/* R9 : le récapitulatif, sur une ligne, juste au-dessus du bouton. */}
          <p className="m-0 font-semibold break-words" data-testid="recap">
            {member.name} — <span className="money">{shownAmount ?? '—'}</span> —{' '}
            {methodLabel} — un reçu sera émis
          </p>
          <Button tone="primary" type="submit" disabled={busy} className="min-h-13 text-[17px]">
            {busy ? (
              'Encaissement…'
            ) : shownAmount ? (
              // Un seul enfant flex : sinon le `gap` du bouton s'ajoute à l'espace.
              <span>
                Encaisser <span className="money">{shownAmount}</span>
              </span>
            ) : (
              'Encaisser'
            )}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
