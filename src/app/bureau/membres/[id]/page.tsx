'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useBureau } from '@/components/bureau/BureauContext';
import { ContactsPanel } from '@/components/bureau/ContactsPanel';
import { DirectPaymentPanel } from '@/components/bureau/DirectPaymentPanel';
import { ReceiptButton } from '@/components/bureau/Documents';
import { decisionLabel, isModeUnsupported, periodLabel } from '@/components/bureau/format';
import { CashIcon, ChatIcon, ChevronLeftIcon } from '@/components/bureau/Icons';
import { LeavePanel } from '@/components/bureau/LeavePanel';
import { MemberForm } from '@/components/bureau/MemberForm';
import { MemberLinkPanel } from '@/components/bureau/MemberLinkPanel';
import { StandingPastille } from '@/components/bureau/Standing';
import {
  Button,
  EmptyState,
  Notice,
  PageTitle,
  Panel,
  Row,
  Skeleton,
} from '@/components/bureau/ui';
import { Pastille } from '@/components/Pastille';
import { ApiError } from '@/lib/api';
import { getMember, isSessionError, listPayments, updateMember } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import {
  DUE_STATUS_LABELS,
  LEFT_REASONS,
  PAYMENT_STATUS_LABELS,
  type MemberDetail,
  type MemberDue,
  type Payment,
} from '@/lib/bureau/types';
import { formatDate, formatDateTime } from '@/lib/dates';

type Load<T> =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; value: T };

type Action = 'link' | 'payment' | 'leave' | null;

type Notice_ = { tone: 'paid' | 'info'; text: string; receipt?: Payment['receipt'] };

/**
 * B7 — la fiche d'un membre : identité, situation, cotisations (et leurs
 * reçus), versements, contacts pour une organisation. Les trois gestes du
 * bureau partent d'ici : envoyer le lien, enregistrer un versement, déclarer
 * une sortie.
 */
