import type { ReactNode } from 'react';
import { CheckIcon } from '@/components/Icons';
import { Pastille } from '@/components/Pastille';
import type { MemberListItem } from '@/lib/bureau/types';
import { formatDate } from '@/lib/dates';

/** La pastille de situation d'un membre, selon son statut puis sa cotisation. */
export function StandingPastille({ member }: { member: MemberListItem }) {
  if (member.status === 'pending') return <Pastille tone="info">Candidature</Pastille>;
  if (member.status === 'former') return <Pastille tone="due">Ancien membre</Pastille>;
  if (member.is_up_to_date) {
    return (
      <Pastille tone="paid" icon={<CheckIcon />}>
        À jour
      </Pastille>
    );
  }
  return <Pastille tone="late">Pas à jour</Pastille>;
}

/**
 * « Couvert jusqu'au … » pour un membre à jour, « Reste à payer … » sinon.
 *
 * ⚠️ `balance_due_formatted: null` veut dire INCONNU, jamais « rien à payer »
 * (piège 4) : on affiche « — », jamais « 0 FCFA ».
 */
export function standingDetail(member: MemberListItem): ReactNode {
  if (member.status === 'pending') return 'Candidature en attente';
  if (member.is_up_to_date) {
    const until = formatDate(member.covered_until);
    return until ? `Couvert jusqu’au ${until}` : 'À jour';
  }
  return (
    <>
      Reste à payer <span className="money">{member.balance_due_formatted ?? '—'}</span>
    </>
  );
}
