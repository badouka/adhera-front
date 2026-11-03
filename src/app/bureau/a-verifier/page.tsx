'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBackBar, useBureau } from '@/components/bureau/BureauContext';
import { ProofButton } from '@/components/bureau/Documents';
import { isModeUnsupported } from '@/components/bureau/format';
import { ChatIcon } from '@/components/bureau/Icons';
import { DuplicateQuestion } from '@/components/bureau/simple/Duplicate';
import { Recorded } from '@/components/bureau/simple/Recorded';
import {
  bigButtonClass,
  Button,
  Label,
  LINK_BUTTON,
  Notice,
  Skeleton,
  Toast,
} from '@/components/bureau/ui';
import { CheckIcon } from '@/components/Icons';
import { ApiError, fieldMessages } from '@/lib/api';
import {
  getMember,
  isSessionError,
  listPayments,
  rejectPayment,
  validatePayment,
} from '@/lib/bureau/api';
import { possibleDuplicate } from '@/lib/bureau/duplicate';
import { errorMessage } from '@/lib/bureau/messages';
import { openPendingTab } from '@/lib/bureau/pendingTab';
import type {
  ExistingPayment,
  MemberDetail,
  Payment,
  PaymentWithShare,
  RejectReasonCode,
} from '@/lib/bureau/types';
import { firstName } from '@/lib/bureau/words';
import { formatDate, formatDateTime } from '@/lib/dates';

/** Le texte libre d'un refus : le membre le lira. 10 caractères au moins (§18.4). */
export const MIN_REJECTION_LENGTH = 10;

type Reason = RejectReasonCode | 'other';

/** Les trois raisons toutes prêtes, et l'autre (§18.4). */
export const REASONS: ReadonlyArray<{ value: Reason; label: string }> = [
  { value: 'not_found', label: 'Je ne trouve pas ce paiement' },
  { value: 'wrong_amount', label: 'Le montant n’est pas le bon' },
  { value: 'unreadable_proof', label: 'La preuve est illisible' },
  { value: 'other', label: 'Une autre raison (je l’écris)' },
];

/**
 * L'APERÇU de la phrase que le membre lira. ⚠️ Composé ici pour l'aperçu
 * seulement : ce qui part est la phrase que le SERVEUR compose et stocke
 * (§18.4), et le message WhatsApp est celui de `share`. Le moyen et le
 * montant sont les libellés servis, jamais reformatés (R1).
 */
export function reasonPreview(reason: Reason, payment: Payment, text: string): string {
  const what = `${payment.method_label} de ${payment.amount_formatted}`;
  switch (reason) {
    case 'not_found':
      return `Le trésorier ne trouve pas votre paiement ${what}. Vérifiez le numéro auquel vous avez envoyé l’argent, puis signalez-le à nouveau sur votre page.`;
    case 'wrong_amount':
      return `Le montant reçu ne correspond pas à votre paiement ${what}. Vérifiez la somme envoyée, puis signalez-le à nouveau sur votre page.`;
    case 'unreadable_proof':
      return `La preuve de votre paiement ${what} est illisible. Envoyez une capture plus nette depuis votre page.`;
    default:
      return text.trim() || '…';
  }
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; payments: Payment[] };

type View =
  | { kind: 'card' }
  | { kind: 'refuse' }
  | { kind: 'duplicate'; existing: ExistingPayment }
  | { kind: 'recorded'; payment: PaymentWithShare };

/**
 * Écrans 2 et 3 — « Paiements à vérifier », UN À LA FOIS (maquette).
 *
 * La carte : qui, combien, par quel moyen, quand ; puis « Voir la preuve
 * envoyée » AVANT les deux décisions, de même largeur. « J'ai bien reçu cet
 * argent » accepte (`validate`) ; « Je n'ai pas reçu cet argent » ouvre le
 * refus, avec une raison toute prête et le message WhatsApp du serveur.
 */
