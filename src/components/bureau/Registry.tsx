'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useBackBar, useBureau } from '@/components/bureau/BureauContext';
import { isModeUnsupported } from '@/components/bureau/format';
import { SearchIcon } from '@/components/bureau/Icons';
import { StandingPastille, standingDetail } from '@/components/bureau/Standing';
import {
  Button,
  EmptyState,
  inputClass,
  Notice,
  PageTitle,
  Skeleton,
} from '@/components/bureau/ui';
import { listCategories } from '@/lib/bureau/api/categories';
import { isSessionError } from '@/lib/bureau/api/core';
import { listMembers } from '@/lib/bureau/api/members';
import { errorMessage } from '@/lib/bureau/messages';
import type {
  Category,
  MemberFilters,
  MemberListItem,
  MemberStatus,
  MemberType,
} from '@/lib/bureau/types';
import { spacedPhone } from '@/lib/phone';

/** L'API n'a pas de pagination (piège 2) : on pagine ici. */
const PAGE_SIZE = 50;

/** La frappe s'envoie au serveur après 300 ms de silence. */
const SEARCH_DEBOUNCE_MS = 300;

const TITLES: Record<MemberStatus, string> = {
  active: 'Membres',
  pending: 'Demandes d’adhésion',
  former: 'Anciens membres',
  rejected: 'Demandes refusées',
};

const SUBTITLES: Record<MemberStatus, string | undefined> = {
  active: undefined,
  pending: 'Ils ne sont pas encore membres : leur premier paiement les admet.',
  former: 'Leur historique est conservé.',
  rejected: 'Elles gardent leur lien et le motif du refus.',
};

const EMPTY: Record<MemberStatus, string> = {
  active: 'Aucun membre ne correspond.',
  pending: 'Aucune demande d’adhésion en attente.',
  former: 'Aucun ancien membre.',
  rejected: 'Aucune demande refusée.',
};

type Standing = NonNullable<MemberFilters['standing']>;

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; members: MemberListItem[] };

/**
 * B5 — le registre complet, avec tous ses filtres. F5 : il sert les écrans
 * rangés dans « Plus » — les demandes d'adhésion (`pending`, HORS du registre
 * par défaut côté serveur) et les anciens membres. La liste du quotidien est
 * « Membres » (`/bureau/membres`).
 */
