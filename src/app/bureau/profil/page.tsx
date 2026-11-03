'use client';

import { useEffect, useId, useState } from 'react';
import { useBackBar, useBureau } from '@/components/bureau/BureauContext';
import { Button, inputClass, Notice, PageTitle, Panel, Row, Skeleton } from '@/components/bureau/ui';
import { fieldMessages } from '@/lib/api';
import { getMe, isSessionError, updateMe } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import type { Me } from '@/lib/bureau/types';

/** Les bornes de `PUT admin/me` (§18.7) : l'écran évite l'aller-retour, le serveur tranche. */
const MIN_NAME = 2;
const MAX_NAME = 80;

/**
 * « Mon profil » (§18.7) : lire son nom, son adresse et son rôle, et corriger
 * son NOM — rien d'autre ne se modifie ici. `role_label` est composé par le
 * serveur ; un `422` s'affiche tel quel (il parle français).
 */
export default function ProfilPage() {
  useBackBar({ href: '/bureau/plus', label: 'Plus' });
  const ids = useId();
  const { me: shared, setMe } = useBureau();
  const [fetched, setFetched] = useState<Me | null>(null);
  const me = shared ?? fetched;
  const [failed, setFailed] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Le cadre a déjà lu `admin/me` ; on le relit si ce n'est pas fait.
  useEffect(() => {
    if (shared) {
      setName((current) => current || shared.name);
      return;
    }
    const controller = new AbortController();
    getMe(controller.signal)
      .then((value) => {
        setFetched(value);
        setMe(value);
        setName((current) => current || value.name);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (isSessionError(cause)) return;
        setFailed(errorMessage(cause, 'Votre profil n’a pas pu être chargé.'));
      });
    return () => controller.abort();
  }, [shared, setMe]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const clean = name.replace(/\s+/g, ' ').trim();
    if (clean.length < MIN_NAME) {
      setError(
        clean === ''
          ? 'Écrivez votre nom : il apparaît sur les reçus que vous émettez.'
          : `Votre nom doit faire au moins ${MIN_NAME} caractères.`,
      );
      return;
    }
    if (clean.length > MAX_NAME) {
      setError(`Votre nom ne peut pas dépasser ${MAX_NAME} caractères.`);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const updated = await updateMe(clean);
      const next = { name: updated.name, email: updated.email, role: updated.role, role_label: updated.role_label };
      setFetched(next);
      setMe(next);
      setName(updated.name);
      setSaved(updated.message?.trim() || 'Votre nom a été enregistré.');
    } catch (cause) {
      if (isSessionError(cause)) return;
      setError(fieldMessages(cause).name ?? errorMessage(cause, 'Votre nom n’a pas été modifié.'));
    } finally {
      setBusy(false);
    }
  }

  if (failed) return <Notice tone="late">{failed}</Notice>;
  if (!me) return <Skeleton label="Chargement de votre profil…" />;

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4">
      <PageTitle title="Mon profil" />
      <Panel>
        <dl className="m-0 flex flex-col gap-2">
          <Row label="Adresse de connexion">{me.email}</Row>
          <Row label="Rôle">{me.role_label}</Row>
        </dl>
      </Panel>
      <form onSubmit={submit} noValidate className="m-0 flex flex-col gap-3">
        <div className="flex flex-col gap-[6px]">
          <label htmlFor={`${ids}-name`} className="font-semibold">
            Votre nom
          </label>
          <input
            id={`${ids}-name`}
            value={name}
            maxLength={120}
            autoComplete="name"
            onChange={(e) => {
              setName(e.target.value);
              setSaved(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${ids}-hint${error ? ` ${ids}-error` : ''}`}
            className={inputClass(!!error, 'min-h-12 text-[18px]')}
          />
          <span id={`${ids}-hint`} className="small text-ink-muted">
            Il apparaît sur les reçus que vous émettez. Écrivez-le comme vous voulez
            qu’on le lise.
          </span>
          {error ? (
            <span id={`${ids}-error`} role="alert" className="small font-semibold text-late">
              {error}
            </span>
          ) : null}
        </div>
        {saved ? <Notice tone="paid">{saved}</Notice> : null}
        <Button type="submit" tone="primary" disabled={busy} className="min-h-12 self-start px-6">
          {busy ? 'Enregistrement…' : 'Enregistrer mon nom'}
        </Button>
      </form>
    </div>
  );
}
