'use client';

import { useRef, useState } from 'react';
import { ApiError, fieldMessages, uploadMemberPhoto } from '@/lib/api';
import { MAX_FILE_BYTES, PHOTO_ACCEPT, TOO_LARGE } from '@/lib/files';

/**
 * §21.2 — « Ajouter ma photo » / « Changer ma photo », sur la page du membre.
 * Le fichier part dès qu'il est choisi ; le serveur le recadre et le ré-encode
 * (rien n'est recadré ici), puis la page se relit pour montrer la photo telle
 * qu'elle figurera sur la carte. Le message de l'API s'affiche tel quel.
 */
export function PhotoUpload({
  token,
  tenant,
  hasPhoto,
  onChanged,
}: {
  token: string;
  tenant: string;
  hasPhoto: boolean;
  /** Relire la page : `photo_url` est un lien signé, il se redemande. */
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function send(file: File | undefined) {
    if (!file || busy) return;
    setError(null);
    setDone(null);
    if (file.size > MAX_FILE_BYTES) {
      setError(TOO_LARGE);
      return;
    }
    setBusy(true);
    try {
      const result = await uploadMemberPhoto(token, tenant, file);
      setDone(result.message?.trim() || 'Votre photo a bien été enregistrée.');
      onChanged();
    } catch (cause) {
      const fields = fieldMessages(cause);
      setError(
        fields.photo ??
          (cause instanceof ApiError && cause.status === 429
            ? 'Trop d’envois de photo : réessayez dans une heure.'
            : cause instanceof ApiError && cause.code && cause.message
              ? cause.message
              : 'Votre photo n’a pas pu être envoyée. Réessayez dans un instant.'),
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void send(e.target.files?.[0])}
        data-testid="photo-input"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="self-start bg-transparent p-0 text-left font-semibold text-link underline underline-offset-2 disabled:opacity-60"
      >
        {busy ? 'Envoi de la photo…' : hasPhoto ? 'Changer ma photo' : 'Ajouter ma photo'}
      </button>
      {done ? (
        <span role="status" className="small font-semibold text-paid">
          {done}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="small font-semibold text-late">
          {error}
        </span>
      ) : null}
    </div>
  );
}
