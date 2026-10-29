'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, declarePayment } from '@/lib/api';
import {
  METHODS_REQUIRING_REFERENCE,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@/lib/types';
import {
  hasErrors,
  parseAmount,
  PROOF_ACCEPT,
  validateDeclaration,
  type DeclarationErrors,
} from '@/lib/validation';
import { UploadIcon } from './Icons';

const GENERIC =
  'Votre confirmation n’a pas pu être envoyée. Réessayez dans un instant.';

/** R4 : on branche sur le code, et on écrit nous-mêmes le message affiché. */
const PROOF_CODES: Record<string, string> = {
  mime_not_allowed:
    'Ce type de fichier n’est pas accepté : envoyez un JPG, un PNG, un WebP ou un PDF.',
  file_too_large: 'Le justificatif dépasse 10 Mo.',
  upload_invalid:
    'Le justificatif n’a pas pu être lu. Réessayez avec une autre image.',
};

/**
 * Les messages de validation de Laravel sont en ANGLAIS : `errors` ne sert qu'à
 * désigner le champ fautif, le libellé affiché est le nôtre.
 */
const FIELD_MESSAGES: Record<keyof DeclarationErrors, string> = {
  amount:
    'Vérifiez le montant : un nombre entier, sans dépasser ce qui reste à payer.',
  method: 'Choisissez le moyen de paiement utilisé.',
  reference: 'Vérifiez la référence de la transaction (255 caractères au plus).',
  proof:
    'Le justificatif n’a pas été accepté : envoyez un JPG, un PNG, un WebP ou un PDF de 10 Mo au plus.',
};

const RELOAD_CODES: Record<string, string> = {
  amount_exceeds_balance:
    'Le montant dépasse ce qui reste à payer. Votre page vient d’être actualisée.',
  nothing_due: 'Aucune cotisation n’est réclamée pour le moment.',
  amount_due_unknown:
    'Le montant de votre cotisation n’est pas encore fixé. Contactez le bureau de votre association.',
};

export function DeclarationForm({
  token,
  tenant,
  balance,
  defaultMethod,
  onDeclared,
  onNeedsReload,
  onCancel,
}: {
  token: string;
  tenant: string;
  /** `due.balance` : la borne haute du montant déclarable. */
  balance: number;
  defaultMethod: PaymentMethod;
  /** 201 : la déclaration est enregistrée, il faut recharger l'état. */
  onDeclared: (message: string) => void;
  /** Le serveur a changé d'avis : afficher ce message et recharger. */
  onNeedsReload: (message: string) => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const amountId = `${ids}-amount`;
  const referenceId = `${ids}-reference`;
  const proofId = `${ids}-proof`;

  // R1 : la valeur du champ est le seul nombre brut manipulé côté client.
  // Elle n'est jamais mise en forme (ni espaces de milliers, ni décimales).
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<PaymentMethod>(defaultMethod);
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [errors, setErrors] = useState<DeclarationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);
  const methodRef = useRef<HTMLInputElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);
  const proofRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Le formulaire s'ouvre sur la même page : le focus doit l'y suivre, sans
  // faire surgir le clavier (on vise le titre, pas le champ).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Le message n'existe dans le DOM qu'une fois rendu : le focus le suit après
  // coup, pas dans le gestionnaire qui l'a posé.
  useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);

  const referenceRequired = METHODS_REQUIRING_REFERENCE.has(method);

  function focusFirstError(next: DeclarationErrors) {
    const target = next.amount
      ? amountRef.current
      : next.method
        ? methodRef.current
        : next.reference
          ? referenceRef.current
          : next.proof
            ? proofRef.current
            : null;
    target?.focus();
  }

  function handleServerError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError(GENERIC);
      return;
    }

    if (error.status === 409 && error.code === 'declaration_pending') {
      onNeedsReload(
        'Une déclaration est déjà en attente de validation par le bureau.',
      );
      return;
    }

    if (error.status === 422) {
      if (error.code && error.code in PROOF_CODES) {
        setErrors({ proof: PROOF_CODES[error.code] });
        proofRef.current?.focus();
        return;
      }
      if (error.code && error.code in RELOAD_CODES) {
        onNeedsReload(RELOAD_CODES[error.code] as string);
        return;
      }

      const fields: DeclarationErrors = {};
      for (const key of ['amount', 'method', 'reference', 'proof'] as const) {
        if (error.errors[key]?.length) fields[key] = FIELD_MESSAGES[key];
      }
      if (hasErrors(fields)) {
        setErrors(fields);
        focusFirstError(fields);
        return;
      }

      // R4 : un refus que cet écran ne sait pas lire ne se recopie pas.
      setFormError(GENERIC);
      return;
    }

    if (error.status === 429) {
      setFormError('Trop de tentatives, réessayez dans une minute.');
      return;
    }

    setFormError(GENERIC);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;

    setFormError(null);
    const draft = { amount, method, reference, proof };
    const next = validateDeclaration(draft, balance);
    setErrors(next);
    if (hasErrors(next)) {
      focusFirstError(next);
      return;
    }

    const value = parseAmount(amount);
    if (value === null) return;

    setSending(true);
    try {
      const result = await declarePayment(token, tenant, {
        amount: value,
        method,
        reference,
        proof,
      });
      onDeclared(
        result.message ||
          `Votre confirmation de ${result.amount_formatted} est enregistrée.`,
      );
    } catch (error) {
      handleServerError(error);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 ref={headingRef} tabIndex={-1} className="title m-0">
          Confirmer mon paiement
        </h2>
        <p className="m-0 text-ink-muted">
          Le bureau vérifiera votre paiement, puis votre reçu apparaîtra sur
          cette page.
        </p>
      </div>

      <form className="m-0 flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        {/* Montant */}
        <div className="flex flex-col gap-[6px]">
          <label htmlFor={amountId} className="font-semibold">
            Montant payé
          </label>
          <div
            className={`flex h-13 items-center rounded-[var(--radius-sm)] border bg-surface-raised px-3 ${
              errors.amount ? 'border-late' : 'border-line-strong'
            }`}
          >
            <input
              ref={amountRef}
              id={amountId}
              name="amount"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={`${amountId}-hint${errors.amount ? ` ${amountId}-error` : ''}`}
              className="tnum min-w-0 grow border-0 bg-transparent text-[20px] font-bold text-ink outline-none"
            />
            <span className="font-semibold text-ink-muted">FCFA</span>
          </div>
          <span id={`${amountId}-hint`} className="small text-ink-muted">
            Vous pouvez payer en plusieurs fois.
          </span>
          {errors.amount ? (
            <span id={`${amountId}-error`} className="small font-semibold text-late">
              {errors.amount}
            </span>
          ) : null}
        </div>

        {/* Moyen de paiement */}
        <fieldset
          className="m-0 flex flex-col gap-[6px] border-0 p-0"
          aria-describedby={errors.method ? `${ids}-method-error` : undefined}
        >
          <legend className="m-0 mb-[6px] p-0 font-semibold">Payé avec</legend>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map((option, index) => {
              const selected = option.value === method;
              return (
                <label
                  key={option.value}
                  className={`flex h-13 cursor-pointer items-center gap-[10px] rounded-[var(--radius-sm)] border-2 px-3 font-semibold text-ink ${
                    selected
                      ? 'border-indigo bg-indigo-soft'
                      : 'border-line bg-surface-raised'
                  }`}
                >
                  <input
                    ref={index === 0 ? methodRef : undefined}
                    type="radio"
                    name="method"
                    value={option.value}
                    checked={selected}
                    onChange={() => setMethod(option.value)}
                    className="m-0 size-5 shrink-0 accent-[var(--indigo)]"
                  />
                  <span className="min-w-0 truncate">{option.label}</span>
                </label>
              );
            })}
          </div>
          {errors.method ? (
            <span
              id={`${ids}-method-error`}
              className="small font-semibold text-late"
            >
              {errors.method}
            </span>
          ) : null}
        </fieldset>

        {/* Référence */}
        <div className="flex flex-col gap-[6px]">
          <label htmlFor={referenceId} className="font-semibold">
            Référence de la transaction{' '}
            {referenceRequired ? (
              <span className="text-late">*</span>
            ) : (
              <span className="font-normal text-ink-muted">(facultatif)</span>
            )}
          </label>
          <input
            ref={referenceRef}
            id={referenceId}
            name="reference"
            type="text"
            maxLength={255}
            autoComplete="off"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            required={referenceRequired}
            aria-required={referenceRequired || undefined}
            aria-invalid={errors.reference ? true : undefined}
            aria-describedby={`${referenceId}-hint${errors.reference ? ` ${referenceId}-error` : ''}`}
            className={`h-13 rounded-[var(--radius-sm)] border bg-surface-raised px-3 text-ink ${
              errors.reference ? 'border-late' : 'border-line-strong'
            }`}
          />
          <span id={`${referenceId}-hint`} className="small text-ink-muted">
            {referenceRequired
              ? 'Elle figure dans le SMS reçu après l’envoi.'
              : 'Numéro du virement, du chèque, ou toute indication utile.'}
          </span>
          {errors.reference ? (
            <span
              id={`${referenceId}-error`}
              className="small font-semibold text-late"
            >
              {errors.reference}
            </span>
          ) : null}
        </div>

        {/* Justificatif */}
        <div className="flex flex-col gap-[6px]">
          <label htmlFor={proofId} className="font-semibold">
            Justificatif{' '}
            <span className="font-normal text-ink-muted">(facultatif)</span>
          </label>
          <input
            ref={proofRef}
            id={proofId}
            name="proof"
            type="file"
            accept={PROOF_ACCEPT}
            onChange={(e) => setProof(e.target.files?.[0] ?? null)}
            aria-invalid={errors.proof ? true : undefined}
            aria-describedby={`${proofId}-hint${errors.proof ? ` ${proofId}-error` : ''}`}
            className="peer sr-only"
          />
          <label
            htmlFor={proofId}
            className={`flex min-h-13 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-dashed bg-surface-raised px-3 py-2 text-center font-semibold text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] ${
              errors.proof ? 'border-late' : 'border-line-strong'
            }`}
          >
            <UploadIcon />
            <span className="min-w-0 break-words">
              {proof ? proof.name : 'Ajouter une photo du SMS'}
            </span>
          </label>
          <span id={`${proofId}-hint`} className="small text-ink-muted">
            JPG, PNG, WebP ou PDF, 10 Mo maximum.
          </span>
          {errors.proof ? (
            <span id={`${proofId}-error`} className="small font-semibold text-late">
              {errors.proof}
            </span>
          ) : null}
        </div>

        {/* Résultat de l'envoi */}
        <div role="alert" aria-live="polite">
          {formError ? (
            <p
              ref={formErrorRef}
              tabIndex={-1}
              className="m-0 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late"
            >
              {formError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="submit"
            disabled={sending}
            className="flex h-13 items-center justify-center rounded-[var(--radius-md)] bg-indigo text-[17px] font-bold text-on-indigo disabled:opacity-60"
          >
            {sending ? 'Envoi…' : 'Envoyer ma confirmation'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-transparent font-semibold text-indigo disabled:opacity-60"
          >
            Annuler
          </button>
        </div>
      </form>
    </section>
  );
}
