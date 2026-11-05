'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RECORD_PATH, VERIFY_PATH } from '@/components/bureau/BureauFrame';
import { useBackBar, useBureau } from '@/components/bureau/BureauContext';
import { ReceiptButton } from '@/components/bureau/Documents';
import { decisionLabel, isModeUnsupported, periodLabel } from '@/components/bureau/format';
import { AnswersList } from '@/components/bureau/Answers';
import { ChatIcon } from '@/components/bureau/Icons';
import {
  bigButtonClass,
  Button,
  EmptyState,
  Label,
  LINK_BUTTON,
  Notice,
  Pill,
  Skeleton,
  Toast,
} from '@/components/bureau/ui';
import { Pastille } from '@/components/Pastille';
import { ApiError } from '@/lib/api';
import { isSessionError } from '@/lib/bureau/api/core';
import { getMember, getMemberLink, updateMember } from '@/lib/bureau/api/members';
import { listPayments } from '@/lib/bureau/api/payments';
import { takeFlash } from '@/lib/bureau/flash';
import { errorMessage } from '@/lib/bureau/messages';
import { openPendingTab } from '@/lib/bureau/pendingTab';
import { remindByWhatsapp } from '@/lib/bureau/remind';
import {
  hasMembershipCard,
  LEFT_REASONS,
  PAYMENT_STATUS_LABELS,
  type MemberDetail,
  type Payment,
} from '@/lib/bureau/types';
import { firstName } from '@/lib/bureau/words';
import { formatDate, formatDateTime } from '@/lib/dates';
import { spacedPhone } from '@/lib/phone';

/**
 * Chargés à la demande (F4 § 4) : les panneaux d'« Autres actions » ne
 * s'ouvrent qu'au toucher d'un bouton.
 */
const panelLoading = () => <p className="small m-0 text-ink-muted">Chargement…</p>;
const MemberForm = dynamic(
  () => import('@/components/bureau/MemberForm').then((m) => m.MemberForm),
  { loading: panelLoading },
);
const MemberLinkPanel = dynamic(
  () => import('@/components/bureau/MemberLinkPanel').then((m) => m.MemberLinkPanel),
  { loading: panelLoading },
);
const LeavePanel = dynamic(
  () => import('@/components/bureau/LeavePanel').then((m) => m.LeavePanel),
  { loading: panelLoading },
);
const CancelPaymentPanel = dynamic(
  () => import('@/components/bureau/CancelPaymentPanel').then((m) => m.CancelPaymentPanel),
  { loading: panelLoading },
);
/**
 * F6 § 7 — les contacts d'une organisation, eux aussi à la demande : ils ne
 * servent qu'à une fiche sur dix, et tiraient `ConfirmDialog` dans le premier
 * chargement de toutes.
 */
const ContactsPanel = dynamic(
  () => import('@/components/bureau/ContactsPanel').then((m) => m.ContactsPanel),
  { loading: panelLoading },
);
const AttestationsPanel = dynamic(() => import('@/components/bureau/AttestationsPanel'), {
  loading: () => <p className="small m-0 text-ink-muted">Chargement des attestations…</p>,
});

type Load<T> =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; value: T };

type Action = 'edit' | 'attest' | 'link' | 'leave' | 'cancel';

/** Une année que la fiche montre : une période en base, ou une année manquante. */
type Year = { key: string; label: string; amount: string | null };

/**
 * Les années de la fiche (§12.3, §12.8). Les arriérés NON RÉCLAMÉS — périodes
 * en base ou années manquantes — sont repliés (P6) ; sous `all`, les années
 * RÉCLAMÉES restent visibles, puisqu'elles font le reste à payer.
 */
export function yearsOf(member: MemberDetail): { claimed: Year[]; unclaimed: Year[] } {
  const claimed: Year[] = [];
  const unclaimed: Year[] = [];
  for (const due of member.dues) {
    if (due.status !== 'due' && due.status !== 'partielle') continue;
    const year = {
      key: due.id,
      label: periodLabel(due.period_start, due.period_end),
      amount: due.balance_due_formatted,
    };
    (due.is_unclaimed_arrears ? unclaimed : claimed).push(year);
  }
  for (const gap of member.missing_periods ?? []) {
    const year = {
      key: `manquante-${gap.period_start}`,
      label: gap.period_label?.trim() || periodLabel(gap.period_start, gap.period_end),
      amount: gap.amount_due_formatted,
    };
    (gap.is_unclaimed_arrears ? unclaimed : claimed).push(year);
  }
  return { claimed, unclaimed };
}