export function Registry({
  status,
  back = { href: '/bureau/plus', label: 'Plus' },
}: {
  status: MemberStatus;
  /** « Retour » : vers « Plus » par défaut ; vers les demandes pour les candidats (F6). */
  back?: { href: string; label: string };
}) {
  const { settings, markModeUnsupported } = useBureau();
  useBackBar(back);
  const [standing, setStanding] = useState<Standing>('');
  const [type, setType] = useState<MemberType | ''>('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);

  const showType = settings.member_types === 'mixte';

  useEffect(() => {
    const controller = new AbortController();
    listCategories(controller.signal)
      .then(setCategories)
      .catch(() => {
        // Le filtre par catégorie disparaît simplement : le registre reste lisible.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    setPage(0);
    void (async () => {
      try {
        const members = await listMembers(
          {
            status,
            standing: status === 'active' ? standing : '',
            type: showType ? type : '',
            category_id: categoryId,
            search,
          },
          controller.signal,
        );
        setLoad({ kind: 'ready', members });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isSessionError(error)) return;
        if (isModeUnsupported(error)) markModeUnsupported();
        setLoad({
          kind: 'error',
          message: errorMessage(error, 'Le registre n’a pas pu être chargé.'),
        });
      }
    })();
    return () => controller.abort();
  }, [status, standing, type, categoryId, search, showType, attempt, markModeUnsupported]);

  const members = useMemo(() => (load.kind === 'ready' ? load.members : []), [load]);
  const pageCount = Math.max(1, Math.ceil(members.length / PAGE_SIZE));
  const visible = members.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const filtered = (status === 'active' && standing !== '') || type !== '' || categoryId !== '' || search !== '';

  return (
    <>
      <PageTitle title={TITLES[status]} subtitle={SUBTITLES[status]} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-1">
          <span className="small font-semibold">Rechercher</span>
          <span className="relative flex items-center">
            <SearchIcon className="pointer-events-none absolute left-3 text-ink-muted" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nom, téléphone ou e-mail"
              className={inputClass(false, 'pl-9')}
            />
          </span>
        </label>

        {status === 'active' ? (
          <label className="flex min-w-0 flex-col gap-1">
            <span className="small font-semibold">Situation</span>
            <select
              value={standing}
              onChange={(e) => setStanding(e.target.value as Standing)}
              className={inputClass(false)}
            >
              <option value="">Toutes</option>
              <option value="up_to_date">À jour</option>
              <option value="not_up_to_date">En retard</option>
            </select>
          </label>
        ) : null}

        {categories.length > 0 ? (
          <label className="flex min-w-0 flex-col gap-1">
            <span className="small font-semibold">Type de membre</span>
            <select
              value={categoryId === '' ? '' : String(categoryId)}
              onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
              className={inputClass(false)}
            >
              <option value="">Toutes</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.is_active ? '' : ' (désactivée)'}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {showType ? (
          <label className="flex min-w-0 flex-col gap-1">
            <span className="small font-semibold">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MemberType | '')}
              className={inputClass(false)}
            >
              <option value="">Tous</option>
              <option value="personne">Personnes</option>
              <option value="organisation">Organisations</option>
            </select>
          </label>
        ) : null}
      </div>

      {load.kind === 'loading' ? <Skeleton label="Chargement du registre…" /> : null}

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
          <p className="small m-0 text-ink-muted" role="status">
            {members.length === 0
              ? ''
              : members.length === 1
                ? '1 membre'
                : `${members.length} membres`}
            {filtered && members.length > 0 ? ' correspondant aux filtres' : ''}
          </p>

          {members.length === 0 ? (
            <EmptyState>{filtered ? 'Aucun membre ne correspond à ces filtres.' : EMPTY[status]}</EmptyState>
          ) : (
            <>
              <MemberCards members={visible} />
              <MemberTable members={visible} />
            </>
          )}

          {pageCount > 1 ? (
            <nav aria-label="Pages du registre" className="flex items-center justify-between gap-2">
              <Button onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
                Précédents
              </Button>
              <span className="small text-ink-muted">
                Page {page + 1} sur {pageCount}
              </span>
              <Button onClick={() => setPage((p) => p + 1)} disabled={page >= pageCount - 1}>
                Suivants
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function memberHref(member: MemberListItem): string {
  return `/bureau/membres/${encodeURIComponent(member.id)}`;
}

/** Mobile : une carte par membre. */
function MemberCards({ members }: { members: MemberListItem[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:hidden" data-testid="member-cards">
      {members.map((member) => (
        <li key={member.id}>
          <Link
            href={memberHref(member)}
            className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-line bg-surface-raised p-3 text-ink! no-underline"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold break-words text-indigo">{member.name}</span>
                <span className="small text-ink-muted">
                  {member.member_number ? (
                    <span className="tnum" data-testid="card-member-number">
                      N° {member.member_number} ·{' '}
                    </span>
                  ) : null}
                  {member.category_label ?? 'Sans type de membre'}
                </span>
              </span>
              <StandingPastille member={member} />
            </span>
            <span className="small tnum">{standingDetail(member)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Grand écran : un tableau. */
function MemberTable({ members }: { members: MemberListItem[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-[var(--radius-md)] border border-line bg-surface-raised lg:block">
      <table className="w-full border-collapse text-left" data-testid="member-table">
        <thead>
          <tr className="small border-b border-line text-ink-muted">
            <th className="px-4 py-3 font-semibold">N°</th>
            <th className="px-4 py-3 font-semibold">Nom</th>
            <th className="px-4 py-3 font-semibold">Type de membre</th>
            <th className="px-4 py-3 font-semibold">Situation</th>
            <th className="px-4 py-3 font-semibold">Cotisation</th>
            <th className="px-4 py-3 font-semibold">Téléphone</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="border-b border-line last:border-b-0">
              {/* Un candidat n'a pas de numéro : cellule vide, jamais « 0000 ». */}
              <td className="tnum px-4 py-3 whitespace-nowrap" data-testid="member-number">
                {member.member_number ?? ''}
              </td>
              <td className="px-4 py-3">
                <Link href={memberHref(member)} className="font-semibold break-words">
                  {member.name}
                </Link>
              </td>
              <td className="px-4 py-3">{member.category_label ?? '—'}</td>
              <td className="px-4 py-3">
                <StandingPastille member={member} />
              </td>
              <td className="tnum px-4 py-3">{standingDetail(member)}</td>
              <td className="tnum px-4 py-3">{member.phone ? spacedPhone(member.phone) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
