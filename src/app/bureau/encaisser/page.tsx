'use client';

import { useEffect, useRef, useState } from 'react';
import { useBureau } from '@/components/bureau/BureauContext';
import { DirectPaymentPanel } from '@/components/bureau/DirectPaymentPanel';
import { ReceiptButton } from '@/components/bureau/Documents';
import { isModeUnsupported } from '@/components/bureau/format';
import { SearchIcon } from '@/components/bureau/Icons';
import {
  Button,
  EmptyState,
  inputClass,
  Notice,
  PageTitle,
  Skeleton,
} from '@/components/bureau/ui';
import { ApiError } from '@/lib/api';
import { getMember, isSessionError, listMembers } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import type { MemberDetail, MemberListItem, Payment } from '@/lib/bureau/types';

/** La frappe s'envoie au serveur après 300 ms de silence. */
const SEARCH_DEBOUNCE_MS = 300;

type Results =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; members: MemberListItem[] };

type Selected =
  | { kind: 'loading'; id: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; member: MemberDetail };

/**
 * « Encaisser » — le geste le plus fréquent du bureau : quelqu'un a payé en
 * espèces, ou par Wave sans rien signaler.
 *
 * Chercher, toucher le membre, « Encaisser {montant} » : le reçu est émis.
 */
export default function EncaisserPage() {
  const { modeSupported, markModeUnsupported } = useBureau();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Results>({ kind: 'idle' });
  const [selected, setSelected] = useState<Selected | null>(null);
  const [done, setDone] = useState<Payment | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (search === '') {
      setResults({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    setResults({ kind: 'loading' });
    void (async () => {
      try {
        // Les candidats sont HORS du registre par défaut (§5) : un second
        // appel les ajoute, à la suite des membres actifs. L'ordre de chaque
        // liste est celui du serveur, jamais retrié ici.
        const [active, pending] = await Promise.all([
          listMembers({ status: 'active', search }, controller.signal),
          listMembers({ status: 'pending', search }, controller.signal),
        ]);
        setResults({ kind: 'ready', members: [...active, ...pending] });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isSessionError(error)) return;
        setResults({
          kind: 'error',
          message: errorMessage(error, 'La recherche n’a pas abouti.'),
        });
      }
    })();
    return () => controller.abort();
  }, [search]);

  async function choose(member: MemberListItem) {
    setSelected({ kind: 'loading', id: member.id });
    try {
      setSelected({ kind: 'ready', member: await getMember(member.id) });
    } catch (error) {
      if (isSessionError(error)) return;
      if (isModeUnsupported(error)) markModeUnsupported();
      setSelected({
        kind: 'error',
        // Le 404 nomme une classe PHP (piège 11) : on ne le recopie jamais.
        message:
          error instanceof ApiError && error.status === 404
            ? 'Membre introuvable.'
            : errorMessage(error, 'La fiche du membre n’a pas pu être chargée.'),
      });
    }
  }

  function again() {
    setDone(null);
    setSelected(null);
    setQuery('');
    setSearch('');
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  if (!modeSupported) {
    return (
      <>
        <PageTitle title="Encaisser" />
        <Notice tone="due">
          L’encaissement sera disponible quand le mode de cotisation de votre
          association sera pris en charge.
        </Notice>
      </>
    );
  }

  if (done) {
    return (
      <>
        <PageTitle title="Encaisser" />
        <Notice tone="paid">
          <span className="title">
            {done.receipt ? `Reçu ${done.receipt.reference} émis` : 'Paiement encaissé'}
          </span>
          <span className="font-normal">
            {done.member_name} — <span className="money">{done.amount_formatted}</span> —{' '}
            {done.method_label}
          </span>
          <span className="flex flex-col gap-2 sm:flex-row">
            {done.receipt ? (
              <ReceiptButton
                receiptId={done.receipt.id}
                reference={done.receipt.reference}
                tone="primary"
              />
            ) : null}
            <Button onClick={again}>Encaisser un autre paiement</Button>
          </span>
        </Notice>
      </>
    );
  }

  if (selected) {
    return (
      <>
        <PageTitle title="Encaisser" />
        {selected.kind === 'loading' ? <Skeleton label="Chargement de la fiche…" /> : null}
        {selected.kind === 'error' ? (
          <Notice tone="late">
            <span>{selected.message}</span>
            <span>
              <Button onClick={() => setSelected(null)}>Revenir à la recherche</Button>
            </span>
          </Notice>
        ) : null}
        {selected.kind === 'ready' ? (
          <div className="max-w-[640px]">
            <DirectPaymentPanel
              member={selected.member}
              closeLabel="Changer de membre"
              onClose={() => setSelected(null)}
              onModeUnsupported={markModeUnsupported}
              onDone={setDone}
            />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <PageTitle
        title="Encaisser"
        subtitle="Un paiement reçu en main propre, ou par Wave sans signalement du membre."
      />

      <label className="flex max-w-[640px] min-w-0 flex-col gap-1">
        <span className="font-semibold">Nom, prénom ou téléphone</span>
        <span className="relative flex items-center">
          <SearchIcon className="pointer-events-none absolute left-3 text-ink-muted" />
          <input
            ref={searchRef}
            type="search"
            // Arriver ici, c'est vouloir chercher : le champ attend la frappe.
            autoFocus
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={inputClass(false, 'min-h-13 pl-9 text-[18px]')}
          />
        </span>
      </label>

      {results.kind === 'loading' ? <Skeleton label="Recherche…" /> : null}

      {results.kind === 'error' ? <Notice tone="late">{results.message}</Notice> : null}

      {results.kind === 'ready' && results.members.length === 0 ? (
        <EmptyState>Aucun membre ne correspond à « {search} ».</EmptyState>
      ) : null}

      {results.kind === 'ready' && results.members.length > 0 ? (
        <ul className="m-0 flex max-w-[640px] list-none flex-col gap-2 p-0">
          {results.members.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                onClick={() => void choose(member)}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-line bg-surface-raised px-4 py-3 text-left text-ink"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold break-words">{member.name}</span>
                  <span className="small text-ink-muted">
                    {[
                      member.category_label ?? 'Sans catégorie',
                      member.status === 'pending' ? 'Candidature' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="small text-ink-muted">Reste dû</span>
                  {/* null = INCONNU, jamais « 0 FCFA » (piège 4). */}
                  <span className="money tnum font-bold">
                    {member.balance_due_formatted ?? '—'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
