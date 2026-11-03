'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RECORD_PATH } from '@/components/bureau/BureauFrame';
import { useBureau } from '@/components/bureau/BureauContext';
import { isModeUnsupported } from '@/components/bureau/format';
import { ChatIcon, SearchIcon } from '@/components/bureau/Icons';
import { Button, inputClass, Label, LINK_BUTTON, Notice, Pill, Skeleton, Toast } from '@/components/bureau/ui';
import { isSessionError, listMembers } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import { remindByWhatsapp } from '@/lib/bureau/remind';
import type { MemberListItem } from '@/lib/bureau/types';
import { firstName } from '@/lib/bureau/words';
import { formatDate, todayInDakar } from '@/lib/dates';

/** La frappe s'envoie au serveur après 300 ms de silence. */
const SEARCH_DEBOUNCE_MS = 300;

export type Filter = 'tous' | 'retard' | 'a-jour' | 'renouveler';

const FILTERS: ReadonlyArray<Filter> = ['tous', 'retard', 'a-jour', 'renouveler'];

/** « En retard » d'abord, comme la maquette : c'est la liste qu'on cherche. */
export function readFilter(search: string): Filter {
  const value = new URLSearchParams(search).get('filtre');
  return FILTERS.includes(value as Filter) ? (value as Filter) : 'retard';
}

/** Un membre en retard : ce que le SERVEUR dit (`is_up_to_date`), rien d'autre. */
function isLate(member: MemberListItem): boolean {
  return !member.is_up_to_date;
}

const PRINT_TITLE: Record<Filter, string> = {
  tous: 'Tous les membres',
  retard: 'Les membres en retard',
  'a-jour': 'Les membres à jour',
  renouveler: 'Les membres qui doivent renouveler',
};

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; members: MemberListItem[]; renewing: MemberListItem[] | null };

/**
 * Écran 7 — « Les membres ». La recherche (nom ou téléphone), puis trois
 * filtres comptés — et « À renouveler » quand on arrive de l'accueil.
 *
 * La liste vient du serveur, dans SON ordre (jamais retriée ici) ; « En
 * retard » et « À jour » la partagent selon `is_up_to_date`, et « À
 * renouveler » est la liste du serveur (`standing=renewing_soon`, §18.3).
 * Sur ordinateur, le tableau porte les deux gestes de chaque ligne.
 */
