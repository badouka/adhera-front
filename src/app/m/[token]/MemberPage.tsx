'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  InvalidLink,
  Loading,
  TechnicalError,
  Unavailable,
} from '@/components/Fallbacks';
import { AttestationAction } from '@/components/card/AttestationAction';
import { MemberCardView } from '@/components/card/MemberCardView';
import { SaveCard } from '@/components/card/SaveCard';
import { CheckIcon, ClockIcon } from '@/components/Icons';

/** « ‹ » du retour, comme la barre de la maquette. */
function ChevronLeft() {
  return (
    <svg aria-hidden="true" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
import { Pastille } from '@/components/Pastille';
import { PaymentHowTo } from '@/components/PaymentHowTo';
import { PaymentSheet } from '@/components/PaymentSheet';
import { ReceiptList } from '@/components/ReceiptList';
import { Card, Shell } from '@/components/Shell';
import { API_BASE, fetchMember } from '@/lib/api';
import { formatDate, formatDateTime, formatInstant, isPast } from '@/lib/dates';
import { homeIconUrl, manifestHref } from '@/lib/manifest';
import { resolveMemberState, screenForError } from '@/lib/state';
import { resolveTenant } from '@/lib/tenant';
import type {
  Application,
  LastRejection,
  MemberCard,
  MemberPayload,
  Referral,
  ScreenState,
} from '@/lib/types';
import { whatsappLink } from '@/lib/whatsapp';

type Notice = { message: string; tone: 'paid' | 'info' };

export type MemberView = 'carte' | 'cotisation';

/**
 * La vue d'ouverture (F4 § 1.1) : « Ma carte » pour un membre à jour, « Ma
 * cotisation » sinon. `?vue=carte` force la carte — c'est l'adresse de l'icône
 * posée sur l'écran d'accueil. Sans carte, il n'y a qu'une vue.
 */
export function initialView(payload: MemberPayload, search: string): MemberView {
  if (!payload.card) return 'cotisation';
  if (new URLSearchParams(search).get('vue') === 'carte') return 'carte';
  return payload.card.is_up_to_date ? 'carte' : 'cotisation';
}

/**
 * Le service worker de la carte (`public/m/sw.js`), limité aux pages de
 * membre. La page lui remet ce qu'elle a chargé AVANT d'être contrôlée — ses
 * scripts, et la réponse qu'elle vient de lire — pour s'ouvrir hors connexion
 * dès la première visite.
 */
function registerCardWorker(memberApiUrl: string, payload: MemberPayload) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('/m/sw.js', { scope: '/m/' })
    .then(async () => {
      const ready = await navigator.serviceWorker.ready;
      const urls = [
        window.location.pathname,
        ...performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name.startsWith(`${window.location.origin}/_next/static/`)),
      ];
      ready.active?.postMessage({
        type: 'precache',
        urls,
        member: { url: memberApiUrl, body: JSON.stringify(payload) },
      });
    })
    .catch(() => {
      // Sans service worker, la carte reste affichable en ligne.
    });
}

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
  const [view, setView] = useState<MemberView | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
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
        const { payload, offlineSince: since } = await fetchMember(
          token,
          slug,
          controller.signal,
        );
        setScreen({ kind: 'ready', payload });
        setOfflineSince(since);
        // La vue se choisit au premier chargement ; un rechargement (après un
        // paiement signalé) ne la change pas.
        setView((current) => current ?? initialView(payload, window.location.search));
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

  const hasCard = screen.kind === 'ready' && !!screen.payload.card;
  useEffect(() => {
    if (!hasCard || screen.kind !== 'ready' || offlineSince !== null) return;
    registerCardWorker(`${API_BASE}/m/${encodeURIComponent(token)}`, screen.payload);
    // Une fois par chargement réussi, en ligne.
  }, [hasCard, screen, offlineSince, token]);

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
  const application = payload.application ?? null;

  // §17.5 — une demande à l'examen, ou refusée : la page du candidat, et rien
  // d'autre. `application.status` décide, jamais `due === null` (piège 1).
  if (application && application.status !== 'awaiting_first_payment') {
    return (
      <Shell organisationName={payload.organisation.name} logoUrl={payload.organisation.logo_url}>
        <ApplicationPage
          application={application}
          name={payload.member.first_name?.trim() || payload.member.name}
        />
      </Shell>
    );
  }

  /** Sous « premier paiement » : un candidat qui paie sa PREMIÈRE cotisation. */
  const firstPayment = application?.status === 'awaiting_first_payment';
  const state = resolveMemberState(payload);
  const referral = payload.referral ?? null;
  const due = payload.due;
  const card = payload.card ?? null;
  const current: MemberView = card ? (view ?? 'cotisation') : 'cotisation';

  const offlineBanner =
    offlineSince !== null ? (
      <p
        role="status"
        className="m-0 rounded-[var(--radius-md)] bg-due-soft p-3 font-semibold text-due"
        data-testid="offline-banner"
      >
        Hors connexion — informations du{' '}
        {formatInstant(offlineSince, { timeZone: 'Africa/Dakar' }) || 'dernier chargement'}
      </p>
    ) : null;

  const installLinks = card ? (
    <CardHeadLinks token={token} card={card} iconUrl={payload.organisation.icon_url} />
  ) : null;

  if (card && current === 'carte') {
    return (
      <Shell header={false} footer={null}>
        {installLinks}
        <button
          type="button"
          onClick={() => setView('cotisation')}
          className="-mx-4 -mt-4 flex h-14 items-center gap-[6px] border-b border-line bg-surface-raised px-4 text-left font-semibold text-indigo"
        >
          <ChevronLeft />
          Ma cotisation
        </button>
        {offlineBanner}
        <MemberCardView card={card} />
        {/* F5 : l'image dans les photos, à la place de l'installation. */}
        <SaveCard card={card} />
        {card.is_up_to_date ? null : (
          <button
            type="button"
            onClick={() => setView('cotisation')}
            className="mx-auto min-h-11 bg-transparent px-2 text-[17px] font-bold text-link underline"
          >
            Payer ma cotisation
          </button>
        )}
        <AttestationAction
          token={token}
          tenant={tenant}
          available={payload.attestation_available === true}
          upToDate={card.is_up_to_date}
        />
        {referral ? <ReferralBlock referral={referral} /> : null}
      </Shell>
    );
  }

  return (
    <Shell
      organisationName={payload.organisation.name}
      logoUrl={payload.organisation.logo_url}
    >
      {installLinks}
      {offlineBanner}
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

      <Greeting
        state={state}
        memberName={payload.member.first_name?.trim() || payload.member.name}
        // « Votre acompte a bien été reçu » contredirait l'encart de refus.
        quiet={!!payload.last_rejection}
      />

      {state === 'E2' ? <UpToDate payload={payload} /> : null}
      {state === 'E4' ? (
        <PendingBlock payload={payload} focusOnMount={justSent} firstPayment={firstPayment} />
      ) : null}
      {state === 'E5' ? <AmountUnknown /> : null}
      {state === 'E6' ? <NothingDue /> : null}

      {(state === 'E3' || state === 'E3b') && due ? (
        <>
          {payload.last_rejection ? (
            <RejectionNotice rejection={payload.last_rejection} />
          ) : null}
          <DueBlock payload={payload} partial={state === 'E3b'} firstPayment={firstPayment} />
          <PaymentHowTo organisation={payload.organisation} />
        </>
      ) : null}

      {card ? (
        <button
          type="button"
          onClick={() => setView('carte')}
          className="flex min-h-14 w-full items-center justify-center rounded-[var(--radius-md)] border border-line-strong bg-surface-raised px-4 text-[16px] font-semibold text-ink"
        >
          Ma carte de membre
        </button>
      ) : null}

      <ReceiptList receipts={payload.receipts} token={token} tenant={tenant} />

      {referral ? <ReferralBlock referral={referral} /> : null}

      <p className="small m-0 text-center text-ink-muted">
        Gardez le message qui contient ce lien : c’est votre accès personnel.
      </p>

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
            J’ai payé : le signaler
          </button>
        </div>
      ) : null}

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

