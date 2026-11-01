'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useBureau } from '@/components/bureau/BureauContext';
import { EvolutionChart } from '@/components/bureau/EvolutionChart';
import { ExportButtons } from '@/components/bureau/Exports';
import { isModeUnsupported, periodLabel } from '@/components/bureau/format';
import { CashIcon, InboxIcon, SendIcon } from '@/components/bureau/Icons';
import {
  Button,
  buttonClass,
  inputClass,
  Notice,
  PageTitle,
  Panel,
  Skeleton,
} from '@/components/bureau/ui';
import { getDashboard, isSessionError, type PeriodQuery } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import type { Dashboard } from '@/lib/bureau/types';
import { firstOfMonthBefore, todayInDakar } from '@/lib/dates';

type PeriodKind = 'year' | 'rolling' | 'custom';

const PERIODS: ReadonlyArray<{ value: PeriodKind; label: string }> = [
  { value: 'year', label: 'Cette année' },
  { value: 'rolling', label: '12 derniers mois' },
  { value: 'custom', label: 'Choisir les dates' },
];

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: Dashboard };

/** « 1 paiement », « 2 paiements » ; 0 reste au singulier en français. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** Un taux `null` n'est PAS 0 : il n'y a aucun membre actif (piège 26). */
export function rateLabel(rate: number | null): string {
  return rate === null ? '—' : `${rate} %`;
}

/**
 * L'accueil du bureau — le tableau de bord. Il répond à trois questions, dans
 * cet ordre : qui est à jour, combien est entré, combien reste à entrer.
 *
 * Une seule autorité de calcul (`GET dashboard`, §10) : l'écran n'additionne,
 * ne recalcule et ne reformate rien (R1). En particulier, le « signalé » n'est
 * JAMAIS ajouté à l'« encaissé » (piège 25).
 */