export default function MembresPage() {
  const { settings, markModeUnsupported } = useBureau();
  const [filter, setFilter] = useState<Filter>('retard');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    setFilter(readFilter(window.location.search));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const wantsRenewing = filter === 'renouveler';

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [members, renewing] = await Promise.all([
          listMembers({ status: 'active', search }, controller.signal),
          wantsRenewing
            ? listMembers({ status: 'active', standing: 'renewing_soon', search }, controller.signal)
            : Promise.resolve(null),
        ]);
        setLoad({ kind: 'ready', members, renewing });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (isSessionError(cause)) return;
        if (isModeUnsupported(cause)) markModeUnsupported();
        setLoad({
          kind: 'error',
          message: errorMessage(cause, 'La liste des membres n’a pas pu être chargée.'),
        });
      }
    })();
    return () => controller.abort();
  }, [search, wantsRenewing, attempt, markModeUnsupported]);

  const all = useMemo(() => (load.kind === 'ready' ? load.members : []), [load]);
  const late = useMemo(() => all.filter(isLate), [all]);
  const ok = useMemo(() => all.filter((m) => !isLate(m)), [all]);
  const shown =
    filter === 'tous'
      ? all
      : filter === 'retard'
        ? late
        : filter === 'a-jour'
          ? ok
          : load.kind === 'ready'
            ? (load.renewing ?? [])
            : [];

  const choose = useCallback((next: Filter) => {
    setFilter(next);
    const url = new URL(window.location.href);
    url.searchParams.set('filtre', next);
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const clearToast = useCallback(() => setToast(null), []);

  async function remind(member: MemberListItem) {
    setBlocked(null);
    const outcome = await remindByWhatsapp(member.id);
    if (outcome.kind === 'no-phone') setToast(`${firstName(member)} n’a pas de téléphone.`);
    if (outcome.kind === 'error') setToast(outcome.message);
    if (outcome.kind === 'blocked') setBlocked(outcome.url);
  }

  const today = todayInDakar();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="title m-0">Les membres</h1>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={LINK_BUTTON} onClick={() => window.print()}>
            Imprimer cette liste
          </button>
          <Link href="/bureau/membres/nouveau" className={LINK_BUTTON}>
            Ajouter un membre
          </Link>
        </div>
      </div>

      <label className="print:hidden">
        <span className="sr-only">Chercher un membre</span>
        <span className="relative flex items-center">
          <SearchIcon className="pointer-events-none absolute left-3 text-ink-muted" />
          <input
            type="search"
            autoComplete="off"
            placeholder="Chercher : nom ou téléphone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={inputClass(false, 'min-h-12 pl-9 text-[16px]')}
          />
        </span>
      </label>

      <div role="group" aria-label="Afficher" className="flex flex-wrap gap-2 print:hidden">
        <Chip on={filter === 'tous'} onClick={() => choose('tous')}>
          Tous · {all.length}
        </Chip>
        <Chip on={filter === 'retard'} late onClick={() => choose('retard')}>
          En retard · {late.length}
        </Chip>
        <Chip on={filter === 'a-jour'} onClick={() => choose('a-jour')}>
          À jour · {ok.length}
        </Chip>
        {filter === 'renouveler' ? (
          <Chip on onClick={() => choose('renouveler')}>
            À renouveler
            {load.kind === 'ready' && load.renewing ? ` · ${load.renewing.length}` : ''}
          </Chip>
        ) : null}
      </div>

      {blocked ? (
        <Notice tone="info">
          <span>WhatsApp ne s’est pas ouvert tout seul.</span>
          <a href={blocked} target="_blank" rel="noopener noreferrer" className="font-semibold">
            Ouvrir WhatsApp avec le rappel
          </a>
        </Notice>
      ) : null}

      {load.kind === 'loading' ? <Skeleton label="Chargement des membres…" /> : null}

      {load.kind === 'error' ? (
        <Notice tone="late">
          <span>{load.message}</span>
          <span>
            <Button onClick={() => setAttempt((n) => n + 1)}>Réessayer</Button>
          </span>
        </Notice>
      ) : null}

      {load.kind === 'ready' ? (
        <>
          <MemberRows members={shown} />
          <MemberTable members={shown} today={today} onRemind={(m) => void remind(m)} />
          <PrintSheet
            members={shown}
            title={PRINT_TITLE[filter]}
            association={settings.issuer_name?.trim() ?? ''}
            today={today}
          />
        </>
      ) : null}

      <Toast message={toast} onDone={clearToast} />
    </>
  );
}

