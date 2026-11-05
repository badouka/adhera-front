'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useBackBar } from '@/components/bureau/BureauContext';
import { ReceiptButton } from '@/components/bureau/Documents';
import { Button, inputClass, LINK_BUTTON, Notice, PageTitle, Skeleton } from '@/components/bureau/ui';
import { Pastille } from '@/components/Pastille';
import { isSessionError } from '@/lib/bureau/api/core';
import { listPayments } from '@/lib/bureau/api/payments';
import { errorMessage } from '@/lib/bureau/messages';
import { PAYMENT_STATUS_LABELS, type Payment } from '@/lib/bureau/types';
import { formatDate, formatDateTime, todayInDakar } from '@/lib/dates';
import { PAYMENT_METHODS } from '@/lib/types';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; payments: Payment[] };

const TONE: Record<Payment['status'], 'paid' | 'late' | 'info' | 'due'> = {
  declared: 'info',
  validated: 'paid',
  rejected: 'late',
  cancelled: 'due',
};

/** Le jour d'un paiement : sa date de paiement, à défaut le jour où il a été signalé. */
function dayOf(payment: Payment): string {
  return payment.paid_on ?? payment.declared_at?.slice(0, 10) ?? '';
}

/**
 * « Tous les paiements » (A6), rangé dans « Plus » : le journal — accepté,
 * refusé, annulé ou à vérifier —, avec un filtre par jour et par moyen de
 * paiement. Le plus récent d'abord ; les montants sont ceux du serveur (R1).
 */
export default function TousLesPaiementsPage() {
  useBackBar({ href: '/bureau/plus', label: 'Plus' });
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [day, setDay] = useState('');
  const [method, setMethod] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const payments = await listPayments({ status: 'all' }, controller.signal);
        setLoad({ kind: 'ready', payments });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (isSessionError(cause)) return;
        setLoad({
          kind: 'error',
          message: errorMessage(cause, 'Les paiements n’ont pas pu être chargés.'),
        });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const shown = useMemo(() => {
    if (load.kind !== 'ready') return [];
    return [...load.payments]
      .reverse()
      .filter((p) => (day ? dayOf(p) === day : true))
      .filter((p) => (method ? p.method === method : true));
  }, [load, day, method]);

  return (
    <>
      <PageTitle title="Tous les paiements" subtitle="Acceptés, refusés, annulés ou à vérifier." />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="small font-semibold">Jour</span>
          <input
            type="date"
            value={day}
            max={todayInDakar()}
            onChange={(e) => setDay(e.target.value)}
            className={inputClass(false, 'w-auto')}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="small font-semibold">Moyen de paiement</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className={inputClass(false, 'w-auto')}
          >
            <option value="">Tous</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {day || method ? (
          <button
            type="button"
            className={LINK_BUTTON}
            onClick={() => {
              setDay('');
              setMethod('');
            }}
          >
            Tout afficher
          </button>
        ) : null}
      </div>
      {day ? (
        <p className="small m-0 text-ink-muted" data-testid="day-words">
          Le {formatDate(day)}
        </p>
      ) : null}

      {load.kind === 'loading' ? <Skeleton label="Chargement des paiements…" /> : null}
      {load.kind === 'error' ? (
        <Notice tone="late">
          <span>{load.message}</span>
          <span>
            <Button onClick={() => setAttempt((n) => n + 1)}>Réessayer</Button>
          </span>
        </Notice>
      ) : null}

      {load.kind === 'ready' ? (
        shown.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-md)] border border-dashed border-line-strong bg-surface-raised p-6 text-center text-ink-muted">
            Aucun paiement ne correspond.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col rounded-[var(--radius-md)] border border-line bg-surface-raised px-4 py-1" data-testid="journal">
            {shown.map((payment) => (
              <li key={payment.id} className="flex items-start justify-between gap-3 border-b border-line py-[10px] last:border-b-0">
                <span className="min-w-0">
                  <Link
                    href={`/bureau/membres/${encodeURIComponent(payment.member_id)}`}
                    className="font-semibold break-words"
                  >
                    {payment.member_name}
                  </Link>
                  <br />
                  <span className="small text-ink-muted">
                    {[payment.method_label, formatDate(payment.paid_on) || formatDateTime(payment.declared_at)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <b className="money tnum">{payment.amount_formatted}</b>
                  <Pastille tone={TONE[payment.status]}>
                    {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                  </Pastille>
                  {payment.receipt ? (
                    <ReceiptButton
                      receiptId={payment.receipt.id}
                      reference={payment.receipt.reference}
                      label="Reçu"
                      className={`${LINK_BUTTON} px-0 py-1`}
                    />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
