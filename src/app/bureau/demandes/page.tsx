'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AnswersList, MemberPhoto } from '@/components/bureau/Answers';
import { useBackBar, useBureau } from '@/components/bureau/BureauContext';
import { headerTitle, personName } from '@/components/bureau/BureauFrame';
import { ChatIcon } from '@/components/bureau/Icons';
import {
  bigButtonClass,
  Button,
  Label,
  LINK_BUTTON,
  Notice,
  Skeleton,
  Toast,
} from '@/components/bureau/ui';
import { CheckIcon } from '@/components/Icons';
import { ApiError, fieldMessages } from '@/lib/api';
import { listCategories } from '@/lib/bureau/api/categories';
import { isSessionError } from '@/lib/bureau/api/core';
import {
  admitApplication,
  getMember,
  listMembers,
  rejectApplication,
} from '@/lib/bureau/api/members';
import { errorMessage } from '@/lib/bureau/messages';
import { openPendingTab } from '@/lib/bureau/pendingTab';
import type { Category, DecidedMember, MemberDetail, MemberListItem } from '@/lib/bureau/types';
import { firstName } from '@/lib/bureau/words';
import { phoneDigits, spacedPhone } from '@/lib/phone';
import { whatsappLink } from '@/lib/whatsapp';

/** Le motif d'un refus : le candidat le lira. 10 caractères au moins (§17.6). */
export const MIN_REASON_LENGTH = 10;

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; pending: MemberListItem[]; rejected: MemberListItem[]; categories: Category[] };

type View =
  | { kind: 'card' }
  | { kind: 'refuse'; member: MemberListItem }
  | { kind: 'admitted'; member: DecidedMember };

/** « Membre actif · 25 000 FCFA par an » : le tarif vient des types de membres. */
export function categoryLine(member: MemberListItem, categories: Category[]): string {
  const category = categories.find((c) => c.id === member.category_id);
  const amount = category?.amount_formatted;
  return [member.category_label, amount ? `${amount} par an` : null].filter(Boolean).join(' · ');
}

/**
 * L'APERÇU du message de refus — composé ici pour l'aperçu seulement, sur le
 * modèle du `share` que le serveur rend (§17.6) : « Bonjour {prénom}, », le
 * motif mot pour mot, puis le lien de sa page. Ce qui part est le `share` de
 * la réponse, jamais cet aperçu.
 */
export function refusalPreview(member: MemberListItem, reason: string): string {
  return `Bonjour ${firstName(member)},\n${reason.trim() || '…'}\nVotre page : (le lien de sa page)`;
}

/**
 * « Demandes d'adhésion » (F6 § 4) — UNE demande à la fois, comme la
 * vérification des paiements. Les réponses aux questions sont sur la ligne
 * (`?status=pending` les sert, §20.6) : rien à aller chercher fiche par fiche.
 *
 * Sous « Toute personne qui paie sa première cotisation », personne n'attend
 * le bureau : l'écran le dit, et renvoie à la liste des candidats.
 */
