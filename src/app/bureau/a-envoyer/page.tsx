'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBureau } from '@/components/bureau/BureauContext';
import { CopyAction } from '@/components/bureau/CopyAction';
import { ChatIcon } from '@/components/bureau/Icons';
import {
  Button,
  buttonClass,
  EmptyState,
  inputClass,
  Notice,
  PageTitle,
  Skeleton,
} from '@/components/bureau/ui';
import { Pastille } from '@/components/Pastille';
import { ApiError } from '@/lib/api';
import {
  isSessionError,
  listCampaigns,
  listOutreach,
  markOutreachSent,
  skipOutreach,
} from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import type { Campaign, OutreachItem } from '@/lib/bureau/types';
import { daysBetween, formatDayMonth, safeTimeZone, todayInDakar, zonedParts } from '@/lib/dates';

/** Les motifs d'un toucher ; « Autre » demande un mot. */
export const SKIP_REASONS = ['Pas de WhatsApp', 'Numéro incorrect'] as const;

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

/**
 * Pourquoi ce membre est dans la file, en clair.
 *
 * ⚠️ Un `j-7` (comme un `j-30`) vise un membre À JOUR : il annonce une
 * échéance, il ne réclame rien (piège 21) — jamais « en retard » pour lui.
 */
export function reasonLabel(
  item: OutreachItem,
  campaignDates: Record<string, string>,
  today: string,
): string {
  if (item.step === 'j+1') {
    const since = formatDayMonth(item.due_on);
    return since ? `En retard depuis le ${since}` : 'En retard';
  }
  if (item.step === 'j-7' || item.step === 'j-30') {
    const days = item.due_on ? daysBetween(today, item.due_on) : null;
    if (days === null) return 'Échéance à venir';
    if (days > 1) return `Échéance dans ${days} jours`;
    if (days === 1) return 'Échéance demain';
    if (days === 0) return 'Échéance aujourd’hui';
    return `Échéance passée le ${formatDayMonth(item.due_on)}`;
  }
  const day = item.campaign ? campaignDates[item.campaign.id] : undefined;
  return day ? `Campagne du ${day}` : 'Campagne du bureau';
}

/**
 * « À envoyer » — la file WhatsApp, un membre à la fois.
 *
 * Par membre : « Ouvrir WhatsApp » (l'application, ou WhatsApp Web), « Envoyer »
 * dans WhatsApp, le retour, puis « Envoyé ✓ ». La carte suivante s'affiche
 * aussitôt.
 *
 * Règles du contrat (§9) :
 * - ouvrir n'est PAS envoyer : rien n'est marqué à l'ouverture ;
 * - le message est celui du serveur, composé à la lecture : jamais recomposé,
 *   et la file est relue après chaque geste plutôt que gardée en mémoire ;
 * - la file peut rétrécir : un membre qui a réglé entre-temps disparaît sans
 *   geste, et sans erreur ;
 * - l'ordre est celui du serveur, jamais retrié.
 */
