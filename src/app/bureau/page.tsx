'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useBureau } from '@/components/bureau/BureauContext';
import { ProofButton, ReceiptButton } from '@/components/bureau/Documents';
import { decisionLabel, periodLabel } from '@/components/bureau/format';
import { RejectDialog, ValidateDialog } from '@/components/bureau/PaymentDecisions';
import {
  Button,
  EmptyState,
  Notice,
  PageTitle,
  Skeleton,
  Tabs,
} from '@/components/bureau/ui';
import { isSessionError, listPayments } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import type { Payment, PaymentStatus } from '@/lib/bureau/types';
import { formatDate, formatDateTime } from '@/lib/dates';

const TABS: ReadonlyArray<{ value: PaymentStatus; label: string }> = [
  { value: 'declared', label: 'À valider' },
  { value: 'validated', label: 'Validés' },
  { value: 'rejected', label: 'Rejetés' },
];

const EMPTY: Record<PaymentStatus, string> = {
  declared: 'Aucun versement à valider.',
  validated: 'Aucun versement validé.',
  rejected: 'Aucune déclaration rejetée.',
};

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; payments: Payment[] };

type Outcome =
  | { kind: 'validated'; payment: Payment }
  | { kind: 'rejected'; payment: Payment };

/**
 * B2 — « À valider », la page d'accueil du bureau.
 *
 * Un membre a déclaré un versement depuis son lien : le trésorier le vérifie
 * (justificatif, relevé Orange Money ou Wave), puis le valide — ce qui émet le
 * reçu — ou le rejette avec un motif. Le plus ancien d'abord.
 */
