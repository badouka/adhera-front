import type { ReactNode } from 'react';
import { CheckIcon } from '@/components/Icons';
import { Pastille } from '@/components/Pastille';
import { standingOf, type MemberListItem } from '@/lib/bureau/types';
import { formatDate, formatDateTime } from '@/lib/dates';

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
  if (member.status === 'pending') return <Pastille tone="info">Demande d’adhésion</Pastille>;
  if (member.status === 'former') return <Pastille tone="due">Ancien membre</Pastille>;
  if (upToDateWithArrears(member)) return <Pastille tone="due">Arriérés à payer</Pastille>;
  const standing = standingOf(member);
  if (standing === 'up_to_date') {
    return (
      <Pastille tone="paid" icon={<CheckIcon />}>
        À jour
      </Pastille>
    );
  }
  // §23.3 (S9) — le jour de l'échéance, on est « à payer » ; « en retard » le lendemain.
  if (standing === 'to_pay') return <Pastille tone="due">À payer</Pastille>;
  return <Pastille tone="late">En retard</Pastille>;
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
 * « À jour jusqu'au … » pour un membre à jour, « Reste à payer … » sinon.
 * Un ancien membre : sa couverture seulement, jamais de reste à payer.
 *
 * ⚠️ `balance_due_formatted: null` veut dire INCONNU, jamais « rien à payer »
 * (piège 4) : on affiche « — », jamais « 0 FCFA ».
 */
export function standingDetail(member: MemberListItem): ReactNode {
  if (member.status === 'pending') {
    // §22.8 (S8) — la ligne d'un candidat porte la date de sa demande.
    const asked = formatDateTime(member.submitted_at ?? null);
    return asked ? `Demande du ${asked}` : 'Demande en attente';
  }
  // Rien n'est réclamé à un ancien membre : jamais « Reste à payer ».
  if (member.status === 'former') {
    const until = formatDate(member.covered_until);
    return until ? `À jour jusqu’au ${until}` : '—';
  }
  if (upToDateWithArrears(member)) return <ArrearsLine member={member} />;
  if (member.is_up_to_date) {
    const until = formatDate(member.covered_until);
    return until ? `À jour jusqu’au ${until}` : 'À jour';
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
 * lit, et le retard est celui que le serveur dit (`standing`, §23.3).
 *
 * Un ANCIEN membre n'a pas d'échéance : son `next_due_date` est le début de la
 * période qui le couvrait encore, alors qu'il ne doit rien et que son lien est
 * clos (décor f31, §8.3). On n'affiche rien pour lui.
 */
export function dueDateLine(member: MemberListItem): { late: boolean; label: string; value: string } | null {
  if (member.status === 'former') return null;
  const date = formatDate(member.next_due_date);
  // §23.5 — un exonéré n'a pas d'échéance : `null`, et rien ne s'affiche.
  if (!date || !member.next_due_date) return null;
  // §23.3 — le retard est ce que le SERVEUR dit (`standing`), plus un calcul ici.
  const late = member.status === 'active' && standingOf(member) === 'late';
  return late
    ? { late, label: 'Échéance', value: `En retard depuis le ${date}` }
    : { late, label: 'Prochaine échéance', value: date };
}
