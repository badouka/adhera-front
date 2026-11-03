'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useBackBar, useBureau } from '@/components/bureau/BureauContext';
import { dateError, isModeUnsupported } from '@/components/bureau/format';
import { SearchIcon } from '@/components/bureau/Icons';
import { DuplicateQuestion } from '@/components/bureau/simple/Duplicate';
import { Recorded } from '@/components/bureau/simple/Recorded';
import {
  bigButtonClass,
  Button,
  inputClass,
  Label,
  LINK_BUTTON,
  Notice,
  Skeleton,
} from '@/components/bureau/ui';
import { Pastille } from '@/components/Pastille';
import { ApiError, fieldMessages } from '@/lib/api';
import {
  createDirectPayment,
  getMember,
  isSessionError,
  listMembers,
} from '@/lib/bureau/api';
import { openDue } from '@/lib/bureau/dues';
import { possibleDuplicate } from '@/lib/bureau/duplicate';
import { setFlash } from '@/lib/bureau/flash';
import { errorMessage, PAYMENT_NETWORK_MESSAGE } from '@/lib/bureau/messages';
import type {
  ExistingPayment,
  MemberDetail,
  MemberListItem,
  PaymentWithShare,
} from '@/lib/bureau/types';
import { firstName, methodPhrase } from '@/lib/bureau/words';
import { formatDate, todayInDakar } from '@/lib/dates';
import { newIdempotencyKey, useIdempotencyKey } from '@/lib/idempotency';
import { formatTypedAmount } from '@/lib/typedAmount';
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/types';
import { parseAmount } from '@/lib/validation';

/** La frappe s'envoie au serveur après 300 ms de silence. */
const SEARCH_DEBOUNCE_MS = 300;

/** Les cinq moyens, dans l'ordre de la maquette : les espèces d'abord. */
export const METHOD_CHOICES: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: 'especes', label: 'Espèces' },
  { value: 'wave', label: 'Wave' },
  { value: 'om', label: 'Orange Money' },
  { value: 'virement', label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
];

function methodLabel(method: PaymentMethod): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

type Errors = Partial<Record<'amount' | 'method' | 'paid_on' | 'reference', string>>;
const FIELDS: ReadonlyArray<keyof Errors> = ['amount', 'method', 'paid_on', 'reference'];

type View =
  | { kind: 'form' }
  | { kind: 'duplicate'; existing: ExistingPayment }
  | { kind: 'recorded'; payment: PaymentWithShare };

type Picked =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; member: MemberDetail };

/**
 * La phrase « Vous allez enregistrer » (R9) : qui, combien, comment, quand,
 * et ce qui en suit. Le montant est la SAISIE, réaffichée par
 * `formatTypedAmount` (l'exception unique à R1) ; ce qui restera dû se dit
 * d'après le reste à payer servi, sans rien recalculer d'autre.
 */
export function recap({
  member,
  amount,
  method,
  date,
  today,
}: {
  member: MemberDetail;
  amount: number | null;
  method: PaymentMethod;
  date: string;
  today: string;
}): { who: string; amount: string; how: string; when: string; after: string } {
  const who = firstName(member);
  const when = date === today ? 'aujourd’hui' : formatDate(date) ? `le ${formatDate(date)}` : '';
  const balance = member.balance_due;
  let after = '';
  if (amount !== null && amount > 0 && balance !== null && balance > 0) {
    after =
      amount >= balance
        ? `${who} sera à jour, et son reçu sera prêt.`
        : `${who} devra encore ${formatTypedAmount(balance - amount)}.`;
  }
  return {
    who: member.name,
    amount: amount !== null && amount > 0 ? formatTypedAmount(amount) : '—',
    how: methodPhrase(method, methodLabel(method)),
    when,
    after,
  };
}

/**
 * Écrans 4, 5 et 6 — « Un membre a payé ». Quatre questions numérotées (qui,
 * combien, comment, quand), puis « Vous allez enregistrer » et un seul bouton.
 *
 * - La clé `Idempotency-Key` naît à l'ouverture de l'écran (§11.1).
 * - `409 possible_duplicate` (§18.1) ouvre « Est-ce le même paiement ? » ;
 *   « Non » rejoue la requête avec `confirm_duplicate` et une clé NEUVE : la
 *   même clé avec un autre corps serait refusée.
 * - La date choisie est toujours réécrite en toutes lettres (P7).
 */