/**
 * Le manifeste de la carte, et l'icône que Safari pose sur l'écran d'accueil.
 * React 19 les remonte dans `<head>`.
 *
 * L'image est `organisation.icon_url`, l'icône carrée du serveur ; à défaut,
 * le logo de la carte. Toutes deux passent telles que l'API les sert.
 */
function CardHeadLinks({
  token,
  card,
  iconUrl,
}: {
  token: string;
  card: MemberCard;
  iconUrl: string | null | undefined;
}) {
  const icon = homeIconUrl(iconUrl, card.logo_url);
  return (
    <>
      <link rel="manifest" href={manifestHref(token, card.organisation_name, icon)} />
      <link rel="apple-touch-icon" href={icon ?? '/carte/icone-180.png'} />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Ma carte" />
    </>
  );
}

function Greeting({
  state,
  memberName,
  quiet = false,
}: {
  state: ReturnType<typeof resolveMemberState>;
  memberName: string;
  /** Sans sous-titre : un autre message parle juste en dessous. */
  quiet?: boolean;
}) {
  const name = memberName.trim();

  const subtitles: Record<typeof state, string | null> = {
    E2: 'Merci pour votre cotisation.',
    E3: null,
    E3b: 'Votre acompte a bien été reçu.',
    E4: null,
    E5: 'Votre cotisation est en préparation.',
    E6: 'Rien à payer pour l’instant.',
  };
  const subtitle = quiet ? null : subtitles[state];

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
          ? `Votre cotisation est payée jusqu’au ${until}.`
          : 'Votre cotisation est à jour.'}
      </p>
    </section>
  );
}

