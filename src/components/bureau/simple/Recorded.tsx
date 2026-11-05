'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ReceiptButton } from '@/components/bureau/Documents';
import { ChatIcon } from '@/components/bureau/Icons';
import { CheckIcon } from '@/components/Icons';
import { isSessionError } from '@/lib/bureau/api/core';
import { getMember } from '@/lib/bureau/api/members';
import type { MemberDetail, PaymentWithShare } from '@/lib/bureau/types';
import { formatDate } from '@/lib/dates';
import { firstName, methodPhrase } from '@/lib/bureau/words';
import { bigButtonClass } from '../ui';
import { spacedPhone } from '@/lib/phone';

/**
 * « À jour jusqu'au 2 septembre 2027 », ou « Reste à payer : 15 000 FCFA » —
 * relu sur la fiche APRÈS le paiement : c'est le serveur qui sait ce qui
 * reste, l'écran ne soustrait rien (R1).
 */
export function StandingAfter({ member }: { member: MemberDetail }) {
  if (member.is_up_to_date) {
    const until = formatDate(member.covered_until);
    return (
      <span className="inline-flex min-h-7 items-center rounded-[var(--radius-pill)] bg-surface-raised px-3 text-[14px] font-semibold text-paid" data-testid="standing-after">
        {until ? `À jour jusqu’au ${until}` : 'À jour'}
      </span>
    );
  }
  return (
    <span className="inline-flex min-h-7 items-center rounded-[var(--radius-pill)] bg-late-soft px-3 text-[14px] font-semibold text-late" data-testid="standing-after">
      Reste à payer :&nbsp;<span className="money">{member.balance_due_formatted ?? '—'}</span>
    </span>
  );
}

/**
 * Écran 6 — « C'est enregistré ». Le paiement tel que le serveur l'a écrit,
 * la situation du membre relue, le n° de reçu, et le reçu à envoyer par
 * WhatsApp : le message est DÉJÀ RÉDIGÉ (`share`, §18.5). Sans numéro
 * utilisable, `share` vaut `null` et l'écran le dit — aucun bouton qui échoue.
 */
export function Recorded({
  payment,
  children,
}: {
  payment: PaymentWithShare;
  /** Les gestes qui suivent (« Enregistrer un autre paiement », « Paiement suivant »…). */
  children?: ReactNode;
}) {
  const [member, setMember] = useState<MemberDetail | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getMember(payment.member_id, controller.signal)
      .then(setMember)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isSessionError(error)) return;
        // Sans fiche, la pastille manque ; le reçu reste là.
      });
    return () => controller.abort();
  }, [payment.member_id]);

  const share = payment.share ?? null;
  const who = member ? firstName(member) : payment.member_name;

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4" data-testid="recorded">
      <section className="flex flex-col items-center gap-[10px] rounded-[var(--radius-md)] bg-paid-soft px-4 py-5 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-paid text-on-indigo">
          <CheckIcon size={30} />
        </span>
        <h1 className="title m-0 text-paid">C’est enregistré</h1>
        <p className="m-0">
          {payment.member_name} a payé{' '}
          <strong className="money">{payment.amount_formatted}</strong>{' '}
          {methodPhrase(payment.method, payment.method_label)}.
        </p>
        {member ? <StandingAfter member={member} /> : null}
        {payment.receipt ? (
          <span className="small text-ink-muted">Reçu n° {payment.receipt.reference}</span>
        ) : null}
      </section>

      {share ? (
        <>
          <p className="m-0">Envoyez-lui son reçu : c’est sa preuve de paiement.</p>
          <a
            href={share.whatsapp_url}
            target="_blank"
            rel="noopener noreferrer"
            className={bigButtonClass('primary')}
            data-testid="wa-receipt"
          >
            <ChatIcon size={22} />
            Envoyer le reçu par WhatsApp
          </a>
          <span className="small -mt-2 text-center text-ink-muted">À : {spacedPhone(share.phone)}</span>
        </>
      ) : (
        <p className="m-0 font-semibold" data-testid="no-phone">
          {who} n’a pas de téléphone : impossible d’envoyer le reçu par WhatsApp.
        </p>
      )}

      <div className="flex flex-col gap-[10px]">
        {payment.receipt ? (
          <ReceiptButton
            receiptId={payment.receipt.id}
            reference={payment.receipt.reference}
            label="Voir le reçu"
            tone="secondary"
            className={bigButtonClass('outline')}
          />
        ) : null}
        {children}
      </div>
    </div>
  );
}
