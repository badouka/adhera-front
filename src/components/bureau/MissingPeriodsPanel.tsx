import { Pastille } from '@/components/Pastille';
import type { MissingPeriod } from '@/lib/bureau/types';
import { formatDate } from '@/lib/dates';
import { Panel } from './ui';

/**
 * « Années sans période enregistrée » (F4 § 3.4, contrat §12.8).
 *
 * Sous `all`, le reste à payer compte ces années : sans elles à l'écran, une
 * trésorière lit 100 000 FCFA au-dessus de deux cartes de 25 000 et conclut à
 * une erreur. Elles sont donc MONTRÉES, de la plus ancienne à la plus récente
 * — l'ordre du serveur, jamais retrié.
 *
 * Aucune action : ni reçu, ni bouton. Elles passeront dans les cotisations le
 * jour où le membre commencera à les régler.
 */
export default function MissingPeriodsPanel({ periods }: { periods: MissingPeriod[] }) {
  if (periods.length === 0) return null;

  return (
    <Panel title="Années sans période enregistrée">
      <p className="small m-0 text-ink-muted">
        Ces années n’ont pas encore de période : elles apparaîtront dans les
        cotisations quand le membre commencera à les régler.
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="missing-periods">
        {periods.map((period) => {
          const label =
            period.period_label?.trim() ||
            [formatDate(period.period_start), formatDate(period.period_end)]
              .filter(Boolean)
              .join(' → ');
          return (
            <li
              key={`${period.period_start}-${period.period_end}`}
              data-unclaimed={period.is_unclaimed_arrears ? 'true' : undefined}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-line p-3 ${
                period.is_unclaimed_arrears ? 'border-dashed bg-surface text-ink-muted' : ''
              }`}
            >
              <span className="font-semibold">{label || '—'}</span>
              <span className="flex flex-wrap items-center gap-3">
                {/* R1 : le champ formaté, ou un tiret si le tarif est incalculable. */}
                <span className="money tnum font-semibold">{period.amount_due_formatted ?? '—'}</span>
                {period.is_unclaimed_arrears ? (
                  <Pastille tone="muted">Non réclamée</Pastille>
                ) : (
                  <Pastille tone="late">À régler</Pastille>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