export default function VerifierPage() {
  const { modeSupported, markModeUnsupported, refreshToVerify } = useBureau();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(0);
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [view, setView] = useState<View>({ kind: 'card' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [waFallback, setWaFallback] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const payments = await listPayments({ status: 'declared' }, controller.signal);
        setLoad({ kind: 'ready', payments });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (isSessionError(cause)) return;
        setLoad({
          kind: 'error',
          message: errorMessage(cause, 'Les paiements à vérifier n’ont pas pu être chargés.'),
        });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const queue = useMemo(() => (load.kind === 'ready' ? load.payments : []), [load]);
  const position = queue.length === 0 ? 0 : Math.min(index, queue.length - 1);
  const current = queue[position] ?? null;

  // Le prénom et le téléphone du membre : la fiche, lue pour la carte affichée.
  const memberId = current?.member_id ?? null;
  useEffect(() => {
    setMember(null);
    if (!memberId) return;
    const controller = new AbortController();
    getMember(memberId, controller.signal)
      .then(setMember)
      .catch(() => {
        // Sans fiche, on écrit le nom entier : rien ne bloque la décision.
      });
    return () => controller.abort();
  }, [memberId]);

  const backToCard = useCallback(() => {
    setError(null);
    setView({ kind: 'card' });
  }, []);

  // Le refus et la question du doublon sont des écrans d'un geste : « Retour ».
  useBackBar(
    view.kind === 'refuse' || view.kind === 'duplicate'
      ? { href: '/bureau/a-verifier', label: 'Retour', onClick: backToCard }
      : null,
  );

  const clearToast = useCallback(() => setToast(null), []);

  function done(id: string) {
    setLoad((prev) =>
      prev.kind === 'ready'
        ? { ...prev, payments: prev.payments.filter((p) => p.id !== id) }
        : prev,
    );
    refreshToVerify();
  }

  async function accept(confirmDuplicate = false) {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const accepted = await validatePayment(current.id, { confirmDuplicate });
      done(current.id);
      setView({ kind: 'recorded', payment: accepted });
    } catch (cause) {
      if (isSessionError(cause)) return;
      if (isModeUnsupported(cause)) markModeUnsupported();
      const existing = possibleDuplicate(cause);
      if (existing && !confirmDuplicate) {
        setView({ kind: 'duplicate', existing });
      } else {
        setError(errorMessage(cause, 'Le paiement n’a pas pu être accepté.'));
      }
    } finally {
      setBusy(false);
    }
  }

  const who = current ? (member ? firstName(member) : current.member_name) : '';

  if (load.kind === 'loading') return <Skeleton label="Chargement des paiements à vérifier…" />;

  if (load.kind === 'error') {
    return (
      <Notice tone="late">
        <span>{load.message}</span>
        <span>
          <Button onClick={() => setAttempt((n) => n + 1)}>Réessayer</Button>
        </span>
      </Notice>
    );
  }

  if (view.kind === 'recorded') {
    return (
      <Recorded payment={view.payment}>
        {queue.length > 0 ? (
          <button
            type="button"
            className={LINK_BUTTON}
            onClick={() => {
              setIndex(0);
              setView({ kind: 'card' });
            }}
          >
            {queue.length > 1
              ? `Vérifier les ${queue.length} paiements suivants`
              : 'Vérifier le paiement suivant'}
          </button>
        ) : null}
        <Link href="/bureau" className={`${LINK_BUTTON} text-center`}>
          Retour à l’accueil
        </Link>
      </Recorded>
    );
  }

  if (view.kind === 'duplicate' && current) {
    return (
      <DuplicateQuestion
        existing={view.existing}
        typedAmount={current.amount_formatted}
        typedMethod={current.method_label}
        nowLabel={`${who} signale`}
        nowWhen="à vérifier"
        memberName={current.member_name}
        firstName={who}
        busy={busy}
        error={error}
        onSame={() => {
          backToCard();
          setToast('Rien n’a été enregistré. Ce paiement reste à vérifier.');
        }}
        onTwice={() => void accept(true)}
      />
    );
  }

  if (view.kind === 'refuse' && current) {
    return (
      <RefuseScreen
        payment={current}
        member={member}
        onDone={(message, fallback) => {
          done(current.id);
          setView({ kind: 'card' });
          setToast(message);
          setWaFallback(fallback);
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4">
      <div>
        <h1 className="title m-0">Paiements à vérifier</h1>
        <p className="m-0 text-ink-muted">
          Regardez sur votre téléphone (Wave, Orange Money) ou sur votre relevé si
          l’argent est bien arrivé.
        </p>
      </div>

      {waFallback ? (
        <Notice tone="info">
          <span>WhatsApp ne s’est pas ouvert tout seul.</span>
          <a href={waFallback} target="_blank" rel="noopener noreferrer" className="font-semibold">
            Ouvrir WhatsApp avec le message
          </a>
        </Notice>
      ) : null}

      {current ? (
        <PaymentToVerify
          payment={current}
          position={position + 1}
          total={queue.length}
          canAccept={modeSupported}
          busy={busy}
          error={error}
          onAccept={() => {
            setWaFallback(null);
            void accept(false);
          }}
          onRefuse={() => {
            setWaFallback(null);
            setError(null);
            setView({ kind: 'refuse' });
          }}
          onNext={
            queue.length > 1
              ? () => {
                  setError(null);
                  setIndex((position + 1) % queue.length);
                }
              : undefined
          }
        />
      ) : (
        <>
          <section className="flex flex-col items-center gap-[10px] rounded-[var(--radius-md)] bg-paid-soft px-4 py-5 text-center" data-testid="queue-empty">
            <span className="flex size-14 items-center justify-center rounded-full bg-paid text-on-indigo">
              <CheckIcon size={30} />
            </span>
            <h2 className="heading m-0 text-paid">Rien à vérifier</h2>
            <p className="m-0">Tous les paiements annoncés ont été traités.</p>
          </section>
          <Link href="/bureau" className={bigButtonClass('outline')}>
            Retour à l’accueil
          </Link>
        </>
      )}

      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}

function PaymentToVerify({
  payment,
  position,
  total,
  canAccept,
  busy,
  error,
  onAccept,
  onRefuse,
  onNext,
}: {
  payment: Payment;
  position: number;
  total: number;
  canAccept: boolean;
  busy: boolean;
  error: string | null;
  onAccept: () => void;
  onRefuse: () => void;
  onNext?: () => void;
}) {
  const paidOn = formatDate(payment.paid_on) || formatDateTime(payment.declared_at);
  const reference = payment.reference?.trim();

  return (
    <>
      <div className="small font-semibold text-ink-muted" data-testid="position">
        Paiement {position} sur {total}
      </div>

      <section
        className="flex flex-col gap-[14px] rounded-[var(--radius-md)] border border-line bg-surface-raised p-4"
        data-testid="payment-card"
      >
        <div>
          <h2 className="heading m-0 break-words">{payment.member_name}</h2>
          <p className="m-0">dit avoir payé</p>
          <div className="amount">{payment.amount_formatted}</div>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-[10px]">
          <div>
            <dt><Label>Par</Label></dt>
            <dd className="m-0">{payment.method_label}</dd>
          </div>
          <div>
            <dt><Label>Le</Label></dt>
            <dd className="m-0">{paidOn || '—'}</dd>
          </div>
          {reference ? (
            <div className="col-span-2">
              <dt><Label>N° de transaction</Label></dt>
              <dd className="tnum m-0 break-all">{reference}</dd>
            </div>
          ) : null}
        </dl>
        {/* La preuve AVANT la décision. */}
        {payment.has_proof ? (
          <ProofButton
            paymentId={payment.id}
            label="Voir la preuve envoyée"
            className={bigButtonClass('outline', 'min-h-12')}
          />
        ) : (
          <p className="small m-0 text-ink-muted" data-testid="no-proof">
            Aucune preuve envoyée avec ce paiement.
          </p>
        )}
      </section>

      {error ? (
        <p role="alert" className="m-0 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late">
          {error}
        </p>
      ) : null}

      {canAccept ? null : (
        <Notice tone="due">
          Accepter un paiement sera possible quand le mode de cotisation de votre
          association sera pris en charge.
        </Notice>
      )}

      <div className="flex flex-col gap-[10px]">
        {canAccept ? (
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            className={bigButtonClass('primary')}
          >
            {busy ? 'Enregistrement…' : 'J’ai bien reçu cet argent'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRefuse}
          disabled={busy}
          className={bigButtonClass('outline-red')}
        >
          Je n’ai pas reçu cet argent
        </button>
        {onNext ? (
          <button type="button" onClick={onNext} disabled={busy} className={LINK_BUTTON}>
            Passer au paiement suivant
          </button>
        ) : null}
      </div>
    </>
  );
}

/**
 * Écran 3 — « Je n'ai pas reçu cet argent ». Trois raisons toutes prêtes en
 * gros boutons (le serveur compose la phrase, §18.4), ou un texte libre de 10
 * caractères. L'aperçu dit ce que le membre lira ; ce qui part est ce que le
 * serveur a écrit, et le message WhatsApp est `share`.
 */
function RefuseScreen({
  payment,
  member,
  onDone,
}: {
  payment: Payment;
  member: MemberDetail | null;
  /** Le message de l'écran suivant, et le lien WhatsApp si l'onglet a été bloqué. */
  onDone: (message: string, waFallback: string | null) => void;
}) {
  const [reason, setReason] = useState<Reason>('not_found');
  const [text, setText] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const who = member ? firstName(member) : payment.member_name;
  // La fiche dit s'il y a un numéro ; la réponse (`share`) le confirme.
  const noPhone = member !== null && !member.phone?.trim();
  const noPhoneLine = `${who} n’a pas de téléphone : il ou elle verra le motif sur sa page.`;

  async function refuse(viaWhatsapp: boolean) {
    if (busy) return;
    const free = text.trim();
    if (reason === 'other' && free.length < MIN_REJECTION_LENGTH) {
      setFieldError(
        `Expliquez le motif en ${MIN_REJECTION_LENGTH} caractères au moins : ${who} le lira.`,
      );
      return;
    }
    setFieldError(null);
    setError(null);
    setBusy(true);
    const tab = viaWhatsapp ? openPendingTab() : null;
    try {
      const refused = await rejectPayment(
        payment.id,
        reason === 'other' ? { reason: free } : { reason_code: reason },
      );
      const share = refused.share ?? null;
      let fallback: string | null = null;
      if (tab) {
        if (share) {
          if (!tab.go(share.whatsapp_url)) fallback = share.whatsapp_url;
        } else {
          tab.close();
        }
      }
      onDone(
        viaWhatsapp && !share ? noPhoneLine : `Paiement refusé. ${who} le verra sur sa page.`,
        fallback,
      );
    } catch (cause) {
      tab?.close();
      if (isSessionError(cause)) return;
      // Le refus du serveur, tel quel : il parle français (R4).
      const fields = fieldMessages(cause);
      const first = fields.reason ?? fields.reason_code ?? null;
      if (cause instanceof ApiError && cause.status === 0) {
        setError('Le réseau ne répond pas. Rien n’a été refusé : réessayez.');
      } else if (first && reason === 'other') {
        setFieldError(first);
      } else {
        setError(first ?? errorMessage(cause, 'Le paiement n’a pas pu être refusé.'));
      }
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4" data-testid="refuse">
      <div>
        <h1 className="title m-0">Pourquoi ce paiement n’est pas bon ?</h1>
        <p className="m-0 text-ink-muted">
          {payment.member_name} · <span className="money">{payment.amount_formatted}</span> ·{' '}
          {payment.method_label}. Choisissez une raison : {who} la recevra et pourra corriger.
        </p>
      </div>

      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">Raison</legend>
        <div className="flex flex-col gap-2">
          {REASONS.map((option) => {
            const on = option.value === reason;
            return (
              <label
                key={option.value}
                className={`flex min-h-14 cursor-pointer items-center gap-[10px] rounded-[var(--radius-md)] bg-surface-raised px-3 py-[6px] text-[16px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${
                  on ? 'border-2 border-indigo bg-indigo-soft font-semibold' : 'border border-line-strong'
                }`}
              >
                <input
                  type="radio"
                  name="reason"
                  value={option.value}
                  checked={on}
                  onChange={() => {
                    setReason(option.value);
                    setFieldError(null);
                  }}
                  className="size-5 shrink-0 accent-[var(--indigo)]"
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      {reason === 'other' ? (
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="refuse-text" className="font-semibold">
            Votre message
          </label>
          <textarea
            id="refuse-text"
            rows={3}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'refuse-text-error' : undefined}
            className={`min-w-0 rounded-[var(--radius-sm)] border bg-surface-raised px-[14px] py-3 text-[16px] ${
              fieldError ? 'border-late' : 'border-line-strong'
            }`}
          />
          {fieldError ? (
            <span id="refuse-text-error" className="small font-semibold text-late">
              {fieldError}
            </span>
          ) : null}
        </div>
      ) : null}

      <section className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4" data-testid="preview">
        <Label>Le message que {who} recevra</Label>
        <p className="m-0 whitespace-pre-line break-words">
          « Bonjour {who},{'\n'}
          {reasonPreview(reason, payment, text)}
          {'\n'}Votre page : le lien de sa page »
        </p>
      </section>

      {noPhone ? (
        <p className="m-0 font-semibold" data-testid="refuse-no-phone">
          {noPhoneLine}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-[10px]">
        {noPhone ? (
          <button
            type="button"
            onClick={() => void refuse(false)}
            disabled={busy}
            className={bigButtonClass('danger')}
          >
            {busy ? 'Envoi…' : 'Refuser ce paiement'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void refuse(true)}
              disabled={busy}
              className={bigButtonClass('danger')}
            >
              <ChatIcon size={22} />
              {busy ? 'Envoi…' : 'Refuser et prévenir par WhatsApp'}
            </button>
            <button
              type="button"
              onClick={() => void refuse(false)}
              disabled={busy}
              className={LINK_BUTTON}
            >
              Refuser sans envoyer de message
            </button>
          </>
        )}
      </div>
    </div>
  );
}