export default function AValiderPage() {
  const { modeSupported, markModeUnsupported } = useBureau();
  const [tab, setTab] = useState<PaymentStatus>('declared');
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [action, setAction] = useState<
    { kind: 'validate' | 'reject'; payment: Payment } | null
  >(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    void (async () => {
      try {
        const payments = await listPayments({ status: tab }, controller.signal);
        setLoad({ kind: 'ready', payments });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isSessionError(error)) return;
        setLoad({
          kind: 'error',
          message: errorMessage(error, 'Les versements n’ont pas pu être chargés.'),
        });
      }
    })();
    return () => controller.abort();
  }, [tab, attempt]);

  const removeFromList = useCallback((id: string) => {
    setLoad((prev) =>
      prev.kind === 'ready'
        ? { ...prev, payments: prev.payments.filter((p) => p.id !== id) }
        : prev,
    );
  }, []);

  return (
    <>
      <PageTitle
        title="Versements"
        subtitle="Les versements déclarés par les membres depuis leur lien."
      />

      {outcome ? <OutcomeNotice outcome={outcome} onClose={() => setOutcome(null)} /> : null}

      <Tabs
        label="Statut des versements"
        value={tab}
        options={TABS}
        onChange={(next) => {
          setOutcome(null);
          setTab(next);
        }}
      />

      {load.kind === 'loading' ? <Skeleton label="Chargement des versements…" /> : null}

      {load.kind === 'error' ? (
        <Notice tone="late">
          <span>{load.message}</span>
          <span>
            <Button onClick={() => setAttempt((n) => n + 1)}>Réessayer</Button>
          </span>
        </Notice>
      ) : null}

      {load.kind === 'ready' && load.payments.length === 0 ? (
        <EmptyState>{EMPTY[tab]}</EmptyState>
      ) : null}

      {load.kind === 'ready' && load.payments.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {load.payments.map((payment) => (
            <li key={payment.id}>
              <PaymentCard
                payment={payment}
                canValidate={modeSupported}
                onValidate={() => setAction({ kind: 'validate', payment })}
                onReject={() => setAction({ kind: 'reject', payment })}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {action?.kind === 'validate' ? (
        <ValidateDialog
          payment={action.payment}
          onCancel={() => setAction(null)}
          onModeUnsupported={markModeUnsupported}
          onDone={(validated) => {
            setAction(null);
            removeFromList(validated.id);
            setOutcome({ kind: 'validated', payment: validated });
          }}
        />
      ) : null}

      {action?.kind === 'reject' ? (
        <RejectDialog
          payment={action.payment}
          onCancel={() => setAction(null)}
          onDone={(rejected) => {
            setAction(null);
            removeFromList(rejected.id);
            setOutcome({ kind: 'rejected', payment: rejected });
          }}
        />
      ) : null}
    </>
  );
}

function OutcomeNotice({
  outcome,
  onClose,
}: {
  outcome: Outcome;
  onClose: () => void;
}) {
  const { payment } = outcome;

  if (outcome.kind === 'rejected') {
    return (
      <Notice tone="info">
        <span>
          Déclaration de {payment.member_name} ({payment.amount_formatted}) rejetée.
          Le membre verra le motif sur sa page.
        </span>
        <span>
          <Button tone="ghost" className="px-0" onClick={onClose}>
            Fermer
          </Button>
        </span>
      </Notice>
    );
  }

  // Un reçu peut ne pas exister pour un cas limite : on ne promet que ce que
  // la réponse contient.
  return (
    <Notice tone="paid">
      <span>
        {payment.receipt ? 'Versement validé. Reçu émis.' : 'Versement validé.'}{' '}
        <span className="font-normal">
          {payment.member_name}, {payment.amount_formatted}.
        </span>
      </span>
      <span className="flex flex-wrap gap-2">
        {payment.receipt ? (
          <ReceiptButton
            receiptId={payment.receipt.id}
            reference={payment.receipt.reference}
            tone="primary"
          />
        ) : null}
        <Button tone="ghost" onClick={onClose}>
          Fermer
        </Button>
      </span>
    </Notice>
  );
}

function PaymentCard({
  payment,
  canValidate,
  onValidate,
  onReject,
}: {
  payment: Payment;
  canValidate: boolean;
  onValidate: () => void;
  onReject: () => void;
}) {
  const period = periodLabel(payment.due?.period_start, payment.due?.period_end);
  const declaredOn = formatDateTime(payment.declared_at);
  const paidOn = formatDate(payment.paid_on);

  return (
    <article className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/bureau/membres/${encodeURIComponent(payment.member_id)}`}
            className="heading break-words"
          >
            {payment.member_name}
          </Link>
          {period ? (
            <span className="small text-ink-muted">Cotisation {period}</span>
          ) : null}
        </div>
        {/* R1 : le montant tel que servi, jamais reformaté. */}
        <span className="tnum text-[22px] leading-7 font-bold">
          {payment.amount_formatted}
        </span>
      </div>

      <dl className="small m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-ink-muted">Mode</dt>
        <dd className="m-0 font-semibold">{payment.method_label}</dd>
        <dt className="text-ink-muted">Référence</dt>
        <dd className="m-0 font-semibold break-all">
          {payment.reference?.trim() || '—'}
        </dd>
        {paidOn ? (
          <>
            <dt className="text-ink-muted">Payé le</dt>
            <dd className="m-0">{paidOn}</dd>
          </>
        ) : null}
        {declaredOn ? (
          <>
            <dt className="text-ink-muted">Déclaré le</dt>
            <dd className="m-0">{declaredOn}</dd>
          </>
        ) : null}
      </dl>

      {payment.status === 'validated' ? (
        <p className="small m-0 font-semibold text-paid">
          {decisionLabel('Validé', payment.decided_at, payment.decided_by_name)}
        </p>
      ) : null}

      {payment.status === 'rejected' ? (
        <div className="small flex flex-col gap-1">
          <p className="m-0 font-semibold text-late">
            {decisionLabel('Rejeté', payment.decided_at, payment.decided_by_name)}
          </p>
          {payment.rejection_reason ? (
            <p className="m-0 whitespace-pre-line break-words">
              Motif : {payment.rejection_reason}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {payment.has_proof ? <ProofButton paymentId={payment.id} /> : null}
        {payment.status === 'validated' && payment.receipt ? (
          <ReceiptButton
            receiptId={payment.receipt.id}
            reference={payment.receipt.reference}
          />
        ) : null}
        {payment.status === 'declared' ? (
          <>
            <Button onClick={onReject}>
              Rejeter
            </Button>
            {canValidate ? (
              <Button tone="primary" onClick={onValidate}>
                Valider
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      {payment.status === 'declared' && !payment.has_proof ? (
        <p className="small m-0 text-ink-muted">Aucun justificatif joint.</p>
      ) : null}
    </article>
  );
}
