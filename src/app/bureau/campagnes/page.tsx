'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { useBureau } from '@/components/bureau/BureauContext';
import { ConfirmDialog } from '@/components/bureau/ConfirmDialog';
import { PlusIcon, SendIcon } from '@/components/bureau/Icons';
import {
  Button,
  buttonClass,
  EmptyState,
  inputClass,
  Notice,
  PageTitle,
  Panel,
  Skeleton,
} from '@/components/bureau/ui';
import { Pastille } from '@/components/Pastille';
import { ApiError } from '@/lib/api';
import {
  cancelCampaign,
  createCampaign,
  isSessionError,
  listCampaigns,
} from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import type {
  Campaign,
  CampaignSegment,
  ChannelProgress,
  LaunchedCampaign,
} from '@/lib/bureau/types';
import {
  formatDayMonth,
  formatShortDate,
  nextDay,
  safeTimeZone,
  zonedParts,
  zonedToIso,
} from '@/lib/dates';

const SEGMENTS: ReadonlyArray<{ value: CampaignSegment; label: string; recap: string }> = [
  {
    value: 'non_a_jour',
    label: 'Les membres qui ne sont pas à jour',
    recap: 'les membres non à jour',
  },
  { value: 'tous_actifs', label: 'Tous les membres actifs', recap: 'tous les membres actifs' },
];

/** Le segment d'une campagne, en clair — celles du bureau et les rappels automatiques. */
export function segmentLabel(segment: string): string {
  switch (segment) {
    case 'non_a_jour':
      return 'Membres non à jour';
    case 'tous_actifs':
      return 'Tous les membres actifs';
    case 'auto:j-30':
      return 'Rappel automatique, 30 jours avant l’échéance';
    case 'auto:j-7':
      return 'Rappel automatique, 7 jours avant l’échéance';
    case 'auto:j+1':
      return 'Relance automatique, le lendemain de l’échéance';
    default:
      return segment;
  }
}

/** « 02/01 à 09:00 » dans le fuseau de l'association. */
function shortAt(iso: string | null, zone: string): string {
  const at = zonedParts(iso, zone);
  if (!at) return '';
  return `${formatShortDate(at.date).slice(0, 5)} à ${at.time}`;
}

/** « 2 janvier à 09:00 ». */
function longAt(iso: string | null, zone: string): string {
  const at = zonedParts(iso, zone);
  return at ? `${formatDayMonth(at.date)} à ${at.time}` : '';
}

export function campaignState(c: Campaign, zone: string): string {
  if (c.status === 'cancelled') return 'Annulée';
  if (c.status === 'draft') {
    const at = shortAt(c.scheduled_at, zone);
    return at ? `Programmée pour le ${at}` : 'Programmée';
  }
  if (c.status === 'sent') {
    const at = shortAt(c.scheduled_at ?? c.created_at, zone);
    return at ? `Partie le ${at}` : 'Partie';
  }
  return 'En préparation';
}

function progress(label: string, channel: ChannelProgress | undefined): string | null {
  if (!channel || channel.total === 0) return null;
  return `${label} : ${channel.sent} ${channel.sent > 1 ? 'envoyés' : 'envoyé'} sur ${channel.total}`;
}

/** Le nom de la ville d'un fuseau IANA : « Africa/Dakar » → « Dakar ». */
function cityOf(zone: string): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; campaigns: Campaign[] };

type Banner = { tone: 'paid' | 'info' | 'late'; text: string };

/**
 * Les campagnes : la liste (la plus récente en tête, l'ordre du serveur), et
 * « Nouvelle campagne » en trois choix — à qui, quand, avec ou sans e-mail.
 *
 * ⚠️ Une campagne programmée ne fige rien : ses compteurs sont à 0 jusqu'à
 * l'heure dite (piège 22). Annuler une campagne déjà partie rend
 * `422 campaign_already_sent` : on recharge la liste (piège 30).
 */