export default function EnregistrerPage() {
  const router = useRouter();
  const { modeSupported, markModeUnsupported } = useBureau();
  const ids = useId();
  const today = todayInDakar();

  const [fromFiche, setFromFiche] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>({ kind: 'none' });
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [otherDay, setOtherDay] = useState(false);
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState('');
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [duplicateLink, setDuplicateLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>({ kind: 'form' });
  const [idempotencyKey, renewKey] = useIdempotencyKey();
  // La clé du « deuxième paiement » : neuve, puis gardée tant qu'il n'a pas abouti.
  const replayKey = useRef<string | null>(null);

  const choose = useCallback(async (id: string) => {
    setPicked({ kind: 'loading' });
    try {
      const member = await getMember(id);
      setPicked({ kind: 'ready', member });
      const due = openDue(member);
      const balance = due ? due.balance_due : member.balance_due;
      setAmount(balance !== null && balance > 0 ? String(balance) : '');
      setErrors({});
      setError(null);
      setDuplicateLink(null);
    } catch (cause) {
      if (isSessionError(cause)) return;
      if (isModeUnsupported(cause)) markModeUnsupported();
      setPicked({
        kind: 'error',
        // Le 404 nomme une classe PHP (piège 11) : on ne le recopie jamais.
        message:
          cause instanceof ApiError && cause.status === 404
            ? 'Membre introuvable.'
            : errorMessage(cause, 'La fiche du membre n’a pas pu être chargée.'),
      });
    }
  }, [markModeUnsupported]);

  // `?membre={id}` : on arrive de la fiche ou de la liste, le membre est choisi.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('membre');
    if (id) {
      setFromFiche(id);
      void choose(id);
    }
  }, [choose]);

  const goBackToForm = useCallback(() => {
    setError(null);
    setView({ kind: 'form' });
  }, []);

  const backHref = fromFiche ? `/bureau/membres/${encodeURIComponent(fromFiche)}` : '/bureau';
  useBackBar(
    view.kind === 'recorded'
      ? null
      : view.kind === 'duplicate'
        ? { href: '/bureau/enregistrer', label: 'Retour', onClick: goBackToForm }
        : { href: backHref, label: 'Retour' },
  );

  function reset() {
    renewKey();
    replayKey.current = null;
    setPicked({ kind: 'none' });
    setFromFiche(null);
    setAmount('');
    setMethod('especes');
    setOtherDay(false);
    setPaidOn(todayInDakar());
    setReference('');
    setReferenceOpen(false);
    setErrors({});
    setError(null);
    setDuplicateLink(null);
    setView({ kind: 'form' });
  }

  const member = picked.kind === 'ready' ? picked.member : null;
  const due = member ? openDue(member) : null;
  const limit = member ? (due ? due.balance_due : member.balance_due) : null;
  const limitFormatted = member
    ? due
      ? due.balance_due_formatted
      : member.balance_due_formatted
    : null;
  const typed = parseAmount(amount);

  function validate(): Errors {
    const next: Errors = {};
    if (typed === null || typed < 1) {
      next.amount = 'Indiquez le montant reçu, en chiffres.';
    } else if (limit !== null && limit > 0 && typed > limit) {
      next.amount = `Le montant ne peut pas dépasser ce qui reste à payer (${limitFormatted ?? '—'}).`;
    }
    const invalidDate = dateError(paidOn, 'la date du paiement');
    if (invalidDate) next.paid_on = invalidDate;
    if (reference.trim().length > 255) {
      next.reference = 'Le numéro de transaction ne doit pas dépasser 255 caractères.';
    }
    return next;
  }

  async function save(confirmDuplicate: boolean) {
    if (!member || busy) return;
    const next = validate();
    setErrors(next);
    if (next.reference) setReferenceOpen(true);
    if (next.paid_on) setOtherDay(true);
    if (Object.keys(next).length > 0 || typed === null) return;

    let key = idempotencyKey;
    if (confirmDuplicate) {
      replayKey.current ??= newIdempotencyKey();
      key = replayKey.current;
    }

    setBusy(true);
    setError(null);
    setDuplicateLink(null);
    try {
      const payment = await createDirectPayment(
        member.id,
        { amount: typed, method, paid_on: paidOn, reference: reference.trim() || null },
        key,
        { confirmDuplicate },
      );
      // Un succès clôt l'intention : le prochain paiement aura sa clé.
      renewKey();
      replayKey.current = null;
      setView({ kind: 'recorded', payment });
    } catch (cause) {
      if (isSessionError(cause)) return;
      if (isModeUnsupported(cause)) markModeUnsupported();
      const existing = possibleDuplicate(cause);
      if (existing && !confirmDuplicate) {
        setView({ kind: 'duplicate', existing });
      } else if (cause instanceof ApiError && cause.code === 'duplicate_payment') {
        // Le filet des deux minutes (§11.2) : on conduit au paiement existant.
        setView({ kind: 'form' });
        setError(errorMessage(cause, ''));
        setDuplicateLink(`/bureau/membres/${encodeURIComponent(member.id)}`);
      } else if (cause instanceof ApiError && cause.code === 'idempotency_key_reused') {
        // Le contenu a changé depuis un envoi resté sans réponse : nouvelle
        // intention, nouvelle clé, et le trésorier relit.
        if (confirmDuplicate) replayKey.current = null;
        else renewKey();
        setView({ kind: 'form' });
        setError(errorMessage(cause, ''));
      } else {
        const messages = fieldMessages(cause);
        const mapped: Errors = {};
        for (const f of FIELDS) if (messages[f]) mapped[f] = messages[f];
        if (Object.keys(mapped).length > 0) {
          setView({ kind: 'form' });
          setErrors(mapped);
          if (mapped.reference) setReferenceOpen(true);
        } else if (cause instanceof ApiError && cause.status === 0) {
          // La même clé repart au prochain toucher : réessayer est sans risque.
          setError(PAYMENT_NETWORK_MESSAGE);
        } else {
          setError(errorMessage(cause, 'Le paiement n’a pas pu être enregistré.'));
        }
      }
    } finally {
      setBusy(false);
    }
  }

  if (!modeSupported) {
    return (
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4">
        <h1 className="title m-0">Un membre a payé</h1>
        <Notice tone="due">
          L’enregistrement d’un paiement sera possible quand le mode de cotisation
          de votre association sera pris en charge.
        </Notice>
      </div>
    );
  }

  if (view.kind === 'recorded') {
    return (
      <Recorded payment={view.payment}>
        <button type="button" className={LINK_BUTTON} onClick={reset}>
          Enregistrer un autre paiement
        </button>
        <Link href="/bureau" className={`${LINK_BUTTON} text-center`}>
          Retour à l’accueil
        </Link>
      </Recorded>
    );
  }

  if (view.kind === 'duplicate' && member && typed !== null) {
    return (
      <DuplicateQuestion
        existing={view.existing}
        typedAmount={formatTypedAmount(typed)}
        typedMethod={methodLabel(method)}
        memberName={member.name}
        firstName={firstName(member)}
        busy={busy}
        error={error}
        onSame={() => {
          // Rien n'est envoyé : retour à la fiche.
          setFlash('Rien n’a été enregistré.');
          router.push(`/bureau/membres/${encodeURIComponent(member.id)}`);
        }}
        onTwice={() => void save(true)}
      />
    );
  }

  const r = member ? recap({ member, amount: typed, method, date: paidOn, today }) : null;

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4">
      <h1 className="title m-0">Un membre a payé</h1>

      {picked.kind === 'ready' ? (
        <div className="flex flex-col gap-[6px]">
          <span className="font-semibold">1. Qui a payé ?</span>
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border-2 border-indigo bg-surface-raised px-[14px] py-[10px]">
            <div className="min-w-0">
              <div className="text-[17px] font-semibold break-words">{picked.member.name}</div>
              <WhoStanding member={picked.member} />
            </div>
            <button
              type="button"
              className={LINK_BUTTON}
              onClick={() => {
                setPicked({ kind: 'none' });
                setFromFiche(null);
                setAmount('');
              }}
            >
              Autre membre
            </button>
          </div>
        </div>
      ) : picked.kind === 'loading' ? (
        <Skeleton label="Chargement de la fiche…" />
      ) : (
        <>
          {picked.kind === 'error' ? <Notice tone="late">{picked.message}</Notice> : null}
          <WhoPicker onPick={(id) => void choose(id)} />
        </>
      )}

      {member && r ? (
        <form
          className="m-0 flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <div className="flex flex-col gap-[6px]">
            <label htmlFor={`${ids}-amount`} className="font-semibold">
              2. Combien ?
            </label>
            <div className="flex items-center gap-[10px]">
              <input
                id={`${ids}-amount`}
                name="amount"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={typed !== null && typed > 0 ? formatTypedAmount(typed).replace(' FCFA', '') : amount}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  setAmount(e.target.value.replace(/[^\d]/g, ''));
                  setErrors((prev) => ({ ...prev, amount: undefined }));
                }}
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={errors.amount ? `${ids}-amount-error` : undefined}
                className={inputClass(!!errors.amount, 'tnum min-h-[52px] text-[22px] font-semibold')}
              />
              <span className="text-[17px] font-semibold">FCFA</span>
            </div>
            {errors.amount ? (
              <span id={`${ids}-amount-error`} className="small font-semibold text-late">
                {errors.amount}
              </span>
            ) : null}
          </div>

          <fieldset className="m-0 flex flex-col gap-[6px] border-0 p-0">
            <legend className="mb-[6px] p-0 font-semibold">3. Comment ?</legend>
            <div className="grid grid-cols-3 gap-2">
              {METHOD_CHOICES.map((choice) => {
                const on = choice.value === method;
                return (
                  <label
                    key={choice.value}
                    className={`flex min-h-12 cursor-pointer items-center gap-[10px] rounded-[var(--radius-md)] bg-surface-raised px-3 py-[6px] text-[15px] leading-5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${
                      on ? 'border-2 border-indigo bg-indigo-soft font-semibold' : 'border border-line-strong'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${ids}-method`}
                      value={choice.value}
                      checked={on}
                      onChange={() => setMethod(choice.value)}
                      className="size-5 shrink-0 accent-[var(--indigo)]"
                    />
                    <span className="min-w-0 break-words">{choice.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-col gap-[6px]">
            <span className="font-semibold" id={`${ids}-when`}>
              4. Quand ?
            </span>
            {otherDay ? (
              <>
                <label htmlFor={`${ids}-date`} className="sr-only">
                  Date du paiement
                </label>
                <input
                  id={`${ids}-date`}
                  type="date"
                  max={today}
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                  aria-invalid={errors.paid_on ? true : undefined}
                  className={inputClass(!!errors.paid_on, 'min-h-[52px] text-[18px]')}
                />
                {/* P7 : la date choisie, toujours en toutes lettres. */}
                <span className="small text-ink-muted" data-testid="date-words">
                  {formatDate(paidOn) ? `Le ${formatDate(paidOn)}` : ''}
                </span>
                {errors.paid_on ? (
                  <span className="small font-semibold text-late">{errors.paid_on}</span>
                ) : null}
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span data-testid="date-words">Aujourd’hui, {formatDate(today)}</span>
                <button type="button" className={LINK_BUTTON} onClick={() => setOtherDay(true)}>
                  Un autre jour
                </button>
              </div>
            )}
          </div>

          {referenceOpen ? (
            <div className="flex flex-col gap-[6px]">
              <label htmlFor={`${ids}-ref`} className="font-semibold">
                N° de transaction <span className="font-normal text-ink-muted">(facultatif)</span>
              </label>
              <input
                id={`${ids}-ref`}
                maxLength={255}
                autoComplete="off"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className={inputClass(!!errors.reference)}
              />
              {errors.reference ? (
                <span className="small font-semibold text-late">{errors.reference}</span>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              className={`${LINK_BUTTON} self-start px-0`}
              onClick={() => setReferenceOpen(true)}
            >
              Ajouter un n° de transaction (facultatif)
            </button>
          )}

          <section className="flex flex-col gap-[2px] rounded-[var(--radius-md)] border border-line bg-surface-raised px-[14px] py-3" data-testid="recap">
            <Label>Vous allez enregistrer</Label>
            <span>
              {r.who} a payé <strong className="money">{r.amount}</strong> {r.how}
              {r.when ? ` ${r.when}` : ''}.{r.after ? ` ${r.after}` : ''}
            </span>
          </section>

          {error ? (
            <div role="alert" className="flex flex-col gap-2 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late">
              <span>{error}</span>
              {duplicateLink ? (
                <Link href={duplicateLink} className="font-semibold">
                  Voir ses paiements sur sa fiche
                </Link>
              ) : null}
            </div>
          ) : null}

          <button type="submit" disabled={busy} className={bigButtonClass('primary')}>
            {busy ? 'Enregistrement…' : 'Enregistrer ce paiement'}
          </button>
        </form>
      ) : null}
    </div>
  );
}

/** « Cheikh doit encore 25 000 FCFA », ou « À jour jusqu'au … ». */
function WhoStanding({ member }: { member: MemberListItem }) {
  if (member.is_up_to_date) {
    const until = formatDate(member.covered_until);
    return (
      <div className="small text-paid">{until ? `À jour jusqu’au ${until}` : 'À jour'}</div>
    );
  }
  return (
    <div className="small text-due">
      {firstName(member)} doit encore{' '}
      <span className="money">{member.balance_due_formatted ?? '—'}</span>
    </div>
  );
}

type Results =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; members: MemberListItem[] };

/**
 * « 1. Qui a payé ? » — la liste des membres, puis la recherche (nom ou
 * téléphone) envoyée au serveur. Les demandes d'adhésion suivent : c'est le
 * premier paiement qui fait le membre. L'ordre est celui du serveur.
 */
function WhoPicker({ onPick }: { onPick: (id: string) => void }) {
  const ids = useId();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Results>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setResults({ kind: 'loading' });
    void (async () => {
      try {
        const [active, pending] = await Promise.all([
          listMembers({ status: 'active', search }, controller.signal),
          listMembers({ status: 'pending', search }, controller.signal),
        ]);
        setResults({ kind: 'ready', members: [...active, ...pending] });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (isSessionError(cause)) return;
        setResults({ kind: 'error', message: errorMessage(cause, 'La recherche n’a pas abouti.') });
      }
    })();
    return () => controller.abort();
  }, [search, attempt]);

  return (
    <>
      <div className="flex flex-col gap-[6px]">
        <label htmlFor={`${ids}-who`} className="font-semibold">
          1. Qui a payé ?
        </label>
        <span className="relative flex items-center">
          <SearchIcon className="pointer-events-none absolute left-3 text-ink-muted" />
          <input
            id={`${ids}-who`}
            type="search"
            autoComplete="off"
            placeholder="Nom ou téléphone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={inputClass(false, 'min-h-[52px] pl-9 text-[18px]')}
          />
        </span>
      </div>

      {results.kind === 'loading' ? <Skeleton label="Recherche…" /> : null}
      {results.kind === 'error' ? (
        <Notice tone="late">
          <span>{results.message}</span>
          <span>
            <Button onClick={() => setAttempt((n) => n + 1)}>Réessayer</Button>
          </span>
        </Notice>
      ) : null}
      {results.kind === 'ready' ? (
        <div className="flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-raised" data-testid="pick-list">
          {results.members.length === 0 ? (
            <p className="m-0 px-4 py-3 text-ink-muted">Aucun membre ne correspond.</p>
          ) : (
            results.members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPick(m.id)}
                className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-line bg-transparent px-4 py-2 text-left text-[16px] text-ink last:border-b-0"
              >
                <span className="min-w-0">
                  <b className="break-words">{m.name}</b>
                  <br />
                  <span className="small text-ink-muted">
                    {m.status === 'pending' ? 'Demande d’adhésion' : (m.category_label ?? '')}
                  </span>
                </span>
                {m.is_up_to_date ? (
                  <Pastille tone="paid">À jour</Pastille>
                ) : (
                  <span className="small shrink-0 text-right text-due">
                    doit encore
                    <br />
                    <b className="money">{m.balance_due_formatted ?? '—'}</b>
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      ) : null}
    </>
  );
}
