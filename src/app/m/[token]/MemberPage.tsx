'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  InvalidLink,
  Loading,
  TechnicalError,
  Unavailable,
} from '@/components/Fallbacks';
import { CheckIcon, ClockIcon } from '@/components/Icons';
import { Pastille } from '@/components/Pastille';
import { PaymentHowTo } from '@/components/PaymentHowTo';
import { PaymentSheet } from '@/components/PaymentSheet';
import { ReceiptList } from '@/components/ReceiptList';
import { Card, Shell } from '@/components/Shell';
import { fetchMember } from '@/lib/api';
import { formatDate, isPast } from '@/lib/dates';
import { resolveMemberState, screenForError } from '@/lib/state';
import { resolveTenant } from '@/lib/tenant';
import type { LastRejection, MemberPayload, ScreenState } from '@/lib/types';

type Notice = { message: string; tone: 'paid' | 'info' };

/**
 * L'écran du membre, de bout en bout : résolution du tenant, chargement,
 * et rendu des états E1 à E9.
 *
 * Étape 1 : un seul geste. Le membre voit ce qu'il doit, copie un numéro,
 * paie dans Wave ou Orange Money, revient et touche « J'ai payé », puis
 * « Confirmer ». Rien d'autre n'est exigé de lui.
 *
 * R2 : tout se passe dans le navigateur. R5 : aucun cache, chaque visite
 * interroge l'API.
 */