export default function AEnvoyerPage() {
  const { settings } = useBureau();
  const zone = safeTimeZone(settings.timezone);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [queue, setQueue] = useState<OutreachItem[]>([]);
  const [campaignDates, setCampaignDates] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // Les lignes traitées ici : une relecture partie avant le geste ne les
  // ramène pas.
  const handled = useRef(new Set<string>());

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const fresh = await listOutreach(signal);
    setQueue(fresh.filter((item) => !handled.current.has(item.id)));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    void (async () => {
      try {
        await refresh(controller.signal);
        setLoad({ kind: 'ready' });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isSessionError(error)) return;
        setLoad({
          kind: 'error',
          message: errorMessage(error, 'La file des messages n’a pas pu être chargée.'),
        });
      }
    })();
    // La date d'une campagne du bureau (« Campagne du 2 janvier ») n'est pas
    // dans la file : on la lit dans la liste des campagnes. Sans elle, la carte
    // dit « Campagne du bureau » — rien de bloquant.
    void (async () => {
      try {
        const campaigns: Campaign[] = await listCampaigns(controller.signal);
        const dates: Record<string, string> = {};
        for (const c of campaigns) {
          const at = zonedParts(c.scheduled_at ?? c.created_at, zone);
          if (at) dates[c.id] = formatDayMonth(at.date);
        }
        setCampaignDates(dates);
      } catch {
        // Facultatif.
      }
    })();
    return () => controller.abort();
  }, [refresh, attempt, zone]);

  /** Le geste a abouti (ou la ligne n'était plus à traiter) : carte suivante. */
  const advance = useCallback(
    (item: OutreachItem, outcome: 'sent' | 'skipped' | 'gone') => {
      handled.current.add(item.id);
      setQueue((prev) => prev.filter((i) => i.id !== item.id));
      if (outcome === 'sent') setSent((n) => n + 1);
      if (outcome === 'skipped') setSkipped((n) => n + 1);
      // Relue en arrière-plan : messages recomposés, membres réglés écartés.
      void refresh().catch(() => undefined);
    },
    [refresh],
  );

  const done = sent + skipped;
  const total = done + queue.length;
  const current = queue[0] ?? null;

  return (
    <>
      <PageTitle
        title="À envoyer"
        subtitle={
          load.kind === 'ready' && current ? (
            <span data-testid="counter" className="font-semibold text-ink">
              {done + 1} sur {total}
            </span>
          ) : (
            'Les messages WhatsApp à envoyer, un membre à la fois.'
          )
        }
      />

      {load.kind === 'loading' ? <Skeleton label="Chargement de la file…" /> : null}

      {load.kind === 'error' ? (
        <Notice tone="late">
          <span>{load.message}</span>
          <span>
            <Button onClick={() => setAttempt((n) => n + 1)}>Réessayer</Button>
          </span>
        </Notice>
      ) : null}

      {load.kind === 'ready' && current ? (
        <OutreachCard
          key={current.id}
          item={current}
          reason={reasonLabel(current, campaignDates, todayInDakar())}
          onDone={(outcome) => advance(current, outcome)}
        />
      ) : null}

      {load.kind === 'ready' && !current ? (
        done > 0 ? (
          <Notice tone="paid">
            <span className="title">Tout est envoyé.</span>
            <span className="font-normal" data-testid="summary">
              {sent > 1 ? `${sent} messages envoyés` : `${sent} message envoyé`}
              {skipped > 0 ? `, ${skipped > 1 ? `${skipped} passés` : '1 passé'}` : ''}.
            </span>
            <span>
              <Link href="/bureau" className={buttonClass('secondary', 'no-underline')}>
                Retour au tableau de bord
              </Link>
            </span>
          </Notice>
        ) : (
          <EmptyState>Aucun message à envoyer.</EmptyState>
        )
      ) : null}
    </>
  );
}

type Step = 'idle' | 'opened' | 'skipping';

