import type { MemberDetail, MemberDue } from './types';

/**
 * La période qu'un paiement saisi par le bureau créditera, telle que la fiche
 * la montre.
 *
 * ⚠️ C'est le serveur qui choisit (`payableDue()`, piège 8) : aucun paramètre
 * de période n'existe. On prend la plus ancienne période encore ouverte, qui
 * est celle que le membre doit d'abord ; la réponse dira laquelle a été
 * réellement créditée.
 *
 * Un arriéré NON RÉCLAMÉ (§12.3) n'est jamais la cible : le serveur ne le
 * crédite pas, et le montrer ferait payer l'année que l'association a choisi
 * de ne pas réclamer.
 */
export function openDue(member: MemberDetail): MemberDue | null {
  const open = member.dues.filter(
    (d) => (d.status === 'due' || d.status === 'partielle') && !d.is_unclaimed_arrears,
  );
  if (open.length === 0) return null;
  return [...open].sort((a, b) => a.period_start.localeCompare(b.period_start))[0] ?? null;
}
