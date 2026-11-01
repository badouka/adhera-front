import type { ReactNode } from 'react';
import { CheckIcon } from '@/components/Icons';
import { Pastille } from '@/components/Pastille';
import type { MemberListItem } from '@/lib/bureau/types';
import { formatDate, todayInDakar } from '@/lib/dates';

/**
 * Vrai si le membre est à jour pour l'année en cours ET doit des arriérés —
 * possible sous la politique « toutes les années » (§12.1). Alors « À jour »
 * ne s'affiche JAMAIS seul : il serait posé à côté d'un montant dû.
 *
 * Le montant brut ne sert qu'à la comparaison (R1) ; on affiche son
 * `*_formatted`. `null` = inconnu : ce n'est pas un arriéré qu'on sait dire.
 */
export function upToDateWithArrears(member: MemberListItem): boolean {
  return (
    member.status === 'active' &&
    member.is_up_to_date &&
    member.balance_due !== null &&
    member.balance_due > 0
  );
}

/** La pastille de situation d'un membre, selon son statut puis sa cotisation. */
export function StandingPastille({ member }: { member: MemberListItem }) {
  if (member.status === 'pending') return <Pastille tone="info">Candidature</Pastille>;
  if (member.status === 'former') return <Pastille tone="due">Ancien membre</Pastille>;
  if (upToDateWithArrears(member)) return <Pastille tone="due">Arriérés à régler</Pastille>;
  if (member.is_up_to_date) {
    return (
      <Pastille tone="paid" icon={<CheckIcon />}>
        À jour
      </Pastille>
    );
  }
  return <Pastille tone="late">Pas à jour</Pastille>;
}

/** « À jour pour l'année en cours — arriérés : 500 000 FCFA ». */
export function ArrearsLine({ member }: { member: MemberListItem }) {
  return (
    <>
      À jour pour l’année en cours — arriérés :{' '}
      <span className="money">{member.balance_due_formatted ?? '—'}</span>
    </>
  );
}

/**
 * « Couvert jusqu'au … » pour un membre à jour, « Reste à payer … » sinon.
 *
 * ⚠️ `balance_due_formatted: null` veut dire INCONNU, jamais « rien à payer »
 * (piège 4) : on affiche « — », jamais « 0 FCFA ».
 */
export function standingDetail(member: MemberListItem): ReactNode {
  if (member.status === 'pending') return 'Candidature en attente';
  if (upToDateWithArrears(member)) return <ArrearsLine member={member} />;
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

/**
 * L'échéance d'une fiche (§12.7). `next_due_date` est l'échéance RÉCLAMÉE, celle
 * que nomment la relance et la file WhatsApp : on ne la calcule jamais, on la
 * lit, on la compare à aujourd'hui (à Dakar), et on choisit le libellé.
 *
 * Un ANCIEN membre n'a pas d'échéance : son `next_due_date` est le début de la
 * période qui le couvrait encore, alors qu'il ne doit rien et que son lien est
 * clos (décor f31, §8.3). On n'affiche rien pour lui.
 */
export function dueDateLine(
  member: MemberListItem,
  today: string = todayInDakar(),
): { late: boolean; label: string; value: string } | null {
  if (member.status === 'former') return null;
  const date = formatDate(member.next_due_date);
  if (!date || !member.next_due_date) return null;
  const late =
    member.status === 'active' && !member.is_up_to_date && member.next_due_date < today;
  return late
    ? { late, label: 'Échéance', value: `En retard depuis le ${date}` }
    : { late, label: 'Prochaine échéance', value: date };
}