function OutreachCard({
  item,
  reason,
  onDone,
}: {
  item: OutreachItem;
  reason: string;
  onDone: (outcome: 'sent' | 'skipped' | 'gone') => void;
}) {
  const [step, setStep] = useState<Step>('idle');
  const [other, setOther] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentRef = useRef<HTMLButtonElement>(null);
  const canOpen = item.phone_is_usable && !!item.wa_url;

  // Au retour sur l'onglet, « Envoyé ✓ » attend le pouce.
  useEffect(() => {
    if (step === 'opened') sentRef.current?.focus();
  }, [step]);

  async function decide(run: () => Promise<unknown>, outcome: 'sent' | 'skipped') {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await run();
      onDone(outcome);
    } catch (cause) {
      if (isSessionError(cause)) return;
      // Déjà traité ailleurs, ou écarté par le serveur : la ligne s'en va sans
      // bruit.
      if (cause instanceof ApiError && (cause.code === 'message_not_pending' || cause.status === 404)) {
        onDone('gone');
        return;
      }
      setError(errorMessage(cause, 'Le geste n’a pas pu être enregistré. Réessayez.'));
      setBusy(false);
    }
  }

  const skip = (reasonText: string) => decide(() => skipOutreach(item.id, reasonText), 'skipped');

  return (
    <article
      className="flex min-h-[calc(100dvh-12rem)] flex-col gap-4 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4 lg:min-h-0 lg:max-w-[640px]"
      aria-labelledby={`carte-${item.id}`}
    >
      <div className="flex flex-col gap-1">
        <h2 id={`carte-${item.id}`} className="title m-0 break-words">
          {item.member.name}
        </h2>
        <span className="tnum text-ink-muted">{item.member.phone ?? 'Pas de téléphone'}</span>
        <span>
          <Pastille tone={item.step === 'j+1' ? 'late' : item.step === null ? 'info' : 'due'}>
            {reason}
          </Pastille>
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="label text-ink-muted">MESSAGE</span>
        {/* Tel que le serveur l'a composé : jamais recomposé ici. */}
        <p
          className="m-0 rounded-[var(--radius-sm)] bg-surface p-3 whitespace-pre-wrap break-words"
          data-testid="message"
        >
          {item.message}
        </p>
      </div>

      {canOpen ? null : (
        <p className="m-0 rounded-[var(--radius-sm)] bg-due-soft p-3 font-semibold text-due">
          Le numéro n’est pas reconnu avec certitude : copiez le message et
          envoyez-le vous-même.
        </p>
      )}

      {error ? (
        <p role="alert" className="m-0 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late">
          {error}
        </p>
      ) : null}

      <div className="grow" />

      {step === 'skipping' ? (
        <div role="group" aria-label="Pourquoi passer ce membre ?" className="flex flex-col gap-2">
          <span className="font-semibold">Pourquoi passer ce membre ?</span>
          {SKIP_REASONS.map((label) => (
            <Button key={label} onClick={() => void skip(label)} disabled={busy} className="min-h-12">
              {label}
            </Button>
          ))}
          {other === null ? (
            <Button onClick={() => setOther('')} disabled={busy} className="min-h-12">
              Autre
            </Button>
          ) : (
            <form
              className="m-0 flex flex-col gap-2"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                const text = other.trim();
                if (text === '') {
                  setError('Indiquez le motif en quelques mots.');
                  return;
                }
                void skip(text);
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Autre motif</span>
                <input
                  autoFocus
                  maxLength={255}
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  className={inputClass(false)}
                />
              </label>
              <Button type="submit" tone="primary" disabled={busy}>
                Passer ce membre
              </Button>
            </form>
          )}
          <Button
            tone="ghost"
            disabled={busy}
            onClick={() => {
              setOther(null);
              setError(null);
              setStep('idle');
            }}
          >
            Revenir
          </Button>
        </div>
      ) : (
        <div className="sticky bottom-0 flex flex-col gap-2 bg-surface-raised pt-2">
          {/* Sans lien WhatsApp, la copie est le premier geste : elle doit être
              sous le pouce, pas sous la barre. */}
          {canOpen ? null : <CopyAction value={item.message} label="Copier le message" />}
          {step === 'opened' || !canOpen ? (
            <Button
              ref={sentRef}
              tone="primary"
              onClick={() => void decide(() => markOutreachSent(item.id), 'sent')}
              disabled={busy}
              className="min-h-14 text-[18px]"
            >
              {busy ? 'Envoi…' : 'Envoyé ✓'}
            </Button>
          ) : null}
          {canOpen ? (
            // Ouvrir n'est pas envoyer : ce lien ne marque RIEN.
            <a
              href={item.wa_url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setStep('opened')}
              className={buttonClass(
                step === 'opened' ? 'secondary' : 'primary',
                step === 'opened' ? 'no-underline' : 'min-h-14 text-[18px] no-underline',
              )}
            >
              <ChatIcon size={20} />
              {step === 'opened' ? 'Rouvrir WhatsApp' : 'Ouvrir WhatsApp'}
            </a>
          ) : null}
          <Button tone="ghost" onClick={() => setStep('skipping')} disabled={busy}>
            Passer
          </Button>
        </div>
      )}
    </article>
  );
}