export default function DemandesPage() {
  const { settings, me, session } = useBureau();
  const mode = settings.admission_mode ?? 'bureau';
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<View>({ kind: 'card' });
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [pending, rejected, categories] = await Promise.all([
          listMembers({ status: 'pending' }, controller.signal),
          listMembers({ status: 'rejected' }, controller.signal),
          listCategories(controller.signal),
        ]);
        setLoad({ kind: 'ready', pending, rejected, categories });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (isSessionError(cause)) return;
        setLoad({ kind: 'error', message: errorMessage(cause, 'Les demandes n’ont pas pu être chargées.') });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const backToCard = useCallback(() => setView({ kind: 'card' }), []);
  useBackBar(view.kind === 'refuse' ? { href: '/bureau/demandes', label: 'Retour', onClick: backToCard } : null);

  if (load.kind === 'loading') return <Skeleton label="Chargement des demandes…" />;
  if (load.kind === 'error') {
    return (
      <Notice tone="late">
        <span>{load.message}</span>
        <span>
          <Button onClick={reload}>Réessayer</Button>
        </span>
      </Notice>
    );
  }

  const { pending, rejected, categories } = load;
  const list = mode === 'bureau' ? pending : [];

  if (view.kind === 'admitted') {
    return (
      <Admitted
        member={view.member}
        categories={categories}
        more={list.filter((m) => m.id !== view.member.id).length}
        onNext={() => {
          setView({ kind: 'card' });
          setIndex(0);
          reload();
        }}
      />
    );
  }

  if (view.kind === 'refuse') {
    return (
      <Refuse
        member={view.member}
        categories={categories}
        onDone={(message) => {
          setToast(message);
          setView({ kind: 'card' });
          setIndex(0);
          reload();
        }}
        onStale={(message) => {
          setToast(message);
          setView({ kind: 'card' });
          reload();
        }}
      />
    );
  }

  const i = list.length > 0 ? index % list.length : 0;
  const current = list[i] ?? null;
  const writer = personName(me, session);
  const association = headerTitle(settings);

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4">
      <div>
        <h1 className="title m-0">Demandes d’adhésion</h1>
        <p className="m-0 text-ink-muted">
          Ces personnes ont rempli le formulaire. Appelez-les si vous avez un doute, puis répondez.
        </p>
      </div>

      {current ? (
        <>
          <div className="small font-semibold text-ink-muted" data-testid="counter">
            Demande {i + 1} sur {list.length}
          </div>
          <ApplicationCard
            key={current.id}
            member={current}
            categories={categories}
            waText={`Bonjour ${firstName(current)},\nIci ${writer}, de ${association}. Nous avons bien reçu votre demande d’adhésion. `}
            onAdmitted={(member) => setView({ kind: 'admitted', member })}
            onRefuse={() => setView({ kind: 'refuse', member: current })}
            onNext={list.length > 1 ? () => setIndex((n) => n + 1) : null}
            onStale={(message) => {
              setToast(message);
              reload();
            }}
          />
        </>
      ) : (
        <section className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] bg-paid-soft px-4 py-5 text-center" data-testid="no-application">
          <span className="flex size-12 items-center justify-center rounded-full bg-paid text-on-indigo">
            <CheckIcon size={24} />
          </span>
          <h2 className="heading m-0 text-paid">Aucune demande à examiner</h2>
          <p className="m-0">
            {mode === 'bureau'
              ? 'Vous avez répondu à toutes les demandes.'
              : 'Toute personne qui paie sa première cotisation devient membre : il n’y a rien à examiner.'}
          </p>
          {mode !== 'bureau' && pending.length > 0 ? (
            <Link href="/bureau/demandes/en-attente" className="font-semibold">
              Voir les {pending.length > 1 ? `${pending.length} personnes` : 'personne'} qui n’ont pas
              encore payé
            </Link>
          ) : null}
        </section>
      )}

      {rejected.length > 0 ? (
        <details className="group rounded-[var(--radius-md)] border border-line bg-surface-raised px-4" data-testid="rejected">
          <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span>Demandes refusées ({rejected.length})</span>
            <span className="small font-semibold text-indigo group-open:hidden">Voir</span>
            <span className="small hidden font-semibold text-indigo group-open:inline">Masquer</span>
          </summary>
          <ul className="m-0 flex list-none flex-col p-0 pb-2">
            {rejected.map((member) => (
              <li key={member.id} className="flex flex-col gap-1 border-t border-line py-3">
                <Link href={`/bureau/membres/${encodeURIComponent(member.id)}`} className="font-semibold">
                  {member.name}
                </Link>
                {member.category_label ? <span className="small text-ink-muted">{member.category_label}</span> : null}
                {member.application_rejection_reason ? (
                  <span className="small whitespace-pre-line break-words">
                    Motif : {member.application_rejection_reason}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}

/** Le parrain, ou la fiche qui ressemble : relus en entier pour le nom et le numéro. */
function useMember(id: string | null | undefined): MemberDetail | null {
  const [member, setMember] = useState<MemberDetail | null>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    getMember(id, controller.signal)
      .then(setMember)
      .catch(() => {
        // Sans la fiche, on garde ce que la ligne porte déjà.
      });
    return () => controller.abort();
  }, [id]);
  return member;
}

function Fact({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col ${wide ? 'col-span-2' : ''}`}>
      <Label>{label}</Label>
      <span className="break-words">{children}</span>
    </div>
  );
}

function ApplicationCard({
  member,
  categories,
  waText,
  onAdmitted,
  onRefuse,
  onNext,
  onStale,
}: {
  member: MemberListItem;
  categories: Category[];
  waText: string;
  onAdmitted: (member: DecidedMember) => void;
  onRefuse: () => void;
  onNext: (() => void) | null;
  onStale: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parrain = useMember(member.referred_by?.id);
  const duplicate = useMember(member.possible_duplicate_of);
  const who = firstName(member);
  const samePhone =
    !!duplicate && !!member.phone && phoneDigits(duplicate.phone).slice(-9) === phoneDigits(member.phone).slice(-9);

  async function admit() {
    setBusy(true);
    setError(null);
    try {
      onAdmitted(await admitApplication(member.id));
    } catch (cause) {
      setBusy(false);
      if (isSessionError(cause)) return;
      // 409 not_a_candidate : quelqu'un a décidé entre-temps. Le message le dit.
      if (cause instanceof ApiError && cause.status === 409) {
        onStale(cause.message);
        return;
      }
      setError(errorMessage(cause, 'L’admission n’a pas pu être enregistrée. Réessayez.'));
    }
  }

  return (
    <>
      <section className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4" data-testid="application">
        <div className="flex items-start gap-3">
          <MemberPhoto url={member.photo_url} name={member.name} size={80} />
          <div className="min-w-0">
            <h2 className="title m-0 break-words">{member.name}</h2>
            <p className="m-0">
              demande à adhérer comme <b>{categoryLine(member, categories) || 'membre'}</b>
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Fact label="Téléphone">
            {member.phone ? <span className="tnum">{spacedPhone(member.phone)}</span> : 'Pas de téléphone'}
          </Fact>
          {member.region ? <Fact label="Région">{member.region}</Fact> : null}
          {member.email ? (
            <Fact label="E-mail" wide>
              {member.email}
            </Fact>
          ) : null}
          {member.referred_by ? (
            <Fact label="Invitation de" wide>
              {parrain
                ? [parrain.name, parrain.member_number ? `membre n° ${parrain.member_number}` : null]
                    .filter(Boolean)
                    .join(', ')
                : member.referred_by.display_name}
            </Fact>
          ) : null}
        </div>
        {member.answers && member.answers.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <Label>Ses réponses</Label>
            <AnswersList answers={member.answers} />
          </div>
        ) : null}
        {member.phone ? (
          <div className="grid grid-cols-2 gap-[10px]">
            <a href={`tel:${phoneDigits(member.phone)}`} className={bigButtonClass('outline')}>
              Appeler
            </a>
            <a href={whatsappLink(waText, member.phone)} target="_blank" rel="noopener noreferrer" className={bigButtonClass('outline')}>
              <ChatIcon size={20} />
              WhatsApp
            </a>
          </div>
        ) : null}
      </section>

      {member.possible_duplicate_of ? (
        <section className="flex flex-col gap-1 rounded-[var(--radius-md)] border-l-4 border-due bg-due-soft p-4" data-testid="duplicate">
          {duplicate ? (
            <p className="m-0">
              <b>
                {samePhone ? 'Ce numéro est déjà celui de ' : 'Cette demande ressemble à la fiche de '}
                {duplicate.name}
              </b>
              {[duplicate.member_number ? `, membre n° ${duplicate.member_number}` : '', duplicate.category_label ? ` (${duplicate.category_label})` : ''].join('')}
              . C’est peut-être la même personne.
            </p>
          ) : (
            <p className="m-0">
              <b>Cette demande ressemble à la fiche d’un membre.</b> C’est peut-être la même personne.
            </p>
          )}
          <Link href={`/bureau/membres/${encodeURIComponent(member.possible_duplicate_of)}`} className="font-semibold">
            {duplicate ? `Voir la fiche de ${duplicate.name}` : 'Voir sa fiche'}
          </Link>
        </section>
      ) : null}

      {error ? <Notice tone="late">{error}</Notice> : null}

      <div className="flex flex-col gap-[10px]">
        <button type="button" disabled={busy} onClick={() => void admit()} className={bigButtonClass('primary')}>
          {busy ? 'Admission…' : `Admettre ${who} comme membre`}
        </button>
        <button type="button" disabled={busy} onClick={onRefuse} className={bigButtonClass('outline-red')}>
          Refuser la demande
        </button>
        {onNext ? (
          <button type="button" onClick={onNext} className={LINK_BUTTON}>
            Passer à la demande suivante
          </button>
        ) : null}
      </div>
    </>
  );
}

/**
 * « {Nom} est membre » — puis, TOUT DE SUITE, le message de bienvenue (§17.6) :
 * c'est lui qui remet son lien à un admis qui n'a souvent pas d'e-mail.
 */
function Admitted({
  member,
  categories,
  more,
  onNext,
}: {
  member: DecidedMember;
  categories: Category[];
  more: number;
  onNext: () => void;
}) {
  const share = member.share ?? null;
  const who = firstName(member);
  const first = member.balance_due_formatted ?? categories.find((c) => c.id === member.category_id)?.amount_formatted;

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4" data-testid="admitted">
      <section className="flex flex-col items-center gap-[10px] rounded-[var(--radius-md)] bg-paid-soft px-4 py-5 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-paid text-on-indigo">
          <CheckIcon size={30} />
        </span>
        <h1 className="title m-0 text-paid">{member.name} est membre</h1>
        <p className="m-0">
          {[member.member_number ? `n° ${member.member_number}` : null, member.category_label].filter(Boolean).join(' · ')}
        </p>
        {first ? (
          <span className="inline-flex min-h-7 items-center rounded-[var(--radius-pill)] bg-late-soft px-3 text-[14px] font-semibold text-late">
            Première cotisation :&nbsp;<span className="money">{first}</span>
          </span>
        ) : null}
      </section>

      {share ? (
        <>
          <p className="m-0">
            Envoyez-lui son lien : c’est là que {who} paiera sa cotisation et retrouvera sa carte de
            membre.
          </p>
          <a href={share.whatsapp_url} target="_blank" rel="noopener noreferrer" className={bigButtonClass('primary')} data-testid="wa-welcome">
            <ChatIcon size={22} />
            Lui souhaiter la bienvenue par WhatsApp
          </a>
          <span className="small -mt-2 text-center text-ink-muted">À : {spacedPhone(share.phone)}</span>
        </>
      ) : (
        <p className="m-0 font-semibold" data-testid="no-phone">
          {who} n’a pas de numéro WhatsApp utilisable : envoyez-lui son lien depuis sa fiche
          (« Autres actions », « Son lien personnel »).
        </p>
      )}

      <div className="flex flex-col gap-[10px]">
        <Link href={`/bureau/membres/${encodeURIComponent(member.id)}`} className={bigButtonClass('outline')}>
          Voir sa fiche
        </Link>
        {more > 0 ? (
          <button type="button" onClick={onNext} className={LINK_BUTTON}>
            Examiner la demande suivante
          </button>
        ) : null}
        <Link href="/bureau" className={`${LINK_BUTTON} text-center`}>
          Retour à l’accueil
        </Link>
      </div>
    </div>
  );
}

/**
 * « Pourquoi refuser cette demande ? » — un texte libre, écrit pour la
 * personne : pas de raison toute prête, refuser quelqu'un est rare et
 * personnel. AUCUN message ne part tout seul (§17.6) : deux boutons, et c'est
 * le bureau qui choisit.
 */
function Refuse({
  member,
  categories,
  onDone,
  onStale,
}: {
  member: MemberListItem;
  categories: Category[];
  onDone: (message: string) => void;
  onStale: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const who = firstName(member);

  async function refuse(notify: boolean) {
    if (busy) return;
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setError(`Écrivez la raison, en ${MIN_REASON_LENGTH} caractères au moins : ${who} la lira.`);
      return;
    }
    setError(null);
    setBusy(true);
    // L'onglet s'ouvre AU CLIC : un `window.open` après un `await` est bloqué.
    const tab = notify ? openPendingTab() : null;
    try {
      const decided = await rejectApplication(member.id, reason.trim());
      const url = decided.share?.whatsapp_url ?? null;
      if (tab) {
        if (!url) tab.close();
        else if (!tab.go(url)) {
          setBlocked(url);
          setBusy(false);
          return;
        }
      }
      onDone(
        notify && !url
          ? `Demande refusée. ${who} n’a pas de numéro WhatsApp utilisable, et lira la raison sur sa page.`
          : `Demande refusée. ${who} lira la raison sur sa page.`,
      );
    } catch (cause) {
      tab?.close();
      setBusy(false);
      if (isSessionError(cause)) return;
      const fields = fieldMessages(cause);
      if (fields.reason) {
        setError(fields.reason);
        return;
      }
      if (cause instanceof ApiError && cause.status === 409) {
        onStale(cause.message);
        return;
      }
      setError(errorMessage(cause, 'Le refus n’a pas pu être enregistré. Réessayez.'));
    }
  }

  if (blocked) {
    return (
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4">
        <Notice tone="paid">Demande refusée. {who} lira la raison sur sa page.</Notice>
        <a href={blocked} target="_blank" rel="noopener noreferrer" className={bigButtonClass('primary')}>
          <ChatIcon size={22} />
          Ouvrir WhatsApp pour prévenir {who}
        </a>
        <button type="button" onClick={() => onDone(`Demande refusée. ${who} lira la raison sur sa page.`)} className={LINK_BUTTON}>
          Revenir aux demandes
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4" data-testid="refuse-application">
      <div>
        <h1 className="title m-0">Pourquoi refuser cette demande ?</h1>
        <p className="m-0 text-ink-muted">
          {[member.name, categoryLine(member, categories)].filter(Boolean).join(' · ')}. Écrivez la
          raison : {who} la lira sur sa page.
        </p>
      </div>

      <section className="rounded-[var(--radius-md)] border-l-4 border-due bg-due-soft p-4">
        <b>C’est un sujet délicat.</b> Un appel vaut souvent mieux qu’un message.{' '}
        {member.phone ? (
          <a href={`tel:${phoneDigits(member.phone)}`} className="font-semibold">
            Appeler {who}
          </a>
        ) : null}
      </section>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor="raison-refus" className="font-semibold">
          La raison
        </label>
        <textarea
          id="raison-refus"
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby="raison-refus-aide"
          placeholder="Par exemple : l’adhésion est réservée aux techniciens diplômés."
          className={`min-h-24 w-full rounded-[var(--radius-sm)] border bg-surface-raised px-3 py-2 text-[16px] ${error ? 'border-late' : 'border-line-strong'}`}
        />
        <span id="raison-refus-aide" className={`small ${error ? 'font-semibold text-late' : 'text-ink-muted'}`}>
          {error ?? `${MIN_REASON_LENGTH} caractères au moins.`}
        </span>
      </div>

      <section className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4">
        <Label>Le message que {who} recevra</Label>
        <p className="m-0 whitespace-pre-line break-words" data-testid="refusal-preview">
          {refusalPreview(member, reason)}
        </p>
      </section>

      <div className="flex flex-col gap-[10px]">
        {member.phone ? (
          <button type="button" disabled={busy} onClick={() => void refuse(true)} className={bigButtonClass('danger')}>
            <ChatIcon size={22} />
            Refuser et prévenir par WhatsApp
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void refuse(false)}
          className={member.phone ? LINK_BUTTON : bigButtonClass('danger')}
        >
          Refuser sans envoyer de message
        </button>
      </div>
    </div>
  );
}