export default function FicheMembrePage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? safeDecode(params.id) : '';
  const { settings, modeSupported, markModeUnsupported } = useBureau();

  const [member, setMember] = useState<Load<MemberDetail>>({ kind: 'loading' });
  const [payments, setPayments] = useState<Load<Payment[]>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [action, setAction] = useState<Action>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<Notice_ | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('cree') === '1') {
      setNotice({ tone: 'paid', text: 'Membre ajouté. Envoyez-lui maintenant son lien.' });
    }
  }, []);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

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
          message: errorMessage(error, 'Les versements n’ont pas pu être chargés.'),
        });
      }
    })();

    return () => controller.abort();
  }, [id, attempt, markModeUnsupported]);

  if (member.kind === 'loading') return <Skeleton label="Chargement de la fiche…" />;

  if (member.kind === 'not-found') {
    return (
      <>
        <BackLink />
        <EmptyState>Membre introuvable.</EmptyState>
      </>
    );
  }

  if (member.kind === 'error') {
    return (
      <>
        <BackLink />
        <Notice tone="late">
          <span>{member.message}</span>
          <span>
            <Button onClick={reload}>Réessayer</Button>
          </span>
        </Notice>
      </>
    );
  }

  const m = member.value;
  const former = m.status === 'former';

  return (
    <>
      <BackLink />
      <PageTitle
        title={m.name}
        subtitle={[
          m.type === 'organisation' ? 'Organisation' : 'Personne',
          m.category_label,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={<StandingPastille member={m} />}
      />

      {notice ? (
        <Notice tone={notice.tone}>
          <span>{notice.text}</span>
          <span className="flex flex-wrap gap-2">
            {notice.receipt ? (
              <ReceiptButton
                receiptId={notice.receipt.id}
                reference={notice.receipt.reference}
                tone="primary"
              />
            ) : null}
            <Button tone="ghost" onClick={() => setNotice(null)}>
              Fermer
            </Button>
          </span>
        </Notice>
      ) : null}

      {former ? (
        <Notice tone="due">
          Ancien membre
          {m.left_at ? ` depuis le ${formatDate(m.left_at)}` : ''}
          {m.left_reason
            ? ` — ${LEFT_REASONS.find((r) => r.value === m.left_reason)?.label ?? ''}`
            : ''}
          . Son historique est conservé.
        </Notice>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            tone={action === 'link' ? 'primary' : 'secondary'}
            onClick={() => setAction(action === 'link' ? null : 'link')}
            aria-expanded={action === 'link'}
          >
            <ChatIcon />
            Envoyer le lien
          </Button>
          {modeSupported ? (
            <Button
              tone={action === 'payment' ? 'primary' : 'secondary'}
              onClick={() => setAction(action === 'payment' ? null : 'payment')}
              aria-expanded={action === 'payment'}
            >
              <CashIcon size={18} />
              Encaisser
            </Button>
          ) : null}
          <Button
            tone="ghost"
            onClick={() => setAction(action === 'leave' ? null : 'leave')}
            aria-expanded={action === 'leave'}
          >
            Déclarer une sortie
          </Button>
        </div>
      )}

      {action === 'link' && !former ? (
        <MemberLinkPanel memberId={m.id} memberName={m.name} onClose={() => setAction(null)} />
      ) : null}

      {action === 'payment' && !former && modeSupported ? (
        <DirectPaymentPanel
          member={m}
          onClose={() => setAction(null)}
          onModeUnsupported={markModeUnsupported}
          onDone={(payment) => {
            setAction(null);
            const period = periodLabel(payment.due?.period_start, payment.due?.period_end);
            setNotice({
              tone: 'paid',
              text: `${
                payment.receipt ? `Reçu ${payment.receipt.reference} émis` : 'Paiement encaissé'
              } — ${payment.amount_formatted}.${period ? ` Cotisation ${period}.` : ''}`,
              receipt: payment.receipt,
            });
            reload();
          }}
        />
      ) : null}

      {action === 'leave' && !former ? (
        <LeavePanel
          member={m}
          onClose={() => setAction(null)}
          onDone={(updated) => {
            setAction(null);
            setMember({ kind: 'ready', value: { ...m, ...updated } });
            setNotice({ tone: 'info', text: 'Sortie enregistrée. Le membre figure désormais dans les anciens membres.' });
            reload();
          }}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Identité"
          actions={
            editing ? null : (
              <Button tone="ghost" onClick={() => setEditing(true)}>
                Modifier
              </Button>
            )
          }
        >
          {editing ? (
            <MemberForm
              memberTypes={settings.member_types}
              initial={m}
              submitLabel="Enregistrer les modifications"
              onCancel={() => setEditing(false)}
              onSubmit={async (input) => {
                const updated = await updateMember(m.id, input);
                setEditing(false);
                setMember({ kind: 'ready', value: { ...m, ...updated } });
                setNotice({ tone: 'paid', text: 'Fiche mise à jour.' });
                reload();
              }}
            />
          ) : (
            <dl className="m-0 flex flex-col gap-2">
              <Row label="Téléphone">{m.phone ?? '—'}</Row>
              <Row label="E-mail">{m.email ?? '—'}</Row>
              <Row label="Région">{m.region ?? '—'}</Row>
              <Row label="Catégorie">{m.category_label ?? '—'}</Row>
              <Row label="Adhésion">{formatDate(m.joined_at) || '—'}</Row>
            </dl>
          )}
        </Panel>

        <Panel title="Situation">
          {modeSupported ? (
            <dl className="m-0 flex flex-col gap-2">
              <Row label="Situation">
                {m.status === 'pending' ? 'Candidature' : m.is_up_to_date ? 'À jour' : 'Pas à jour'}
              </Row>
              <Row label="Couvert jusqu’au">{formatDate(m.covered_until) || '—'}</Row>
              <Row label="Prochaine échéance">{formatDate(m.next_due_date) || '—'}</Row>
              {/* null = INCONNU, jamais « 0 FCFA » (piège 4). */}
              <Row label="Reste à payer">
                <span className="money">{m.balance_due_formatted ?? '—'}</span>
              </Row>
            </dl>
          ) : (
            <p className="m-0 text-ink-muted">
              La situation de cotisation s’affichera quand le mode de cotisation
              sera pris en charge.
            </p>
          )}
        </Panel>
      </div>

      {modeSupported ? <DuesPanel dues={m.dues} /> : null}

      <PaymentsPanel payments={payments} onRetry={reload} />

      {m.type === 'organisation' ? (
        <ContactsPanel
          memberId={m.id}
          contacts={m.contacts ?? []}
          onChange={(contacts) => setMember({ kind: 'ready', value: { ...m, contacts } })}
        />
      ) : null}
    </>
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function BackLink() {
  return (
    <Link href="/bureau/membres" className="small inline-flex items-center gap-1 font-semibold">
      <ChevronLeftIcon />
      Membres
    </Link>
  );
}

const DUE_TONE: Record<MemberDue['status'], 'paid' | 'due' | 'late' | 'info'> = {
  due: 'late',
  partielle: 'due',
  reglee: 'paid',
  exoneree: 'info',
};

/** Les cotisations, avec les reçus téléchargeables de chaque période. */
function DuesPanel({ dues }: { dues: MemberDue[] }) {
  return (
    <Panel title="Cotisations">
      {dues.length === 0 ? (
        <EmptyState>Aucune cotisation enregistrée.</EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {dues.map((due) => (
            <li
              key={due.id}
              className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-line p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {periodLabel(due.period_start, due.period_end)
                    ? `Du ${formatDate(due.period_start)} au ${formatDate(due.period_end)}`
                    : '—'}
                </span>
                <Pastille tone={DUE_TONE[due.status] ?? 'info'}>
                  {DUE_STATUS_LABELS[due.status] ?? due.status}
                </Pastille>
              </div>
              {/* R1 : *_formatted seulement ; null = inconnu → « — ». */}
              <dl className="small tnum m-0 grid grid-cols-3 gap-2">
                <div className="flex flex-col">
                  <dt className="text-ink-muted">Cotisation</dt>
                  <dd className="money m-0 font-semibold">{due.amount_due_formatted ?? '—'}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-ink-muted">Payé</dt>
                  <dd className="money m-0 font-semibold">{due.amount_paid_formatted ?? '—'}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-ink-muted">Reste</dt>
                  <dd className="money m-0 font-semibold">{due.balance_due_formatted ?? '—'}</dd>
                </div>
              </dl>
              {due.receipts.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <span className="label text-ink-muted">REÇUS</span>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {due.receipts.map((receipt) => (
                      <li key={receipt.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <ReceiptButton
                          receiptId={receipt.id}
                          reference={receipt.reference}
                          compact
                        />
                        <span className="small tnum text-ink-muted">
                          <span className="money">{receipt.amount_formatted}</span>
                          {formatDateTime(receipt.issued_at)
                            ? `, le ${formatDateTime(receipt.issued_at)}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const PAYMENT_TONE: Record<Payment['status'], 'paid' | 'late' | 'info'> = {
  declared: 'info',
  validated: 'paid',
  rejected: 'late',
};

function PaymentsPanel({
  payments,
  onRetry,
}: {
  payments: Load<Payment[]>;
  onRetry: () => void;
}) {
  return (
    <Panel title="Versements">
      {payments.kind === 'loading' ? (
        <p className="small m-0 text-ink-muted">Chargement des versements…</p>
      ) : null}
      {payments.kind === 'not-found' ? (
        <p className="m-0 text-ink-muted">Membre introuvable.</p>
      ) : null}
      {payments.kind === 'error' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-late">{payments.message}</span>
          <Button onClick={onRetry}>Réessayer</Button>
        </div>
      ) : null}
      {payments.kind === 'ready' && payments.value.length === 0 ? (
        <EmptyState>Aucun versement pour ce membre.</EmptyState>
      ) : null}
      {payments.kind === 'ready' && payments.value.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {[...payments.value].reverse().map((payment) => (
            <li
              key={payment.id}
              className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-line p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="money tnum font-bold">{payment.amount_formatted}</span>
                <Pastille tone={PAYMENT_TONE[payment.status]}>
                  {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                </Pastille>
              </div>
              <span className="small">
                {[
                  payment.method_label,
                  payment.reference?.trim() ? `réf. ${payment.reference.trim()}` : null,
                  formatDate(payment.paid_on) ? `payé le ${formatDate(payment.paid_on)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {payment.status === 'validated' ? (
                <span className="small text-ink-muted">
                  {decisionLabel('Validé', payment.decided_at, payment.decided_by_name)}
                </span>
              ) : null}
              {payment.status === 'rejected' ? (
                <span className="small text-ink-muted">
                  {decisionLabel('Refusé', payment.decided_at, payment.decided_by_name)}
                  {payment.rejection_reason ? ` — ${payment.rejection_reason}` : ''}
                </span>
              ) : null}
              {payment.status === 'declared' ? (
                <Link href="/bureau" className="small font-semibold">
                  À valider depuis l’accueil
                </Link>
              ) : null}
              {payment.receipt ? (
                <span>
                  <ReceiptButton
                    receiptId={payment.receipt.id}
                    reference={payment.receipt.reference}
                    compact
                  />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