export function MemberPage({ token }: { token: string }) {
  const [screen, setScreen] = useState<ScreenState>({ kind: 'loading' });
  const [tenant, setTenant] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [justSent, setJustSent] = useState(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    const slug = resolveTenant(window.location);
    setTenant(slug);

    // Un hôte hors `{slug}.adhera.africa` ne désigne aucune association.
    if (!slug) {
      setScreen({ kind: 'E1' });
      return () => controller.abort();
    }

    void (async () => {
      try {
        const payload = await fetchMember(token, slug, controller.signal);
        setScreen({ kind: 'ready', payload });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setScreen(screenForError(error));
      }
    })();

    return () => controller.abort();
  }, [token, attempt]);

  // Le focus suit l'information : message du serveur.
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    setScreen({ kind: 'loading' });
    reload();
  }, [reload]);

  // 201 : l'écran E4 dit lui-même « Merci » ; aucun message en plus.
  const onDeclared = useCallback(() => {
    setSheetOpen(false);
    setNotice(null);
    setJustSent(true);
    reload();
  }, [reload]);

  const onNeedsReload = useCallback(
    (message: string) => {
      setSheetOpen(false);
      setNotice({ message, tone: 'info' });
      reload();
    },
    [reload],
  );

  if (screen.kind === 'loading') {
    return (
      <Shell>
        <Loading />
      </Shell>
    );
  }

  if (screen.kind === 'E1') {
    return (
      <Shell>
        <InvalidLink />
      </Shell>
    );
  }

  if (screen.kind === 'E8') {
    return (
      <Shell>
        <Unavailable />
      </Shell>
    );
  }

  if (screen.kind === 'E9') {
    return (
      <Shell>
        <TechnicalError rateLimited={screen.rateLimited} onRetry={retry} />
      </Shell>
    );
  }

  // Le tenant est forcément résolu ici : sans lui, on n'aurait pas appelé l'API.
  if (!tenant) {
    return (
      <Shell>
        <InvalidLink />
      </Shell>
    );
  }

  const { payload } = screen;
  const state = resolveMemberState(payload);
  const due = payload.due;

  return (
    <Shell
      organisationName={payload.organisation.name}
      logoUrl={payload.organisation.logo_url}
    >
      {notice ? (
        <p
          ref={noticeRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className={`m-0 rounded-[var(--radius-md)] p-4 font-semibold ${
            notice.tone === 'paid'
              ? 'bg-paid-soft text-paid'
              : 'bg-due-soft text-due'
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      <Greeting state={state} memberName={payload.member.name} />

      {state === 'E2' ? <UpToDate payload={payload} /> : null}
      {state === 'E4' ? (
        <PendingBlock payload={payload} focusOnMount={justSent} />
      ) : null}
      {state === 'E5' ? <AmountUnknown /> : null}
      {state === 'E6' ? <NothingDue /> : null}

      {(state === 'E3' || state === 'E3b') && due ? (
        <>
          {payload.last_rejection ? (
            <RejectionNotice rejection={payload.last_rejection} />
          ) : null}
          <DueBlock payload={payload} partial={state === 'E3b'} />
          <PaymentHowTo organisation={payload.organisation} />
        </>
      ) : null}

      <ReceiptList receipts={payload.receipts} token={token} tenant={tenant} />

      <div className="grow" />

      {state === 'E3' || state === 'E3b' ? (
        // Le seul bouton principal, collé au bas de l'écran : visible sans
        // défiler sur un téléphone de 360 px, quelle que soit la hauteur de
        // ce qui précède.
        <div className="sticky bottom-0 -mx-4 border-t border-line bg-surface px-4 pt-3 pb-3">
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setSheetOpen(true);
            }}
            className="flex h-14 w-full items-center justify-center rounded-[var(--radius-md)] bg-indigo text-[18px] font-bold text-on-indigo"
          >
            J’ai payé
          </button>
        </div>
      ) : (
        <p className="small m-0 text-center text-ink-muted">
          Gardez ce lien : il vous servira pour vos prochaines cotisations.
        </p>
      )}

      {sheetOpen && due && (state === 'E3' || state === 'E3b') ? (
        <PaymentSheet
          token={token}
          tenant={tenant}
          organisation={payload.organisation}
          balance={due.balance ?? 0}
          balanceFormatted={due.balance_formatted}
          onDeclared={onDeclared}
          onNeedsReload={onNeedsReload}
          onCancel={() => setSheetOpen(false)}
        />
      ) : null}
    </Shell>
  );
}

function Greeting({
  state,
  memberName,
}: {
  state: ReturnType<typeof resolveMemberState>;
  memberName: string;
}) {
  const name = memberName.trim();

  const subtitles: Record<typeof state, string | null> = {
    E2: 'Merci pour votre cotisation.',
    E3: null,
    E3b: 'Votre acompte a bien été reçu.',
    E4: null,
    E5: 'Votre cotisation est en préparation.',
    E6: 'Rien à régler pour l’instant.',
  };
  const subtitle = subtitles[state];

  return (
    <div className="flex flex-col gap-1">
      <h1 className="heading m-0">{name ? `Bonjour ${name}` : 'Bonjour'}</h1>
      {subtitle ? <p className="m-0 text-ink-muted">{subtitle}</p> : null}
    </div>
  );
}

/** E2 — à jour. */
function UpToDate({ payload }: { payload: MemberPayload }) {
  const until = formatDate(payload.standing.covered_until);

  return (
    <section className="flex flex-col items-start gap-[10px] rounded-[var(--radius-md)] bg-paid-soft px-4 py-5">
      <Pastille tone="paid" icon={<CheckIcon />}>
        À jour
      </Pastille>
      <p className="m-0 text-[20px] leading-7 font-bold">
        {until
          ? `Votre cotisation est réglée jusqu’au ${until}.`
          : 'Votre cotisation est à jour.'}
      </p>
    </section>
  );
}

/** E4 — paiement signalé, en attente du bureau. Pas de bouton. */
function PendingBlock({
  payload,
  focusOnMount,
}: {
  payload: MemberPayload;
  /** Vrai juste après l'envoi : le focus suit l'information. */
  focusOnMount: boolean;
}) {
  const thanksRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focusOnMount) thanksRef.current?.focus();
  }, [focusOnMount]);

  const pending = payload.pending_declaration;
  if (!pending) return null;

  const reference = pending.reference?.trim();
  const details = [
    pending.method_label?.trim(),
    reference ? `réf. ${reference}` : null,
  ].filter(Boolean);

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label text-ink-muted">PAIEMENT SIGNALÉ</span>
          <Pastille tone="info" icon={<ClockIcon />}>
            En attente de confirmation
          </Pastille>
        </div>
        <div className="amount">{pending.amount_formatted}</div>
        {details.length > 0 ? (
          <p className="m-0 break-words text-ink-muted">{details.join(' · ')}</p>
        ) : null}
      </Card>

      <p
        ref={thanksRef}
        tabIndex={-1}
        role="status"
        className="m-0 rounded-[var(--radius-md)] bg-paid-soft p-4 font-semibold text-paid"
      >
        Merci. Le bureau confirmera votre paiement, et vous recevrez votre reçu
        ici.
      </p>
    </>
  );
}

/**
 * Le dernier paiement signalé a été refusé (v3.5.7). Le motif est écrit par le
 * bureau pour le membre : il s'affiche tel quel, en texte (R8).
 */
function RejectionNotice({ rejection }: { rejection: LastRejection }) {
  const reference = rejection.reference?.trim();
  const details = [
    rejection.method_label?.trim(),
    reference ? `réf. ${reference}` : null,
  ].filter(Boolean);
  const reason = rejection.reason.trim();
  // Un motif qui finit déjà sa phrase ne prend pas de second point.
  const stop = /[.!?…]$/.test(reason) ? '' : '.';

  return (
    <section
      aria-label="Paiement non confirmé"
      className="rounded-[var(--radius-md)] border-l-4 border-late bg-late-soft p-4"
    >
      <p className="m-0 break-words">
        Votre paiement de{' '}
        <span className="money font-semibold">{rejection.amount_formatted}</span>
        {details.length > 0 ? ` (${details.join(', ')})` : ''} n’a pas été
        confirmé : <span className="whitespace-pre-line">{reason}</span>
        {stop} Vous pouvez le signaler à nouveau.
      </p>
    </section>
  );
}

/** E5 — le montant n'est pas encore fixé : le serveur refuserait le signalement. */
function AmountUnknown() {
  return (
    <Card>
      <p className="m-0">
        Le montant de votre cotisation n’est pas encore fixé. Contactez le
        bureau de votre association.
      </p>
    </Card>
  );
}

/** E6 — ni dû, ni à jour. */
function NothingDue() {
  return (
    <Card>
      <p className="m-0">Aucune cotisation n’est réclamée pour le moment.</p>
    </Card>
  );
}

/** E3 / E3b — le montant, en très gros, et ce qu'il couvre. */
function DueBlock({
  payload,
  partial,
}: {
  payload: MemberPayload;
  partial: boolean;
}) {
  const due = payload.due;
  if (!due) return null;

  // --late est réservé à E3 quand la fin de période est passée.
  const late = isPast(due.period_end);
  const periodStart = formatDate(due.period_start);
  const periodEnd = formatDate(due.period_end);
  // Le libellé du serveur d'abord ; les dates relues en UTC à défaut.
  const period =
    due.period_label?.trim() ||
    (periodStart && periodEnd ? `du ${periodStart} au ${periodEnd}` : '');

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label text-ink-muted">
          {partial ? 'RESTE À PAYER' : 'À PAYER'}
        </span>
        <Pastille tone={late ? 'late' : 'due'}>
          {late ? 'En retard' : 'À régler'}
        </Pastille>
      </div>

      {/* R1 : jamais de montant recalculé, seulement le champ *_formatted. */}
      <div className="amount text-[clamp(28px,10vw,40px)] leading-[1.15]">{due.balance_formatted}</div>

      <div className="small flex flex-col text-ink-muted">
        {period ? <span>Cotisation {period}</span> : null}
        {due.category_label?.trim() ? <span>{due.category_label}</span> : null}
        {partial ? (
          <span>
            Déjà réglé : <span className="money">{due.amount_paid_formatted}</span>
            {due.amount_due_formatted ? (
              <>
                {' '}
                sur <span className="money">{due.amount_due_formatted}</span>
              </>
            ) : null}
          </span>
        ) : null}
        {late && periodStart ? <span>Attendue depuis le {periodStart}.</span> : null}
      </div>
    </Card>
  );
}