export default function TableauDeBordPage() {
  const { markModeUnsupported } = useBureau();
  const today = todayInDakar();
  const [kind, setKind] = useState<PeriodKind>('year');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // « Cette année » : aucune borne, le serveur prend du 1er janvier à aujourd'hui
  // dans le fuseau de l'association. « 12 derniers mois » : les mêmes mois que
  // le graphique, pour que ses barres retombent sur l'encaissé.
  const query = useMemo<PeriodQuery>(() => {
    if (kind === 'rolling') return { from: firstOfMonthBefore(today, 11), to: today };
    if (kind === 'custom' && applied) return applied;
    return {};
  }, [kind, applied, today]);

  useEffect(() => {
    if (kind === 'custom' && !applied) return;
    const controller = new AbortController();
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    void (async () => {
      try {
        setLoad({ kind: 'ready', data: await getDashboard(query, controller.signal) });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isSessionError(error)) return;
        if (isModeUnsupported(error)) markModeUnsupported();
        setLoad({
          kind: 'error',
          message: errorMessage(error, 'Le tableau de bord n’a pas pu être chargé.'),
        });
      }
    })();
    return () => controller.abort();
  }, [query, kind, applied, attempt, markModeUnsupported]);

  function applyCustom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!custom.from || !custom.to) {
      setCustomError('Indiquez les deux dates.');
      return;
    }
    if (custom.from > custom.to) {
      setCustomError('La première date doit précéder la seconde.');
      return;
    }
    setCustomError(null);
    setApplied({ ...custom });
  }

  const data = load.kind === 'ready' ? load.data : null;
  const shown = data ? periodLabel(data.period.from, data.period.to) : '';

  return (
    <>
      <ActionBar
        toValidate={data ? data.money.declared_pending_count : null}
        toSend={data ? data.outreach.total : null}
      />

      <PageTitle
        title="Tableau de bord"
        subtitle={shown ? `Période ${shown}` : undefined}
      />

      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Période" className="flex flex-wrap gap-2">
          {PERIODS.map((option) => {
            const selected = option.value === kind;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setKind(option.value)}
                className={`min-h-11 rounded-[var(--radius-pill)] border-2 px-4 font-semibold ${
                  selected
                    ? 'border-indigo bg-indigo text-on-indigo'
                    : 'border-line-strong bg-surface-raised text-ink'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {kind === 'custom' ? (
          <form
            onSubmit={applyCustom}
            noValidate
            className="m-0 flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Du</span>
              <input
                type="date"
                value={custom.from}
                max={today}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                className={inputClass(!!customError, 'w-auto')}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Au</span>
              <input
                type="date"
                value={custom.to}
                max={today}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                className={inputClass(!!customError, 'w-auto')}
              />
            </label>
            <Button type="submit" tone="primary">
              Afficher
            </Button>
            {customError ? (
              <span role="alert" className="small basis-full font-semibold text-late">
                {customError}
              </span>
            ) : null}
          </form>
        ) : null}
      </div>

      {load.kind === 'loading' && !(kind === 'custom' && !applied) ? (
        <Skeleton label="Chargement du tableau de bord…" />
      ) : null}

      {load.kind === 'error' ? (
        <Notice tone="late">
          <span>{load.message}</span>
          <span>
            <Button onClick={() => setAttempt((n) => n + 1)}>Réessayer</Button>
          </span>
        </Notice>
      ) : null}

      {data ? <Figures data={data} /> : null}

      <Panel title="Exports">
        <p className="m-0 text-ink-muted">
          Des fichiers Excel, aux mêmes chiffres que ce tableau de bord.
        </p>
        <ExportButtons query={query} period={data?.period ?? null} />
      </Panel>
    </>
  );
}

/**
 * Les trois gestes, chacun avec son compteur. Un compteur à zéro reste
 * visible, grisé : « rien à faire » est une information.
 */
function ActionBar({ toValidate, toSend }: { toValidate: number | null; toSend: number | null }) {
  return (
    <nav aria-label="Actions" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <Link
        href="/bureau/encaisser"
        className={buttonClass('primary', 'min-h-14 text-[18px] no-underline')}
      >
        <CashIcon />
        Encaisser
      </Link>
      <CountLink href="/bureau/a-valider" label="À valider" count={toValidate} icon={<InboxIcon />} />
      <CountLink href="/bureau/a-envoyer" label="À envoyer" count={toSend} icon={<SendIcon />} />
    </nav>
  );
}

function CountLink({
  href,
  label,
  count,
  icon,
}: {
  href: string;
  label: string;
  count: number | null;
  icon: ReactNode;
}) {
  const idle = count === 0;
  return (
    <Link
      href={href}
      data-idle={idle ? 'true' : undefined}
      className={buttonClass(
        'secondary',
        `min-h-14 text-[18px] no-underline ${idle ? 'border-line bg-surface text-ink-muted!' : ''}`,
      )}
    >
      {icon}
      {count === null ? label : `${label} (${count})`}
    </Link>
  );
}

function BigFigure({ children }: { children: ReactNode }) {
  return <span className="tnum text-[32px] leading-10 font-bold">{children}</span>;
}

function Figures({ data }: { data: Dashboard }) {
  const { members, money, upcoming } = data;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 1. Qui est à jour. */}
        <Panel title="Membres">
          <div className="flex flex-col">
            <BigFigure>
              <span data-testid="rate">{rateLabel(money.recovery_rate)}</span>
            </BigFigure>
            <span className="text-ink-muted">
              {money.recovery_rate === null
                ? 'Aucun membre actif pour le moment.'
                : 'des membres actifs sont à jour'}
            </span>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="Membres actifs" value={members.active} />
            <Count label="À jour" value={members.up_to_date} />
            <Count label="Pas à jour" value={members.not_up_to_date} />
            <Count label="Candidatures" value={members.pending} />
          </dl>
          <p className="m-0 font-semibold" data-testid="upcoming">
            {upcoming.count === 0
              ? `Aucune échéance dans les ${upcoming.days} prochains jours.`
              : `${plural(upcoming.count, 'échéance', 'échéances')} dans les ${upcoming.days} prochains jours.`}
          </p>
        </Panel>

        {/* 2. Combien est entré, combien reste à entrer. */}
        <Panel title="Argent">
          {/* Deux montants sur une ligne quand ils tiennent, l'un sous l'autre sinon :
              un montant ne se coupe jamais. */}
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div className="flex flex-col">
              <span className="text-ink-muted">Encaissé sur la période</span>
              <BigFigure>
                <span className="money" data-testid="collected">
                  {money.collected_formatted}
                </span>
              </BigFigure>
            </div>
            <div className="flex flex-col">
              <span className="text-ink-muted">Reste à encaisser</span>
              <BigFigure>
                <span className="money" data-testid="outstanding">
                  {money.outstanding_formatted}
                </span>
              </BigFigure>
            </div>
          </div>
          {money.outstanding_unknown_count > 0 ? (
            <p className="small m-0 rounded-[var(--radius-sm)] bg-due-soft p-3 font-semibold text-due" data-testid="unknown">
              Total partiel :{' '}
              {money.outstanding_unknown_count > 1
                ? `${money.outstanding_unknown_count} cotisations n’ont pas de montant fixé`
                : '1 cotisation n’a pas de montant fixé'}{' '}
              (catégorie sans montant fixe, ou reprise d’un ancien fichier). Elles
              ne sont pas comptées dans le reste à encaisser.
            </p>
          ) : null}
          {/* Signalé ≠ encaissé : une ligne à part, jamais additionnée. */}
          <div
            className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-line bg-indigo-soft p-3"
            data-testid="declared"
          >
            <span className="font-semibold text-indigo">
              Signalé par les membres, en attente de validation
            </span>
            {money.declared_pending_count > 0 ? (
              <>
                <span>
                  <span className="money font-bold">{money.declared_pending_formatted}</span>
                  {' — '}
                  {plural(money.declared_pending_count, 'paiement', 'paiements')}
                </span>
                <span className="small text-ink-muted">
                  Pas encore compté dans l’encaissé.{' '}
                  <Link href="/bureau/a-valider" className="font-semibold">
                    Les valider
                  </Link>
                </span>
              </>
            ) : (
              <span className="text-ink-muted">Aucun paiement en attente.</span>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Encaissé des 12 derniers mois">
        <EvolutionChart months={data.evolution} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Par catégorie">
          {/* Deux colonnes seulement : à 360 px, quatre ne tiennent pas avec un
              montant qui ne se coupe pas. Les effectifs passent sous le libellé. */}
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="small text-ink-muted">
                <th scope="col" className="py-1 font-semibold">Catégorie</th>
                <th scope="col" className="py-1 text-right font-semibold">Encaissé</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {data.by_category.map((row) => (
                <tr key={row.category_id ?? 'none'} className="border-t border-line">
                  <th scope="row" className="py-2 pr-2 text-left align-top font-normal">
                    <span className="block font-semibold break-words">{row.label}</span>
                    <span className="small block text-ink-muted">
                      {plural(row.members, 'membre', 'membres')}, {row.up_to_date} à jour
                    </span>
                  </th>
                  <td className="money py-2 text-right align-top">{row.collected_formatted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Par moyen de paiement">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="small text-ink-muted">
                <th scope="col" className="py-1 font-semibold">Moyen</th>
                <th scope="col" className="py-1 text-right font-semibold">Encaissé</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {data.by_method.map((row) => (
                <tr key={row.method} className="border-t border-line">
                  <th scope="row" className="py-2 pr-2 font-semibold">{row.label}</th>
                  <td className="money py-2 text-right">{row.collected_formatted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <dt className="small text-ink-muted">{label}</dt>
      <dd className="tnum m-0 text-[22px] leading-7 font-bold">{value}</dd>
    </div>
  );
}