/** E4 — paiement signalé, en attente du bureau. Pas de bouton. */
function PendingBlock({
  payload,
  focusOnMount,
  firstPayment = false,
}: {
  payload: MemberPayload;
  /** Vrai juste après l'envoi : le focus suit l'information. */
  focusOnMount: boolean;
  /** Un candidat (§17.5) : ce paiement accepté fera de lui un membre. */
  firstPayment?: boolean;
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
        {firstPayment
          ? 'Merci. L’association vérifiera votre paiement : vous serez membre dès qu’il sera accepté.'
          : 'Merci. L’association vérifiera votre paiement, et vous recevrez votre reçu ici.'}
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
        Le montant de votre cotisation n’est pas encore fixé. Contactez votre
        association.
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

/** E3 / E3b — « Votre cotisation à payer » : le montant, en très gros, et ce qu'il couvre. */
function DueBlock({
  payload,
  partial,
  firstPayment = false,
}: {
  payload: MemberPayload;
  partial: boolean;
  /**
   * §17.5 — un candidat sous « premier paiement » n'est pas encore membre : la
   * page le DIT, au lieu de « Votre cotisation à payer » comme à un membre.
   */
  firstPayment?: boolean;
}) {
  const due = payload.due;
  if (!due) return null;

  const late = isPast(due.period_end);
  const periodStart = formatDate(due.period_start);
  const periodEnd = formatDate(due.period_end);
  // Le libellé du serveur d'abord ; les dates relues en UTC à défaut.
  const period =
    due.period_label?.trim() ||
    (periodStart && periodEnd ? `du ${periodStart} au ${periodEnd}` : '');

  return (
    <section
      className="flex flex-col gap-1 rounded-[var(--radius-md)] bg-due-soft p-4"
      data-testid="due-block"
      data-late={late ? 'true' : undefined}
    >
      <span>
        {firstPayment
          ? 'Votre première cotisation'
          : partial
            ? 'Il vous reste à payer'
            : 'Votre cotisation à payer'}
      </span>

      {/* R1 : jamais de montant recalculé, seulement le champ *_formatted. */}
      <div className="amount text-[clamp(28px,10vw,40px)] leading-[1.15] text-due">{due.balance_formatted}</div>

      <div className="flex flex-col text-ink-muted">
        {firstPayment ? (
          <span className="font-semibold text-ink" data-testid="first-payment">
            Vous serez membre dès qu’elle sera reçue.
          </span>
        ) : null}
        {period ? <span>pour l’année {period}</span> : null}
        {due.category_label?.trim() ? <span className="small">{due.category_label}</span> : null}
        {partial ? (
          <span className="small">
            Déjà payé : <span className="money">{due.amount_paid_formatted}</span>
            {due.amount_due_formatted ? (
              <>
                {' '}
                sur <span className="money">{due.amount_due_formatted}</span>
              </>
            ) : null}
          </span>
        ) : null}
        {late && periodStart ? <span className="small">Attendue depuis le {periodStart}.</span> : null}
      </div>
    </section>
  );
}

/**
 * §17.5 — la page d'une personne qui a demandé à adhérer : sa demande est à
 * l'examen (rien à payer, aucun bouton de paiement), ou elle a été refusée.
 * Le motif est celui que l'association a écrit POUR elle : tel quel, en texte.
 */
function ApplicationPage({
  application,
  name,
}: {
  application: Application;
  name: string;
}) {
  const greeting = name.trim() ? `Bonjour ${name.trim()}` : 'Bonjour';

  if (application.status === 'rejected') {
    const reason = application.rejection_reason?.trim();
    return (
      <>
        <h1 className="heading m-0">{greeting}</h1>
        <section className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4" data-testid="application-rejected">
          <p className="m-0 text-[18px] font-bold">Votre demande n’a pas été acceptée.</p>
          {reason ? (
            <>
              <span className="label text-ink-muted">LE MESSAGE DE L’ASSOCIATION</span>
              <p className="m-0 whitespace-pre-line break-words">{reason}</p>
            </>
          ) : null}
          <p className="small m-0 text-ink-muted">Pour en parler, contactez l’association.</p>
        </section>
      </>
    );
  }

  const submitted = formatDateTime(application.submitted_at);
  return (
    <>
      <h1 className="heading m-0">{greeting}</h1>
      <section className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-indigo-soft p-4" data-testid="application-review">
        <p className="m-0 text-[18px] font-bold">Votre demande est en cours d’examen.</p>
        {submitted ? <p className="m-0">Vous avez demandé à adhérer le {submitted}.</p> : null}
        <p className="m-0">
          Vous n’avez rien à payer pour l’instant : l’association vous répondra sur WhatsApp.
        </p>
      </section>
      <p className="small m-0 text-center text-ink-muted">
        Gardez le message qui contient ce lien : c’est votre accès personnel.
      </p>
    </>
  );
}

/** « 3 personnes sont venues grâce à vous », « et 1 demande en cours d'examen ». */
export function referralCount(referral: Referral): string | null {
  const joined = referral.joined_count;
  const pending = referral.pending_count;
  const pendingText = pending > 1 ? `${pending} demandes en cours d’examen` : '1 demande en cours d’examen';
  if (joined > 0) {
    const head = joined > 1 ? `${joined} personnes sont venues grâce à vous` : '1 personne est venue grâce à vous';
    return pending > 0 ? `${head}, et ${pendingText}.` : `${head}. Merci !`;
  }
  return pending > 0 ? `${pendingText[0]?.toUpperCase()}${pendingText.slice(1)}, grâce à vous.` : null;
}

/**
 * §17.8 — « Faites venir quelqu'un ». Le message est `share_text`, TEL QU'IL
 * EST SERVI (tutoyé, à la première personne : un membre écrit à quelqu'un qu'il
 * connaît). Le compteur compte des personnes — jamais « vos filleuls », jamais
 * un montant.
 */
function ReferralBlock({ referral }: { referral: Referral }) {
  const count = referralCount(referral);
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4" data-testid="referral">
      <h2 className="heading m-0">Faites venir quelqu’un</h2>
      <p className="m-0">
        Envoyez votre lien d’invitation à une personne qui voudrait adhérer : elle remplira sa
        demande en deux minutes.
      </p>
      {count ? (
        <p className="m-0 font-semibold text-paid" data-testid="referral-count">
          {count}
        </p>
      ) : null}
      <a
        href={whatsappLink(referral.share_text)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-14 w-full items-center justify-center rounded-[var(--radius-md)] border border-line-strong bg-surface-raised px-4 text-center text-[16px] font-semibold text-ink! no-underline"
      >
        Inviter par WhatsApp
      </a>
    </section>
  );
}