/** Le membre doit quelque chose (un arriéré réclamé compte, sous `all`). */
function owes(member: MemberDetail): boolean {
  return !member.is_up_to_date || (member.balance_due !== null && member.balance_due > 0);
}

/**
 * Écran 8 — la fiche d'un membre. UN seul montant (« Reste à payer » ou « À
 * jour jusqu'au … »), un seul bouton principal (« {prénom} a payé :
 * l'enregistrer »), ses paiements, et le reste dans « Autres actions ». Le
 * prénom remplace « il » et « elle » : l'API ne connaît pas le genre.
 */
export default function FicheMembrePage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? safeDecode(params.id) : '';
  const { settings, modeSupported, markModeUnsupported } = useBureau();
  useBackBar({ href: '/bureau/membres', label: 'Les membres' });

  const [member, setMember] = useState<Load<MemberDetail>>({ kind: 'loading' });
  const [payments, setPayments] = useState<Load<Payment[]>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState<ReactNode | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    const flash = takeFlash();
    if (flash) setToast(flash);
    if (new URLSearchParams(window.location.search).get('cree') === '1') {
      setNotice('Membre ajouté. Envoyez-lui maintenant son lien : « Autres actions ».');
    }
  }, []);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    const controller = new AbortController();
    const swallow = (error: unknown) =>
      (error instanceof DOMException && error.name === 'AbortError') || isSessionError(error);

    void (async () => {
      try {
        setMember({ kind: 'ready', value: await getMember(id, controller.signal) });
      } catch (error) {
        if (swallow(error)) return;
        // Le 404 nomme une classe PHP (piège 11) : on ne le recopie jamais.
        if (error instanceof ApiError && error.status === 404) {
          setMember({ kind: 'not-found' });
          return;
        }
        if (isModeUnsupported(error)) markModeUnsupported();
        setMember({
          kind: 'error',
          message: errorMessage(error, 'La fiche du membre n’a pas pu être chargée.'),
        });
      }
    })();

    void (async () => {
      try {
        const list = await listPayments({ member_id: id, status: 'all' }, controller.signal);
        setPayments({ kind: 'ready', value: list });
      } catch (error) {
        if (swallow(error)) return;
        if (error instanceof ApiError && error.code === 'unknown_member') {
          setPayments({ kind: 'not-found' });
          return;
        }
        setPayments({
          kind: 'error',
          message: errorMessage(error, 'Ses paiements n’ont pas pu être chargés.'),
        });
      }
    })();

    return () => controller.abort();
  }, [id, attempt, markModeUnsupported]);

  if (member.kind === 'loading') return <Skeleton label="Chargement de la fiche…" />;

  if (member.kind === 'not-found') return <EmptyState>Membre introuvable.</EmptyState>;

  if (member.kind === 'error') {
    return (
      <Notice tone="late">
        <span>{member.message}</span>
        <span>
          <Button onClick={reload}>Réessayer</Button>
        </span>
      </Notice>
    );
  }

  const m = member.value;
  const who = firstName(m);
  const former = m.status === 'former';
  const cardEnabled = hasMembershipCard(settings);
  const { claimed, unclaimed } = yearsOf(m);
  const late = !former && owes(m);
  const dueOn = formatDate(m.next_due_date);

  async function remind() {
    setBlocked(null);
    const outcome = await remindByWhatsapp(m.id);
    if (outcome.kind === 'no-phone') setToast(`${who} n’a pas de téléphone.`);
    if (outcome.kind === 'error') setToast(outcome.message);
    if (outcome.kind === 'blocked') setBlocked(outcome.url);
  }

  async function openPage() {
    const tab = openPendingTab();
    try {
      const link = await getMemberLink(m.id);
      if (!tab.go(link.url)) setBlocked(link.url);
    } catch (cause) {
      tab.close();
      if (!isSessionError(cause)) setToast(errorMessage(cause, 'Sa page n’a pas pu être ouverte.'));
    }
  }

  function openAction(next: Action) {
    setAction((current) => (current === next ? null : next));
  }

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="title m-0 min-w-0 break-words">{m.name}</h1>
          <MemberPastille member={m} late={late} />
        </div>
        <p className="m-0 text-ink-muted">
          {[
            m.category_label,
            m.member_number ? `n° ${m.member_number}` : null,
            m.phone ? spacedPhone(m.phone) : 'pas de téléphone',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <JoinLines member={m} />
      </div>

      {notice ? <Notice tone="paid">{notice}</Notice> : null}

      {blocked ? (
        <Notice tone="info">
          <span>L’onglet ne s’est pas ouvert tout seul.</span>
          <a href={blocked} target="_blank" rel="noopener noreferrer" className="font-semibold">
            L’ouvrir maintenant
          </a>
        </Notice>
      ) : null}

      {m.status === 'rejected' ? (
        <Notice tone="late">
          <span>
            Demande d’adhésion refusée.
            {m.application_rejection_reason ? (
              <>
                {' '}
                Motif : <span className="whitespace-pre-line">{m.application_rejection_reason}</span>
              </>
            ) : null}
          </span>
        </Notice>
      ) : m.status === 'pending' && (settings.admission_mode ?? 'bureau') === 'bureau' ? (
        <Notice tone="info">
          <span>Cette personne demande à adhérer.</span>
          <Link href="/bureau/demandes" className="font-semibold">
            Examiner sa demande
          </Link>
        </Notice>
      ) : former ? (
        <Notice tone="due">
          Ancien membre
          {m.left_at ? ` depuis le ${formatDate(m.left_at)}` : ''}
          {m.left_reason
            ? ` — ${LEFT_REASONS.find((r) => r.value === m.left_reason)?.label ?? ''}`
            : ''}
          . Son historique est conservé.
        </Notice>
      ) : !modeSupported ? (
        <p className="m-0 text-ink-muted">
          Sa situation s’affichera quand le mode de cotisation sera pris en charge.
        </p>
      ) : late ? (
        <>
          <section className="flex flex-col gap-1 rounded-[var(--radius-md)] bg-due-soft p-4" data-testid="due-box">
            <Label className="text-due">Reste à payer</Label>
            {/* UN seul montant. null = INCONNU, jamais « 0 FCFA » (piège 4). */}
            <span className="amount text-due">{m.balance_due_formatted ?? '—'}</span>
            <span>
              {claimed.length > 1
                ? `Ses cotisations de ${claimed.length} années.`
                : 'Sa cotisation de cette année.'}
              {dueOn ? ` ${who} aurait dû payer le ${dueOn}.` : ''}
            </span>
          </section>
          <div className="flex flex-col gap-[10px]">
            <Link
              href={`${RECORD_PATH}?membre=${encodeURIComponent(m.id)}`}
              className={bigButtonClass('primary')}
            >
              {who} a payé : l’enregistrer
            </Link>
            {m.phone ? (
              <button type="button" onClick={() => void remind()} className={bigButtonClass('outline')}>
                <ChatIcon size={22} />
                Lui envoyer un rappel par WhatsApp
              </button>
            ) : (
              <p className="small m-0 text-ink-muted">
                Pas de téléphone : impossible de lui envoyer un rappel par WhatsApp.
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <section className="flex flex-col items-start gap-1 rounded-[var(--radius-md)] bg-paid-soft px-4 py-5" data-testid="ok-box">
            <Label className="text-paid">Cotisation</Label>
            <b className="text-paid">
              {formatDate(m.covered_until)
                ? `À jour jusqu’au ${formatDate(m.covered_until)}`
                : m.status === 'pending'
                  ? 'Demande d’adhésion en attente'
                  : 'À jour'}
            </b>
          </section>
          <Link
            href={`${RECORD_PATH}?membre=${encodeURIComponent(m.id)}`}
            className={bigButtonClass('outline-indigo')}
          >
            {who} a payé : l’enregistrer
          </Link>
        </>
      )}

      {m.status === 'rejected' ? null : <PaymentsSection payments={payments} onRetry={reload} />}

      {m.answers && m.answers.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="heading m-0">Ses réponses</h2>
          <div className="rounded-[var(--radius-md)] border border-line bg-surface-raised p-4">
            <AnswersList answers={m.answers} />
          </div>
        </section>
      ) : null}

      {modeSupported && claimed.length > 1 ? (
        <section className="flex flex-col gap-2" data-testid="claimed-years">
          <h2 className="heading m-0">Les années à payer</h2>
          <ul className="m-0 flex list-none flex-col rounded-[var(--radius-md)] border border-line bg-surface-raised px-4 py-1">
            {claimed.map((year) => (
              <li key={year.key} className="flex justify-between gap-3 border-b border-line py-[10px] last:border-b-0">
                <span>{year.label || '—'}</span>
                <b className="money tnum">{year.amount ?? '—'}</b>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {modeSupported && unclaimed.length > 0 ? (
        <details
          className="group rounded-[var(--radius-md)] border border-line bg-surface-raised px-4"
          data-testid="unclaimed-years"
        >
          <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span>Anciennes années, non demandées ({unclaimed.length})</span>
            <span className="small font-semibold text-indigo group-open:hidden">Voir</span>
            <span className="small hidden font-semibold text-indigo group-open:inline">Masquer</span>
          </summary>
          <div className="flex flex-col gap-2 pb-[14px]">
            <p className="small m-0 text-ink-muted">
              L’association ne réclame que l’année en cours. Ces années restent notées
              ici, pour mémoire : elles ne comptent pas dans le reste à payer.
            </p>
            <ul className="m-0 flex list-none flex-col p-0">
              {unclaimed.map((year) => (
                <li key={year.key} className="small flex justify-between gap-3 border-t border-line py-2">
                  <span>{year.label || '—'}</span>
                  <span className="money tnum text-ink-muted">{year.amount ?? '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      {former ? null : (
        <button type="button" onClick={() => void openPage()} className={LINK_BUTTON}>
          Voir sa page, comme {who} la voit
        </button>
      )}

      <button
        type="button"
        className={LINK_BUTTON}
        aria-expanded={more}
        aria-controls="autres-actions"
        onClick={() => setMore((v) => !v)}
      >
        Autres actions (modifier, départ, annuler un paiement)
      </button>

      {more ? (
        <section id="autres-actions" className="flex flex-col gap-3" aria-label="Autres actions">
          <div className="flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-raised">
            <MoreRow on={action === 'edit'} onClick={() => openAction('edit')}>
              Modifier ses informations (dont le numéro de membre)
            </MoreRow>
            {cardEnabled ? (
              <MoreRow on={action === 'attest'} onClick={() => openAction('attest')}>
                Ses attestations d’adhésion
              </MoreRow>
            ) : null}
            {former ? null : (
              <MoreRow on={action === 'link'} onClick={() => openAction('link')}>
                Son lien personnel : l’envoyer ou le changer
              </MoreRow>
            )}
            {former ? null : (
              <MoreRow on={action === 'leave'} onClick={() => openAction('leave')}>
                Enregistrer son départ
              </MoreRow>
            )}
            {modeSupported ? (
              <MoreRow on={action === 'cancel'} onClick={() => openAction('cancel')}>
                Annuler un paiement (erreur de saisie)
              </MoreRow>
            ) : null}
          </div>

          {action === 'edit' ? (
            <MemberForm
              memberTypes={settings.member_types}
              initial={m}
              initialAnswers={m.answers}
              submitLabel="Enregistrer les modifications"
              onCancel={() => setAction(null)}
              onSubmit={async (input) => {
                const updated = await updateMember(m.id, input);
                setAction(null);
                setMember({ kind: 'ready', value: { ...m, ...updated } });
                setNotice('Fiche mise à jour.');
                reload();
              }}
            />
          ) : null}

          {action === 'attest' && cardEnabled ? (
            <AttestationsPanel
              attestations={m.attestations ?? []}
              memberId={m.id}
              canIssue={!former}
              onIssued={(issued) => {
                setNotice(`Attestation ${issued.reference} délivrée.`);
                reload();
              }}
            />
          ) : null}

          {action === 'link' && !former ? (
            <MemberLinkPanel
              memberId={m.id}
              memberName={m.name}
              cardEnabled={cardEnabled}
              onClose={() => setAction(null)}
            />
          ) : null}

          {action === 'leave' && !former ? (
            <LeavePanel
              member={m}
              onClose={() => setAction(null)}
              onDone={(updated) => {
                setAction(null);
                setMember({ kind: 'ready', value: { ...m, ...updated } });
                setNotice('Départ enregistré. Ce membre figure désormais dans les anciens membres.');
                reload();
              }}
            />
          ) : null}

          {action === 'cancel' ? (
            <CancelSection
              payments={payments}
              memberName={m.name}
              onCancelled={(cancelled) => {
                setNotice(
                  <>
                    Paiement de <span className="money">{cancelled.amount_formatted}</span> annulé.
                    {cancelled.receipt ? ` Le reçu ${cancelled.receipt.reference} est marqué annulé.` : ''}{' '}
                    Rien n’a été supprimé.
                  </>,
                );
                setAction(null);
                reload();
              }}
              onStale={(message) => {
                setNotice(message);
                reload();
              }}
            />
          ) : null}
        </section>
      ) : null}

      {m.type === 'organisation' ? (
        <ContactsPanel
          memberId={m.id}
          contacts={m.contacts ?? []}
          onChange={(contacts) => setMember({ kind: 'ready', value: { ...m, contacts } })}
        />
      ) : null}

      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}

/**
 * §20.8 et §17.7 — les lignes discrètes sous le nom : qui a décidé de
 * l'adhésion (la date seule si le compte n'existe plus, jamais « inconnu »),
 * qui a invité ce membre, et combien de personnes il a fait venir.
 */
export function joinLines(member: MemberDetail): string[] {
  const lines: string[] = [];
  const decision = member.application_decision;
  const when = formatDateTime(decision?.at ?? null);
  const by = decision?.by_name?.trim();
  if (decision?.decision === 'admitted' && when) {
    lines.push(by ? `Admis le ${when} par ${by}` : `Admis le ${when}`);
  }
  if (decision?.decision === 'refused' && when) {
    lines.push(by ? `Demande refusée le ${when} par ${by}` : `Demande refusée le ${when}`);
  }
  const parts: string[] = [];
  if (member.referred_by?.display_name) parts.push(`Invitation de ${member.referred_by.display_name}`);
  const joined = member.referrals_count?.joined ?? 0;
  if (joined > 0) parts.push(`A fait venir ${joined > 1 ? `${joined} personnes` : '1 personne'}`);
  if (parts.length > 0) lines.push(parts.join(' · '));
  return lines;
}

function JoinLines({ member }: { member: MemberDetail }) {
  const lines = joinLines(member);
  if (lines.length === 0) return null;
  return (
    <div className="small mt-1 flex flex-col text-ink-muted" data-testid="join-lines">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function MemberPastille({ member, late }: { member: MemberDetail; late: boolean }) {
  if (member.status === 'former') return <Pastille tone="due">Ancien membre</Pastille>;
  if (member.status === 'rejected') return <Pastille tone="late">Demande refusée</Pastille>;
  if (member.status === 'pending') return <Pastille tone="info">Demande d’adhésion</Pastille>;
  return late ? <Pill tone="late">En retard</Pill> : <Pill tone="ok">À jour</Pill>;
}

function MoreRow({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={on}
      onClick={onClick}
      className={`flex min-h-14 w-full items-center justify-between gap-3 border-b border-line px-4 py-2 text-left text-[16px] last:border-b-0 ${
        on ? 'bg-indigo-soft font-semibold text-indigo' : 'bg-surface-raised text-ink'
      }`}
    >
      <span>{children}</span>
      <span aria-hidden="true" className="font-semibold text-indigo">
        ›
      </span>
    </button>
  );
}

const PAYMENT_TONE: Record<Payment['status'], 'paid' | 'late' | 'info' | 'due'> = {
  declared: 'info',
  validated: 'paid',
  rejected: 'late',
  cancelled: 'due',
};

/**
 * « Ses paiements » — le plus récent d'abord, un lien « Reçu » par ligne. Un
 * paiement annulé reste listé, marqué (piège 33) ; un paiement à vérifier
 * conduit à « Paiements à vérifier ».
 */
function PaymentsSection({ payments, onRetry }: { payments: Load<Payment[]>; onRetry: () => void }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="heading m-0">Ses paiements</h2>
      {payments.kind === 'loading' ? (
        <p className="small m-0 text-ink-muted">Chargement de ses paiements…</p>
      ) : null}
      {payments.kind === 'not-found' ? <p className="m-0 text-ink-muted">Membre introuvable.</p> : null}
      {payments.kind === 'error' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-late">{payments.message}</span>
          <Button onClick={onRetry}>Réessayer</Button>
        </div>
      ) : null}
      {payments.kind === 'ready' && payments.value.length === 0 ? (
        <p className="m-0 text-ink-muted">Aucun paiement pour le moment.</p>
      ) : null}
      {payments.kind === 'ready' && payments.value.length > 0 ? (
        <ul className="m-0 flex list-none flex-col rounded-[var(--radius-md)] border border-line bg-surface-raised px-4 py-1" data-testid="payments">
          {[...payments.value].reverse().map((payment) => {
            const when = formatDate(payment.paid_on) || formatDateTime(payment.declared_at);
            return (
              <li
                key={payment.id}
                id={`paiement-${payment.id}`}
                className="flex flex-col gap-1 border-b border-line py-[10px] last:border-b-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <b className="money tnum">{payment.amount_formatted}</b>
                    <br />
                    <span className="small text-ink-muted">
                      {[payment.method_label, when].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {payment.status === 'validated' ? null : (
                      <Pastille tone={PAYMENT_TONE[payment.status]}>
                        {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                      </Pastille>
                    )}
                    {payment.receipt ? (
                      <ReceiptButton
                        receiptId={payment.receipt.id}
                        reference={payment.receipt.reference}
                        label="Reçu"
                        className={`${LINK_BUTTON} px-0 py-1`}
                      />
                    ) : null}
                  </span>
                </div>
                {payment.status === 'rejected' && payment.rejection_reason ? (
                  <span className="small text-ink-muted">
                    {decisionLabel('Refusé', payment.decided_at, payment.decided_by_name)} —{' '}
                    {payment.rejection_reason}
                  </span>
                ) : null}
                {payment.status === 'cancelled' ? (
                  <span className="small font-semibold text-late" data-testid="cancelled-line">
                    {decisionLabel('Annulé', payment.cancelled_at ?? null, payment.cancelled_by_name ?? null)}
                    {payment.cancel_reason ? ` — motif : ${payment.cancel_reason}` : ''}
                  </span>
                ) : null}
                {payment.status === 'declared' ? (
                  <Link href={VERIFY_PATH} className="small font-semibold">
                    À vérifier dans « Paiements à vérifier »
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/** « Annuler un paiement » : un paiement ACCEPTÉ s'annule ; un signalé se refuse. */
function CancelSection({
  payments,
  memberName,
  onCancelled,
  onStale,
}: {
  payments: Load<Payment[]>;
  memberName: string;
  onCancelled: (payment: Payment) => void;
  onStale: (message: string) => void;
}) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  if (payments.kind !== 'ready') return null;
  const accepted = [...payments.value].reverse().filter((p) => p.status === 'validated');
  if (accepted.length === 0) {
    return <p className="m-0 text-ink-muted">Aucun paiement accepté à annuler.</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {accepted.map((payment) => (
        <li key={payment.id} className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-line bg-surface-raised p-3">
          <span>
            <b className="money tnum">{payment.amount_formatted}</b> · {payment.method_label}
            {formatDate(payment.paid_on) ? ` · ${formatDate(payment.paid_on)}` : ''}
          </span>
          {cancelling === payment.id ? (
            <CancelPaymentPanel
              payment={payment}
              memberName={memberName}
              onClose={() => setCancelling(null)}
              onDone={(cancelled) => {
                setCancelling(null);
                onCancelled(cancelled);
              }}
              onStale={(message) => {
                setCancelling(null);
                onStale(message);
              }}
            />
          ) : (
            <span>
              <Button tone="ghost" className="px-0 text-late!" onClick={() => setCancelling(payment.id)}>
                Annuler ce paiement
              </Button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