function Chip({
  on,
  late = false,
  onClick,
  children,
}: {
  on: boolean;
  late?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`h-10 rounded-[var(--radius-pill)] px-[14px] text-[14px] ${
        on
          ? late
            ? 'border-2 border-late bg-late-soft font-semibold text-late'
            : 'border-2 border-indigo bg-indigo-soft font-semibold text-indigo'
          : 'border border-line-strong bg-surface-raised text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function memberHref(member: MemberListItem): string {
  return `/bureau/membres/${encodeURIComponent(member.id)}`;
}

/** « Membre actif · n° 0007 ». Un candidat n'a pas de numéro : rien, jamais « 0000 ». */
function subline(member: MemberListItem): string {
  return [member.category_label, member.member_number ? `n° ${member.member_number}` : null]
    .filter(Boolean)
    .join(' · ');
}

/** Téléphone : une ligne par membre, le reste à payer à droite. */
function MemberRows({ members }: { members: MemberListItem[] }) {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-raised lg:hidden print:hidden"
      data-testid="member-rows"
    >
      {members.length === 0 ? (
        <p className="m-0 px-4 py-3 text-ink-muted">Aucun membre ne correspond.</p>
      ) : (
        members.map((member) => (
          <Link
            key={member.id}
            href={memberHref(member)}
            className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-4 py-2 text-ink! no-underline last:border-b-0"
          >
            <span className="min-w-0 flex-1">
              <b className="break-words">{member.name}</b>
              <br />
              <span className="small text-ink-muted">{subline(member)}</span>
            </span>
            <Situation member={member} />
          </Link>
        ))
      )}
    </div>
  );
}

function Situation({ member }: { member: MemberListItem }) {
  if (isLate(member)) {
    return (
      <span className="shrink-0 text-right">
        <Label>Reste à payer</Label>
        <br />
        {/* null = INCONNU, jamais « 0 FCFA » (piège 4). */}
        <b className="money tnum text-due">{member.balance_due_formatted ?? '—'}</b>
      </span>
    );
  }
  return <Pill tone="ok">À jour</Pill>;
}

/** Ordinateur : le tableau, et les deux gestes de chaque ligne. */
function MemberTable({
  members,
  today,
  onRemind,
}: {
  members: MemberListItem[];
  today: string;
  onRemind: (member: MemberListItem) => void;
}) {
  return (
    <div className="hidden overflow-x-auto rounded-[var(--radius-md)] border border-line bg-surface-raised lg:block print:hidden">
      <table className="w-full border-collapse text-left text-[15px]" data-testid="member-table">
        <thead>
          <tr className="small border-b border-line text-ink-muted">
            <th scope="col" className="px-3 py-3 font-semibold">N°</th>
            <th scope="col" className="px-3 py-3 font-semibold">Nom</th>
            <th scope="col" className="px-3 py-3 font-semibold">Téléphone</th>
            <th scope="col" className="px-3 py-3 font-semibold">Situation</th>
            <th scope="col" className="px-3 py-3 font-semibold">Aurait dû payer le</th>
            <th scope="col" className="px-3 py-3 text-right font-semibold">Reste à payer</th>
            <th scope="col" className="px-3 py-3 font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-3 text-ink-muted">
                Aucun membre ne correspond.
              </td>
            </tr>
          ) : (
            members.map((member) => {
              const late = isLate(member);
              const due =
                late && member.next_due_date && member.next_due_date <= today
                  ? formatDate(member.next_due_date)
                  : '';
              return (
                <tr key={member.id} className="border-b border-line last:border-b-0">
                  <td className="tnum px-3 py-3 whitespace-nowrap" data-testid="member-number">
                    {member.member_number ?? ''}
                  </td>
                  <td className="min-w-[150px] px-3 py-3">
                    <Link href={memberHref(member)} className="font-semibold break-words">
                      {member.name}
                    </Link>
                    <span className="small block text-ink-muted">{member.category_label ?? ''}</span>
                  </td>
                  <td className="tnum px-3 py-3 whitespace-nowrap">
                    {member.phone ?? <span className="text-ink-muted">pas de téléphone</span>}
                  </td>
                  <td className="px-3 py-3">
                    {late ? <Pill tone="late">En retard</Pill> : <Pill tone="ok">À jour</Pill>}
                  </td>
                  <td className="px-3 py-3">{due || '—'}</td>
                  <td className="money tnum px-3 py-3 text-right font-bold text-due">
                    {late ? (member.balance_due_formatted ?? '—') : ''}
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex flex-col items-stretch gap-[6px]">
                      <Link
                        href={`${RECORD_PATH}?membre=${encodeURIComponent(member.id)}`}
                        className="inline-flex min-h-9 items-center justify-center rounded-[var(--radius-md)] border-2 border-indigo px-2 text-[13px] font-semibold whitespace-nowrap text-indigo! no-underline"
                      >
                        {firstName(member)} a payé
                      </Link>
                      {late && member.phone ? (
                        <button
                          type="button"
                          onClick={() => onRemind(member)}
                          className="inline-flex min-h-9 items-center justify-center gap-1 rounded-[var(--radius-md)] border border-line-strong bg-surface-raised px-2 text-[13px] font-semibold whitespace-nowrap text-ink"
                        >
                          <ChatIcon size={16} />
                          Rappel WhatsApp
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A12 — « Imprimer cette liste » : une feuille A4 propre, le nom, le
 * téléphone et le reste à payer. Invisible à l'écran ; seule à l'impression.
 */
function PrintSheet({
  members,
  title,
  association,
  today,
}: {
  members: MemberListItem[];
  title: string;
  association: string;
  today: string;
}) {
  return (
    <section className="hidden text-[12pt] text-ink print:block" data-testid="print-sheet">
      <h1 className="m-0 text-[16pt] font-bold">{title}</h1>
      <p className="m-0 mb-3">
        {association ? `${association} — ` : ''}
        liste du {formatDate(today)}, {members.length > 1 ? `${members.length} membres` : `${members.length} membre`}
      </p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th scope="col" className="border-b-2 border-ink py-1 pr-2">Nom</th>
            <th scope="col" className="border-b-2 border-ink py-1 pr-2">Téléphone</th>
            <th scope="col" className="border-b-2 border-ink py-1 text-right">Reste à payer</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="break-inside-avoid">
              <td className="border-b border-line py-1 pr-2">{member.name}</td>
              <td className="tnum border-b border-line py-1 pr-2">{member.phone ?? '—'}</td>
              <td className="money tnum border-b border-line py-1 text-right">
                {isLate(member) ? (member.balance_due_formatted ?? '—') : 'À jour'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