export default function CampagnesPage() {
  const { settings } = useBureau();
  const zone = safeTimeZone(settings.timezone);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [launched, setLaunched] = useState<LaunchedCampaign | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [cancelling, setCancelling] = useState<Campaign | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setLoad({ kind: 'ready', campaigns: await listCampaigns(controller.signal) });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isSessionError(error)) return;
        setLoad({
          kind: 'error',
          message: errorMessage(error, 'Les campagnes n’ont pas pu être chargées.'),
        });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const reload = () => setAttempt((n) => n + 1);

  async function confirmCancel() {
    if (!cancelling || cancelBusy) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const updated = await cancelCampaign(cancelling.id);
      setLoad((prev) =>
        prev.kind === 'ready'
          ? { ...prev, campaigns: prev.campaigns.map((c) => (c.id === updated.id ? updated : c)) }
          : prev,
      );
      setCancelling(null);
      setBanner({ tone: 'info', text: 'Campagne annulée. Aucun message ne partira.' });
    } catch (cause) {
      if (isSessionError(cause)) return;
      if (cause instanceof ApiError && cause.code === 'campaign_already_sent') {
        // Le cron l'a lancée entre l'affichage et le geste : la liste est
        // relue, le bouton disparaît.
        setCancelling(null);
        setBanner({ tone: 'late', text: errorMessage(cause, '') });
        reload();
      } else {
        setCancelError(errorMessage(cause, 'La campagne n’a pas pu être annulée.'));
      }
    } finally {
      setCancelBusy(false);
    }
  }

  const campaigns = load.kind === 'ready' ? load.campaigns : [];
  const ours = campaigns.filter((c) => !c.automatic);
  const automatic = campaigns.filter((c) => c.automatic);

  return (
    <>
      <PageTitle
        title="Campagnes"
        subtitle="Prévenir les membres en une fois : par e-mail automatiquement, et par WhatsApp depuis votre file."
        actions={
          creating ? null : (
            <Button
              tone="primary"
              onClick={() => {
                setLaunched(null);
                setBanner(null);
                setCreating(true);
              }}
            >
              <PlusIcon />
              Nouvelle campagne
            </Button>
          )
        }
      />

      {banner ? (
        <Notice tone={banner.tone}>
          <span>{banner.text}</span>
          <span>
            <Button tone="ghost" className="px-0" onClick={() => setBanner(null)}>
              Fermer
            </Button>
          </span>
        </Notice>
      ) : null}

      {launched ? <LaunchOutcome campaign={launched} zone={zone} onClose={() => setLaunched(null)} /> : null}

      {creating ? (
        <NewCampaignPanel
          zone={zone}
          onClose={() => setCreating(false)}
          onLaunched={(campaign) => {
            setCreating(false);
            setLaunched(campaign);
            reload();
          }}
        />
      ) : null}

      {load.kind === 'loading' ? <Skeleton label="Chargement des campagnes…" /> : null}

      {load.kind === 'error' ? (
        <Notice tone="late">
          <span>{load.message}</span>
          <span>
            <Button onClick={reload}>Réessayer</Button>
          </span>
        </Notice>
      ) : null}

      {load.kind === 'ready' && ours.length === 0 ? (
        <EmptyState>Aucune campagne lancée par le bureau pour le moment.</EmptyState>
      ) : null}

      {ours.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {ours.map((c) => (
            <li key={c.id}>
              <CampaignCard campaign={c} zone={zone} onCancel={() => {
                setCancelError(null);
                setCancelling(c);
              }} />
            </li>
          ))}
        </ul>
      ) : null}

      {automatic.length > 0 ? (
        <details className="rounded-[var(--radius-md)] border border-line bg-surface-raised p-4">
          <summary className="cursor-pointer font-semibold">
            Rappels automatiques ({automatic.length})
          </summary>
          <p className="small mt-2 mb-3 text-ink-muted">
            Ils partent seuls, par e-mail, 30 et 7 jours avant chaque échéance et
            le lendemain. Leurs messages WhatsApp rejoignent votre file.
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {automatic.map((c) => (
              <li key={c.id} className="small flex flex-col gap-1 border-t border-line pt-2">
                <span className="font-semibold">{segmentLabel(c.segment)}</span>
                <span className="text-ink-muted">
                  {[campaignState(c, zone), progress('E-mails', c.channels?.email), progress('WhatsApp', c.channels?.whatsapp)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {cancelling ? (
        <ConfirmDialog
          title={`Annuler la campagne du ${longAt(cancelling.scheduled_at ?? cancelling.created_at, zone)} ?`}
          confirmLabel="Annuler la campagne"
          confirmTone="danger"
          cancelLabel="Garder la campagne"
          busy={cancelBusy}
          error={cancelError}
          onConfirm={() => void confirmCancel()}
          onCancel={() => setCancelling(null)}
        >
          <p className="m-0">
            {segmentLabel(cancelling.segment)}. Aucun message ne partira.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function CampaignCard({
  campaign: c,
  zone,
  onCancel,
}: {
  campaign: Campaign;
  zone: string;
  onCancel: () => void;
}) {
  const lines = [progress('E-mails', c.channels?.email), progress('WhatsApp', c.channels?.whatsapp)].filter(Boolean);
  // `cancellable` est indicatif (piège 30) : le bouton se montre, la réponse
  // tranche.
  const canCancel = c.cancellable ?? c.status === 'draft';
  const tone = c.status === 'cancelled' ? 'late' : c.status === 'draft' ? 'due' : 'paid';

  return (
    <article className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="heading">{segmentLabel(c.segment)}</span>
        <Pastille tone={tone}>{campaignState(c, zone)}</Pastille>
      </div>
      {c.status === 'draft' ? (
        <span className="small text-ink-muted">Les destinataires seront fixés à l’heure dite.</span>
      ) : lines.length > 0 ? (
        <span className="small tnum">{lines.join(' · ')}</span>
      ) : c.status === 'sent' ? (
        <span className="small text-ink-muted">Aucun destinataire joignable.</span>
      ) : null}
      {c.status !== 'cancelled' ? (
        <span className="small text-ink-muted">{c.send_email ? 'Avec e-mails' : 'Sans e-mail'}</span>
      ) : null}
      {canCancel && c.status !== 'cancelled' ? (
        <span>
          <Button tone="ghost" className="px-0 text-late!" onClick={onCancel}>
            Annuler cette campagne
          </Button>
        </span>
      ) : null}
    </article>
  );
}

function LaunchOutcome({
  campaign,
  zone,
  onClose,
}: {
  campaign: LaunchedCampaign;
  zone: string;
  onClose: () => void;
}) {
  if (!campaign.launched) {
    return (
      <Notice tone="info">
        <span>
          Campagne programmée pour le {shortAt(campaign.scheduled_at, zone)}. Ses
          destinataires seront fixés à l’heure dite.
        </span>
        <span>
          <Button tone="ghost" className="px-0" onClick={onClose}>
            Fermer
          </Button>
        </span>
      </Notice>
    );
  }
  const n = campaign;
  const queued = n.already_queued ?? 0;
  return (
    <Notice tone="paid">
      <span className="title">Campagne lancée.</span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 font-normal" data-testid="launch-counts">
        <li>
          <strong>{n.whatsapp_queued}</strong> WhatsApp {n.whatsapp_queued > 1 ? 'ajoutés' : 'ajouté'} à votre file
        </li>
        <li>
          <strong>{n.emails_queued}</strong> {n.emails_queued > 1 ? 'e-mails programmés' : 'e-mail programmé'}
        </li>
        <li>
          <strong>{n.unreachable}</strong>{' '}
          {n.unreachable > 1 ? 'membres injoignables' : 'membre injoignable'} (ni téléphone ni
          e-mail){n.unreachable > 0 ? ' : à prévenir autrement' : ''}
        </li>
        {/* « Déjà dans la file » n'est PAS « injoignable » (§12.5) : leur message attend. */}
        {queued > 0 ? (
          <li data-testid="already-queued">
            <strong>{queued}</strong> déjà dans votre file
          </li>
        ) : null}
      </ul>
      <span className="flex flex-col gap-2 sm:flex-row">
        {n.whatsapp_queued + queued > 0 ? (
          <Link href="/bureau/a-envoyer" className={buttonClass('primary', 'min-h-12 no-underline')}>
            <SendIcon />
            Commencer les envois WhatsApp
          </Link>
        ) : null}
        <Button tone="ghost" onClick={onClose}>
          Fermer
        </Button>
      </span>
    </Notice>
  );
}

function NewCampaignPanel({
  zone,
  onClose,
  onLaunched,
}: {
  zone: string;
  onClose: () => void;
  onLaunched: (campaign: LaunchedCampaign) => void;
}) {
  const ids = useId();
  const today = zonedParts(new Date(), zone)?.date ?? '';
  const [segment, setSegment] = useState<CampaignSegment>('non_a_jour');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [date, setDate] = useState(nextDay(today));
  const [time, setTime] = useState('09:00');
  const [sendEmail, setSendEmail] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scheduledIso = when === 'later' ? zonedToIso(date, time, zone) : null;
  const whenRecap =
    when === 'now'
      ? 'maintenant'
      : scheduledIso
        ? `le ${shortAt(scheduledIso, zone)}`
        : 'date à choisir';
  const recap = `Campagne vers ${SEGMENTS.find((s) => s.value === segment)?.recap} — ${whenRecap} — ${
    sendEmail ? 'e-mails automatiques et WhatsApp ajoutés à votre file' : 'WhatsApp ajoutés à votre file, sans e-mail'
  }`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (when === 'later' && (!scheduledIso || new Date(scheduledIso).getTime() <= Date.now())) {
      setError('Choisissez une date et une heure à venir.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onLaunched(await createCampaign({ segment, send_email: sendEmail, scheduled_at: scheduledIso }));
    } catch (cause) {
      if (isSessionError(cause)) return;
      setError(
        cause instanceof ApiError && cause.errors.scheduled_at
          ? 'Choisissez une date et une heure à venir.'
          : errorMessage(cause, 'La campagne n’a pas pu être lancée.'),
      );
      setBusy(false);
    }
  }

  const radio = (selected: boolean) =>
    `flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] border-2 px-3 py-2 font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${
      selected ? 'border-indigo bg-indigo-soft text-indigo' : 'border-line-strong bg-surface-raised text-ink'
    }`;

  return (
    <Panel
      title="Nouvelle campagne"
      actions={
        <Button tone="ghost" onClick={onClose} disabled={busy}>
          Fermer
        </Button>
      }
    >
      <form className="m-0 flex flex-col gap-5" onSubmit={submit} noValidate>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="m-0 mb-2 p-0 font-semibold">1. À qui ?</legend>
          {SEGMENTS.map((s) => (
            <label key={s.value} className={radio(segment === s.value)}>
              <input
                type="radio"
                name={`${ids}-segment`}
                checked={segment === s.value}
                onChange={() => setSegment(s.value)}
                className="size-5 accent-[var(--indigo)]"
              />
              {s.label}
            </label>
          ))}
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="m-0 mb-2 p-0 font-semibold">2. Quand ?</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className={radio(when === 'now')}>
              <input
                type="radio"
                name={`${ids}-when`}
                checked={when === 'now'}
                onChange={() => setWhen('now')}
                className="size-5 accent-[var(--indigo)]"
              />
              Maintenant
            </label>
            <label className={radio(when === 'later')}>
              <input
                type="radio"
                name={`${ids}-when`}
                checked={when === 'later'}
                onChange={() => setWhen('later')}
                className="size-5 accent-[var(--indigo)]"
              />
              Programmer
            </label>
          </div>
          {when === 'later' ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Date</span>
                <input
                  type="date"
                  min={today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputClass(false, 'w-auto')}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Heure</span>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={inputClass(false, 'w-auto')}
                />
              </label>
              <span className="small pb-3 text-ink-muted">Heure de {cityOf(zone)}</span>
            </div>
          ) : null}
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="m-0 mb-2 p-0 font-semibold">3. E-mails</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
              className="size-5 shrink-0 accent-[var(--indigo)]"
            />
            Envoyer aussi un e-mail aux membres qui ont une adresse
          </label>
        </fieldset>

        {error ? (
          <p role="alert" className="m-0 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {/* R9 : le récapitulatif, sur une ligne, juste au-dessus du bouton. */}
          <p className="m-0 font-semibold break-words" data-testid="recap">
            {recap}
          </p>
          <Button tone="primary" type="submit" disabled={busy} className="min-h-13 text-[17px]">
            {busy ? 'Envoi…' : when === 'now' ? 'Lancer la campagne' : 'Programmer la campagne'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
