'use client';

import { useCallback, useEffect, useState } from 'react';
import { useBackBar, useBureau } from '@/components/bureau/BureauContext';
import { associationName } from '@/components/bureau/BureauFrame';
import { CopyAction } from '@/components/bureau/CopyAction';
import { ChatIcon } from '@/components/bureau/Icons';
import { bigButtonClass, Button, Notice, Toast } from '@/components/bureau/ui';
import { fieldMessages } from '@/lib/api';
import { isSessionError } from '@/lib/bureau/api/core';
import { setAdmissionMode, updateJoinForm } from '@/lib/bureau/api/settings';
import { errorMessage } from '@/lib/bureau/messages';
import { hasMembershipJoin, type AdmissionMode, type EmailMode, type Settings } from '@/lib/bureau/types';
import { whatsappLink } from '@/lib/whatsapp';

/** §20.5 — la borne du mot d'accueil, celle du serveur (`join_intro`, 300). */
export const INTRO_MAX = 300;

const BACK = { href: '/bureau/plus', label: 'Plus' };

export const ADMISSION_CHOICES: ReadonlyArray<{ value: AdmissionMode; title: string }> = [
  { value: 'bureau', title: 'Le bureau examine chaque demande' },
  { value: 'premier_paiement', title: 'Toute personne qui paie sa première cotisation' },
];

export const EMAIL_CHOICES: ReadonlyArray<{ value: EmailMode; label: string }> = [
  { value: 'hidden', label: 'Ne pas la demander' },
  { value: 'optional', label: 'Facultative' },
  { value: 'required', label: 'Obligatoire' },
];

/** Ce que dit chaque mode, au moment où le bureau choisit (maquette). */
export function admissionHint(mode: AdmissionMode, settings: Settings): string {
  if (mode === 'premier_paiement') return 'Pas d’examen : le paiement accepté fait le membre.';
  const mail = settings.application_notifications_enabled === false ? '' : 'Vous recevez un e-mail à chaque demande. ';
  return `${mail}La personne paie une fois admise. C’est le réglage conseillé.`;
}

/** Le message du bureau dans ses groupes : le nom, le sigle s'il existe, et le lien. */
export function joinShareText(settings: Settings, url: string): string {
  const name = associationName(settings);
  const sigle = settings.short_name?.trim();
  const who = sigle && sigle !== name ? `${sigle} (${name})` : name;
  return `Vous voulez adhérer à ${who || 'notre association'} ? Remplissez votre demande ici, en deux minutes :\n${url}`;
}

const CHOICE =
  'flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-line-strong bg-surface-raised p-4 has-[:checked]:border-2 has-[:checked]:border-indigo has-[:checked]:bg-indigo-soft';

/**
 * « L'adhésion en ligne » (F6 § 5) : le lien à partager, « Qui devient
 * membre ? », et les trois réglages du formulaire. Chaque choix s'enregistre
 * au choix, sans bouton ; seul le mot d'accueil, qui se tape, a le sien.
 *
 * Fonctionnalité éteinte (`features.membership_join`) : l'écran le dit, et ne
 * propose AUCUN lien — il mènerait à une page introuvable (§17.1).
 */
