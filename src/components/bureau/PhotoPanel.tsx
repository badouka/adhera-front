'use client';

import { useState } from 'react';
import { fieldMessages } from '@/lib/api';
import { isSessionError } from '@/lib/bureau/api/core';
import { deletePhoto, uploadPhoto } from '@/lib/bureau/api/members';
import { errorMessage } from '@/lib/bureau/messages';
import { MAX_FILE_BYTES, PHOTO_ACCEPT, TOO_LARGE } from '@/lib/files';
import { MemberPhoto } from './Answers';
import { Button, Panel } from './ui';

/**
 * §21.2 — la photo d'un membre, déposée par le bureau (pour quelqu'un qui n'a
 * pas de téléphone), ou retirée. Le serveur la recadre et la ré-encode : rien
 * n'est recadré ici. ⚠️ Retirer supprime le FICHIER pour de bon — une photo
 * n'est la trace d'aucune décision ; l'écran le dit avant de le faire.
 */
export function PhotoPanel({
  memberId,
  memberName,
  photoUrl,
  onChanged,
  onClose,
}: {
  memberId: string;
  memberName: string;
  photoUrl: string | null;
  /** Après un envoi ou un retrait : la fiche est relue (le lien est signé). */
  onChanged: (message: string) => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function send() {
    if (!file || busy) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(TOO_LARGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadPhoto(memberId, file);
      onChanged('Photo enregistrée. Elle figure sur sa carte de membre.');
    } catch (cause) {
      if (!isSessionError(cause)) {
        setError(fieldMessages(cause).photo ?? errorMessage(cause, 'La photo n’a pas pu être enregistrée.'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deletePhoto(memberId);
      onChanged('Photo retirée.');
    } catch (cause) {
      if (!isSessionError(cause)) setError(errorMessage(cause, 'La photo n’a pas pu être retirée.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="flex flex-col gap-3" data-testid="photo-panel">
        {photoUrl ? (
          <MemberPhoto url={photoUrl} name={memberName} size={120} />
        ) : (
          <p className="m-0 text-ink-muted">Pas encore de photo.</p>
        )}
        <label className="flex flex-col gap-[6px]">
          <span className="font-semibold">{photoUrl ? 'Une nouvelle photo' : 'Sa photo'}</span>
          <span className="small text-ink-muted">
            JPEG, PNG ou WebP, 5 Mo au plus. Elle sera recadrée en carré, au centre.
          </span>
          <input
            type="file"
            accept={PHOTO_ACCEPT}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
            className="min-h-11 w-full min-w-0 rounded-[var(--radius-sm)] border border-line-strong bg-surface-raised px-3 py-2"
          />
        </label>
        {error ? (
          <p role="alert" className="m-0 font-semibold text-late">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button tone="primary" disabled={!file || busy} onClick={() => void send()}>
            {busy ? 'Envoi…' : 'Enregistrer cette photo'}
          </Button>
          <Button tone="ghost" disabled={busy} onClick={onClose}>
            Fermer
          </Button>
        </div>
        {photoUrl ? (
          confirmDelete ? (
            <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border-2 border-late bg-late-soft p-3" role="alertdialog" aria-label="Retirer la photo">
              <p className="m-0 font-semibold">
                Retirer la photo de {memberName} ? Le fichier est supprimé pour de bon : sa carte n’aura
                plus de photo.
              </p>
              <span className="flex flex-wrap gap-2">
                <Button tone="danger" disabled={busy} onClick={() => void remove()}>
                  Retirer la photo
                </Button>
                <Button disabled={busy} onClick={() => setConfirmDelete(false)}>
                  Annuler
                </Button>
              </span>
            </div>
          ) : (
            <span>
              <Button tone="ghost" className="px-0 text-late!" onClick={() => setConfirmDelete(true)}>
                Retirer la photo
              </Button>
            </span>
          )
        ) : null}
      </div>
    </Panel>
  );
}
