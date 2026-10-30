'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError, declarePayment } from '@/lib/api';
import { formatTypedAmount } from '@/lib/typedAmount';
import {
  PAYMENT_METHODS,
  type Organisation,
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
  'Votre paiement n’a pas pu être signalé. Réessayez dans un instant.';

/** R4 : on branche sur le code, et on écrit nous-mêmes le message affiché. */
const PROOF_CODES: Record<string, string> = {
  mime_not_allowed:
    'Ce type de fichier n’est pas accepté : envoyez un JPG, un PNG, un WebP ou un PDF.',
  file_too_large: 'La capture dépasse 10 Mo.',
  upload_invalid:
    'La capture n’a pas pu être lue. Réessayez avec une autre image.',
};

/**
 * Les messages de validation de Laravel sont en ANGLAIS : `errors` ne sert qu'à
 * désigner le champ fautif, le libellé affiché est le nôtre.
 */
const FIELD_MESSAGES: Record<keyof DeclarationErrors, string> = {
  amount:
    'Vérifiez le montant : un nombre entier, sans dépasser ce qui reste à payer.',
  method: 'Choisissez le moyen de paiement utilisé.',
  reference: 'Vérifiez la référence du transfert (255 caractères au plus).',
  proof:
    'La capture n’a pas été acceptée : envoyez un JPG, un PNG, un WebP ou un PDF de 10 Mo au plus.',
};

const RELOAD_CODES: Record<string, string> = {
  amount_exceeds_balance:
    'Le montant dépasse ce qui reste à payer. Votre page vient d’être actualisée.',
  nothing_due: 'Aucune cotisation n’est réclamée pour le moment.',
  amount_due_unknown:
    'Le montant de votre cotisation n’est pas encore fixé. Contactez le bureau de votre association.',
};

/**
 * Les moyens proposés en puces, dans l'ordre où le membre les cherche : ceux
 * que l'association a configurés d'abord (Wave avant Orange Money), puis les
 * autres. Le premier est présélectionné.
 */
export function methodsFor(organisation: Organisation): PaymentMethod[] {
  const configured: PaymentMethod[] = [];
  if (organisation.wave_merchant_number) configured.push('wave');
  if (organisation.om_merchant_number) configured.push('om');
  const rest = PAYMENT_METHODS.map((m) => m.value).filter(
    (m) => !configured.includes(m),
  );
  return [...configured, ...rest];
}

/**
 * « J'ai payé » : la feuille courte qui signale un paiement.
 *
 * Le chemin normal fait DEUX touchers : « J'ai payé », puis « Confirmer ». Le
 * mode est déjà choisi, le montant est le solde ; tout le reste (autre montant,
 * référence, capture) est facultatif et replié.
 */
export function PaymentSheet({
  token,
  tenant,
  organisation,
  balance,
  balanceFormatted,
  onDeclared,
  onNeedsReload,
  onCancel,
}: {
  token: string;
  tenant: string;
  organisation: Organisation;
  /** `due.balance` : la borne haute du montant, et le montant par défaut. */
  balance: number;
  /** `due.balance_formatted` : le montant tel que le serveur l'écrit (R1). */
  balanceFormatted: string | null;
  /** 201 : le paiement est signalé, il faut recharger l'état. */
  onDeclared: () => void;
  /** Le serveur a changé d'avis : afficher ce message et recharger. */
  onNeedsReload: (message: string) => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const amountId = `${ids}-amount`;
  const referenceId = `${ids}-reference`;
  const proofId = `${ids}-proof`;

  const methods = methodsFor(organisation);

  // R1 : la valeur du champ est le seul nombre brut manipulé côté client.
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? 'wave');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [open, setOpen] = useState({ amount: false, reference: false, proof: false });
  const [errors, setErrors] = useState<DeclarationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);
  const methodRef = useRef<HTMLInputElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);
  const proofRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Le focus entre dans la feuille sans faire surgir le clavier (on vise le
  // titre, pas un champ), puis revient à « J'ai payé » à la fermeture.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);

  // Un champ en erreur se déplie : on ne peut pas corriger ce qu'on ne voit pas.
  function reveal(next: DeclarationErrors) {
    setOpen((prev) => ({
      amount: prev.amount || !!next.amount,
      reference: prev.reference || !!next.reference,
      proof: prev.proof || !!next.proof,
    }));
  }

  function focusFirstError(next: DeclarationErrors) {
    const target = next.amount
      ? amountRef
      : next.method
        ? methodRef
        : next.reference
          ? referenceRef
          : next.proof
            ? proofRef
            : null;
    // Le champ n'existe qu'une fois déplié : on attend le rendu.
    setTimeout(() => target?.current?.focus(), 0);
  }

  function showFieldErrors(next: DeclarationErrors) {
    setErrors(next);
    reveal(next);
    focusFirstError(next);
  }

  function handleServerError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError(GENERIC);
      return;
    }

    if (error.status === 409 && error.code === 'declaration_pending') {
      onNeedsReload('Un paiement est déjà en attente de confirmation par le bureau.');
      return;
    }

    if (error.status === 422) {
      if (error.code && error.code in PROOF_CODES) {
        showFieldErrors({ proof: PROOF_CODES[error.code] });
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
        showFieldErrors(fields);
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
    const next = validateDeclaration({ amount, method, reference, proof }, balance);
    setErrors(next);
    if (hasErrors(next)) {
      showFieldErrors(next);
      return;
    }

    const value = parseAmount(amount);
    if (value === null) return;

    setSending(true);
    try {
      await declarePayment(token, tenant, {
        amount: value,
        method,
        reference,
        proof,
      });
      onDeclared();
    } catch (error) {
      handleServerError(error);
      setSending(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !sending) {
      event.stopPropagation();
      onCancel();
    }
  }

  const typed = parseAmount(amount);
  // Le montant annoncé sur « Confirmer » : celui du serveur tant que la saisie
  // est le solde, la saisie réaffichée sinon (exception unique à R1, § D).
  const shownAmount =
    typed === balance && balanceFormatted
      ? balanceFormatted
      : typed !== null && typed > 0
        ? formatTypedAmount(typed)
        : null;
  const methodLabel = PAYMENT_METHODS.find((m) => m.value === method)?.label;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="flex max-h-[92dvh] w-full max-w-[420px] flex-col gap-4 overflow-y-auto rounded-t-[var(--radius-md)] bg-surface-raised p-4 pb-6 sm:rounded-[var(--radius-md)]"
      >
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="title m-0">
          Signaler mon paiement
        </h2>

        <form className="m-0 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          {/* Moyen de paiement : des puces, jamais une liste déroulante. */}
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="m-0 mb-2 p-0 font-semibold">Payé avec</legend>
            <div className="flex flex-wrap gap-2">
              {methods.map((value, index) => {
                const option = PAYMENT_METHODS.find((m) => m.value === value);
                const selected = value === method;
                return (
                  <label
                    key={value}
                    className={`relative inline-flex min-h-11 cursor-pointer items-center rounded-[var(--radius-pill)] border-2 px-4 font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${
                      selected
                        ? 'border-indigo bg-indigo text-on-indigo'
                        : 'border-line-strong bg-surface-raised text-ink'
                    }`}
                  >
                    <input
                      ref={index === 0 ? methodRef : undefined}
                      type="radio"
                      name="method"
                      value={value}
                      checked={selected}
                      onChange={() => setMethod(value)}
                      className="sr-only"
                    />
                    {option?.label ?? value}
                  </label>
                );
              })}
            </div>
            {errors.method ? (
              <span className="small font-semibold text-late">{errors.method}</span>
            ) : null}
          </fieldset>

          {/* Montant : le solde, sauf demande expresse. */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-semibold">Montant</span>
              {shownAmount ? (
                <span className="money tnum text-[20px] leading-7 font-bold">
                  {shownAmount}
                </span>
              ) : null}
            </div>
            <Fold
              open={open.amount}
              label="Payer un autre montant ?"
              onOpen={() => setOpen((o) => ({ ...o, amount: true }))}
            >
              <label htmlFor={amountId} className="small font-semibold">
                Montant payé, en FCFA
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
                Vous pouvez payer en plusieurs fois
                {balanceFormatted ? (
                  <>
                    , jusqu’à <span className="money">{balanceFormatted}</span>
                  </>
                ) : null}
                .
              </span>
              {errors.amount ? (
                <span id={`${amountId}-error`} className="small font-semibold text-late">
                  {errors.amount}
                </span>
              ) : null}
            </Fold>
          </div>

          {/* Référence : facultative pour tous les modes (v3.5.7). */}
          <Fold
            open={open.reference}
            label="Ajouter la référence du transfert (facultatif)"
            onOpen={() => setOpen((o) => ({ ...o, reference: true }))}
          >
            <label htmlFor={referenceId} className="small font-semibold">
              Référence du transfert{' '}
              <span className="font-normal text-ink-muted">(facultatif)</span>
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
              aria-invalid={errors.reference ? true : undefined}
              aria-describedby={errors.reference ? `${referenceId}-error` : undefined}
              className={`h-13 rounded-[var(--radius-sm)] border bg-surface-raised px-3 text-ink ${
                errors.reference ? 'border-late' : 'border-line-strong'
              }`}
            />
            {errors.reference ? (
              <span id={`${referenceId}-error`} className="small font-semibold text-late">
                {errors.reference}
              </span>
            ) : null}
          </Fold>

          {/* Capture : facultative. */}
          <Fold
            open={open.proof}
            label="Ajouter une capture d’écran (facultatif)"
            onOpen={() => setOpen((o) => ({ ...o, proof: true }))}
          >
            <input
              ref={proofRef}
              id={proofId}
              name="proof"
              type="file"
              accept={PROOF_ACCEPT}
              onChange={(e) => setProof(e.target.files?.[0] ?? null)}
              aria-label="Capture d’écran du paiement"
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
                {proof ? proof.name : 'Choisir une capture d’écran'}
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
          </Fold>

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
            {methodLabel && shownAmount ? (
              <p className="small m-0 text-center text-ink-muted">
                <span className="money">{shownAmount}</span> par {methodLabel}. Le
                bureau confirmera votre paiement.
              </p>
            ) : null}
            <button
              type="submit"
              disabled={sending}
              className="flex h-13 items-center justify-center rounded-[var(--radius-md)] bg-indigo text-[17px] font-bold text-on-indigo disabled:opacity-60"
            >
              {sending ? 'Envoi…' : 'Confirmer'}
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
      </div>
    </div>
  );
}

/** Un champ facultatif, replié derrière un lien tant qu'on n'en a pas besoin. */
function Fold({
  open,
  label,
  onOpen,
  children,
}: {
  open: boolean;
  label: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  if (open) return <div className="flex flex-col gap-[6px]">{children}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={false}
      className="flex min-h-11 items-center self-start bg-transparent p-0 text-left font-semibold text-indigo underline underline-offset-2"
    >
      {label}
    </button>
  );
}