export default function AdhesionEnLignePage() {
  useBackBar(BACK);
  const { settings, setSettings } = useBureau();
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');
  const [intro, setIntro] = useState(settings.join_intro ?? '');
  const [introError, setIntroError] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => setOrigin(window.location.origin), []);

  const open = hasMembershipJoin(settings);
  const mode = settings.admission_mode ?? 'bureau';
  const emailMode = settings.join_email_mode ?? 'optional';
  const askRegion = settings.join_ask_region ?? true;
  const savedIntro = settings.join_intro ?? '';
  const joinUrl = origin ? `${origin}/adherer` : '';

  async function save(run: () => Promise<Settings>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSettings(await run());
      setToast('C’est enregistré.');
    } catch (cause) {
      if (!isSessionError(cause)) {
        const fields = fieldMessages(cause);
        setError(Object.values(fields)[0] ?? errorMessage(cause, 'Ce réglage n’a pas pu être enregistré.'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveIntro() {
    setIntroError(null);
    if (busy) return;
    setBusy(true);
    try {
      const next = await updateJoinForm({ join_intro: intro.trim() === '' ? null : intro.trim() });
      setSettings(next);
      setIntro(next.join_intro ?? '');
      setToast('Le mot d’accueil est enregistré.');
    } catch (cause) {
      if (!isSessionError(cause)) {
        setIntroError(fieldMessages(cause).join_intro ?? errorMessage(cause, 'Le mot d’accueil n’a pas pu être enregistré.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-5">
      <h1 className="title m-0">L’adhésion en ligne</h1>

      {open ? (
        <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4" data-testid="join-link">
          <h2 className="heading m-0">Le lien pour adhérer</h2>
          <p className="m-0">
            Partagez-le dans vos groupes WhatsApp : chacun peut demander à adhérer en deux minutes,
            depuis son téléphone.
          </p>
          {joinUrl ? (
            <>
              <a
                href={whatsappLink(joinShareText(settings, joinUrl))}
                target="_blank"
                rel="noopener noreferrer"
                className={bigButtonClass('primary')}
              >
                <ChatIcon size={22} />
                Partager le lien sur WhatsApp
              </a>
              <CopyAction value={joinUrl} label="Copier le lien pour adhérer" />
              <a href="/adherer" target="_blank" rel="noopener noreferrer" className="self-center p-[10px] text-[15px] font-semibold underline underline-offset-2">
                Voir la page, comme un visiteur la voit
              </a>
            </>
          ) : null}
        </section>
      ) : (
        <div data-testid="join-closed">
          <Notice tone="due">
            L’adhésion en ligne n’est pas ouverte pour votre association : il n’y a pas encore de lien
            à partager.
          </Notice>
        </div>
      )}

      {error ? <Notice tone="late">{error}</Notice> : null}

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0" disabled={busy}>
        <legend className="heading mb-3 p-0">Qui devient membre ?</legend>
        {ADMISSION_CHOICES.map((choice) => (
          <label key={choice.value} className={CHOICE}>
            <input
              type="radio"
              name="admission"
              checked={mode === choice.value}
              onChange={() => void save(() => setAdmissionMode(choice.value))}
              className="mt-1 size-5 shrink-0 accent-indigo"
            />
            <span className="flex flex-col gap-1">
              <b>{choice.title}</b>
              <span className="small text-ink-muted">{admissionHint(choice.value, settings)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <section className="flex flex-col gap-4">
        <h2 className="heading m-0">Le formulaire</h2>

        <div className="flex flex-col gap-[6px]">
          <label htmlFor="mot-accueil" className="font-semibold">
            Le mot d’accueil <span className="font-normal text-ink-muted">(facultatif)</span>
          </label>
          <textarea
            id="mot-accueil"
            rows={3}
            value={intro}
            onChange={(e) => {
              setIntro(e.target.value);
              setIntroError(null);
            }}
            aria-describedby="mot-accueil-aide"
            aria-invalid={introError ? true : undefined}
            className={`min-h-24 w-full rounded-[var(--radius-sm)] border bg-surface-raised px-3 py-2 ${introError ? 'border-late' : 'border-line-strong'}`}
          />
          <span id="mot-accueil-aide" className={`small ${intro.length > INTRO_MAX ? 'font-semibold text-late' : 'text-ink-muted'}`}>
            {intro.length} / {INTRO_MAX} — il s’affiche sous le titre de la page « Adhérer ».
          </span>
          {introError ? <span className="small font-semibold text-late">{introError}</span> : null}
          <span>
            <Button disabled={busy || intro.trim() === savedIntro.trim()} onClick={() => void saveIntro()}>
              Enregistrer le mot d’accueil
            </Button>
          </span>
        </div>

        <label className="flex min-h-12 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={askRegion}
            disabled={busy}
            onChange={(e) => void save(() => updateJoinForm({ join_ask_region: e.target.checked }))}
            className="size-5 shrink-0 accent-indigo"
          />
          <span>Demander la région</span>
        </label>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={busy}>
          <legend className="mb-2 p-0 font-semibold">L’adresse e-mail</legend>
          {EMAIL_CHOICES.map((choice) => (
            <label key={choice.value} className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="email-mode"
                checked={emailMode === choice.value}
                onChange={() => void save(() => updateJoinForm({ join_email_mode: choice.value }))}
                className="size-5 shrink-0 accent-indigo"
              />
              <span>{choice.label}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}
