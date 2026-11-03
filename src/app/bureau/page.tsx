'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RECORD_PATH, VERIFY_PATH } from '@/components/bureau/BureauFrame';
import { useBureau } from '@/components/bureau/BureauContext';
import { isModeUnsupported } from '@/components/bureau/format';
import { bigButtonClass, Button, Label, Notice, Skeleton } from '@/components/bureau/ui';
import { getDashboard, isSessionError } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import type { DashboardSimple } from '@/lib/bureau/types';
import { plural } from '@/lib/bureau/words';

/** Les listes que l'accueil ouvre : le registre, déjà filtré (§18.3). */
export const MEMBERS_LATE = '/bureau/membres?filtre=retard';
export const MEMBERS_RENEWING = '/bureau/membres?filtre=renouveler';
export const PAYMENTS_LOG = '/bureau/paiements';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; simple: DashboardSimple };

/** « 7 membres sur 15 sont à jour », « 1 membre sur 15 est à jour ». */
export function headline(simple: DashboardSimple): string {
  const up = simple.up_to_date_count;
  return `${up} ${up > 1 ? 'membres' : 'membre'} sur ${simple.active_count} ${
    up > 1 ? 'sont' : 'est'
  } à jour`;
}

/**
 * F5 — l'accueil : une phrase en tête plutôt qu'un tableau de chiffres.
 *
 * TOUT vient du bloc `simple` du tableau de bord (§18.3) : l'écran ne calcule,
 * n'additionne et ne reformate rien (R1), et l'année est `simple.year` — jamais
 * celle du téléphone. Les chiffres détaillés, le graphique et les fichiers
 * Excel sont dans « Plus ».
 */
export default function AccueilPage() {
  const { markModeUnsupported } = useBureau();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const data = await getDashboard({}, controller.signal);
        if (!data.simple) {
          setLoad({ kind: 'error', message: 'L’accueil n’a pas pu être chargé.' });
          return;
        }
        setLoad({ kind: 'ready', simple: data.simple });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isSessionError(error)) return;
        if (isModeUnsupported(error)) markModeUnsupported();
        setLoad({
          kind: 'error',
          message: errorMessage(error, 'L’accueil n’a pas pu être chargé.'),
        });
      }
    })();
    return () => controller.abort();
  }, [attempt, markModeUnsupported]);

  if (load.kind === 'loading') return <Skeleton label="Chargement de l’accueil…" />;

  if (load.kind === 'error') {
    return (
      <>
        <Notice tone="late">
          <span>{load.message}</span>
          <span>
            <Button onClick={() => setAttempt((n) => n + 1)}>Réessayer</Button>
          </span>
        </Notice>
        <Link href={RECORD_PATH} className={bigButtonClass('outline-indigo')}>
          Un membre a payé : l’enregistrer
        </Link>
      </>
    );
  }

  const { simple } = load;
  const n = simple.to_verify_count;
  const late = simple.late_count;
  const soon = simple.renewing_soon_count;

  return (
    <>
      <h1 className="title m-0" data-testid="headline">
        {headline(simple)}
      </h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile href={PAYMENTS_LOG} testId="tile-received">
          <Label>Reçu en {simple.year}</Label>
          <span className="money tnum text-[clamp(17px,5.3vw,22px)] leading-7 font-bold text-paid lg:text-[28px] lg:leading-[34px]">
            {simple.received_this_year_formatted}
          </span>
          <span className="small text-ink-muted">tous les paiements depuis le 1er janvier</span>
        </Tile>
        <Tile href={MEMBERS_LATE} testId="tile-remaining">
          <Label>Reste à recevoir</Label>
          <span className="money tnum text-[clamp(17px,5.3vw,22px)] leading-7 font-bold text-due lg:text-[28px] lg:leading-[34px]">
            {simple.remaining_formatted}
          </span>
          <span className="small text-ink-muted">
            {late > 1
              ? `ce que doivent encore les ${late} membres en retard`
              : late === 1
                ? 'ce que doit encore le membre en retard'
                : 'aucun membre en retard'}
          </span>
        </Tile>
        {/* Sur ordinateur seulement : le téléphone a le bloc juste en dessous. */}
        <Tile href={VERIFY_PATH} testId="tile-verify" verify>
          <Label className="text-indigo">À vérifier</Label>
          <span className="tnum text-[22px] leading-7 font-bold text-indigo lg:text-[28px] lg:leading-[34px]">
            {plural(n, 'paiement', 'paiements')}
          </span>
          <span className="small">
            {n > 0 ? (
              <>
                annoncés par des membres,{' '}
                <span className="money">{simple.to_verify_total_formatted}</span>
              </>
            ) : (
              'rien à vérifier'
            )}
          </span>
        </Tile>
      </div>

      {n > 0 ? (
        <section className="flex flex-col gap-3 rounded-[var(--radius-md)] bg-indigo-soft p-4" data-testid="to-verify">
          <div>
            <h2 className="heading m-0">
              {n > 1 ? `${n} membres disent avoir payé` : '1 membre dit avoir payé'}
            </h2>
            <p className="m-0">
              Vérifiez sur votre téléphone (Wave, Orange Money) que l’argent est bien
              arrivé.
            </p>
          </div>
          <Link href={VERIFY_PATH} className={bigButtonClass('primary')}>
            {n > 1 ? `Vérifier ces ${n} paiements` : 'Vérifier ce paiement'}
          </Link>
        </section>
      ) : (
        <section className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4" data-testid="nothing-to-verify">
          <h2 className="heading m-0">Rien à vérifier</h2>
          <p className="m-0 text-ink-muted">Aucun membre n’attend votre confirmation.</p>
        </section>
      )}

      <div className="flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-raised">
        <RowLink href={MEMBERS_LATE} testId="row-late">
          {late === 0 ? 'Aucun membre en retard' : plural(late, 'membre en retard', 'membres en retard')}
        </RowLink>
        {soon > 0 ? (
          <RowLink href={MEMBERS_RENEWING} testId="row-renewing">
            {soon > 1
              ? `${soon} membres doivent renouveler d’ici ${simple.renewing_soon_days} jours`
              : `1 membre doit renouveler d’ici ${simple.renewing_soon_days} jours`}
          </RowLink>
        ) : null}
      </div>

      <Link href={RECORD_PATH} className={bigButtonClass('outline-indigo')}>
        Un membre a payé : l’enregistrer
      </Link>
    </>
  );
}

function Tile({
  href,
  testId,
  verify = false,
  children,
}: {
  href: string;
  testId: string;
  verify?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={`flex min-w-0 flex-col gap-[6px] rounded-[var(--radius-md)] border p-[14px] text-ink! no-underline ${
        verify
          ? 'hidden border-indigo-soft bg-indigo-soft lg:flex'
          : 'border-line bg-surface-raised'
      }`}
    >
      {children}
    </Link>
  );
}

function RowLink({
  href,
  testId,
  children,
}: {
  href: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-4 py-2 text-ink! no-underline last:border-b-0"
    >
      <span>{children}</span>
      <span className="font-semibold whitespace-nowrap text-indigo">Voir qui</span>
    </Link>
  );
}
