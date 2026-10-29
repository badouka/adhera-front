'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getMemberLink,
  getWhatsapp,
  isSessionError,
  rotateMemberLink,
} from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import type { MemberLink, WhatsappMessage } from '@/lib/bureau/types';
import { formatDateTime } from '@/lib/dates';
import { ConfirmDialog, Recap } from './ConfirmDialog';
import { CopyAction } from './CopyAction';
import { ChatIcon } from './Icons';
import { Button, buttonClass, Notice, Panel } from './ui';

type Load<T> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; value: T };

/**
 * B8 — le lien du membre.
 *
 * Le jeton est stable : le lien se partage une fois et reste valide.
 * Régénérer, c'est révoquer — l'ancien lien meurt aussitôt —, d'où la
 * confirmation R9.
 */
export function MemberLinkPanel({
  memberId,
  memberName,
  onClose,
}: {
  memberId: string;
  memberName: string;
  onClose: () => void;
}) {
  const [link, setLink] = useState<Load<MemberLink>>({ kind: 'loading' });
  const [whatsapp, setWhatsapp] = useState<Load<WhatsappMessage>>({ kind: 'loading' });
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);

  const loadWhatsapp = useCallback(
    async (signal?: AbortSignal) => {
      setWhatsapp({ kind: 'loading' });
      try {
        setWhatsapp({ kind: 'ready', value: await getWhatsapp(memberId, signal) });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isSessionError(error)) return;
        setWhatsapp({
          kind: 'error',
          message: errorMessage(error, 'Le message WhatsApp n’a pas pu être préparé.'),
        });
      }
    },
    [memberId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setLink({ kind: 'ready', value: await getMemberLink(memberId, controller.signal) });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isSessionError(error)) return;
        setLink({
          kind: 'error',
          message: errorMessage(error, 'Le lien du membre n’a pas pu être chargé.'),
        });
      }
    })();
    void loadWhatsapp(controller.signal);
    return () => controller.abort();
  }, [memberId, loadWhatsapp]);

  async function rotate() {
    if (rotating) return;
    setRotating(true);
    setRotateError(null);
    try {
      const next = await rotateMemberLink(memberId);
      setLink({ kind: 'ready', value: next });
      setConfirming(false);
      setRotated(true);
      // Le message WhatsApp portait l'ancien lien : on le reprépare.
      void loadWhatsapp();
    } catch (error) {
      if (isSessionError(error)) return;
      setRotateError(errorMessage(error, 'Le lien n’a pas pu être régénéré.'));
    } finally {
      setRotating(false);
    }
  }

  return (
    <Panel
      title="Envoyer le lien"
      actions={
        <Button tone="ghost" onClick={onClose}>
          Fermer
        </Button>
      }
    >
      {rotated ? (
        <Notice tone="paid">
          Nouveau lien créé. L’ancien ne fonctionne plus : envoyez celui-ci au membre.
        </Notice>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="label m-0 text-ink-muted">MESSAGE WHATSAPP</h3>
        {whatsapp.kind === 'loading' ? (
          <p className="small m-0 text-ink-muted">Préparation du message…</p>
        ) : null}
        {whatsapp.kind === 'error' ? (
          <p className="small m-0 font-semibold text-late">{whatsapp.message}</p>
        ) : null}
        {whatsapp.kind === 'ready' ? (
          <>
            {/* Rendu en TEXTE, sans normaliser les espaces insécables. */}
            <p className="m-0 rounded-[var(--radius-sm)] border border-line bg-surface p-3 whitespace-pre-line break-words">
              {whatsapp.value.message}
            </p>
            {/* Sans numéro mobile utilisable, l'API ne sert pas de `wa_url` :
                un bouton sans lien ne ferait rien au toucher. */}
            {whatsapp.value.wa_url ? null : (
              <p className="small m-0 font-semibold text-due">
                Aucun numéro WhatsApp utilisable sur la fiche de ce membre.
                Copiez le message pour l’envoyer autrement, ou ajoutez un numéro
                mobile dans son identité.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {whatsapp.value.wa_url ? (
                <a
                  href={whatsapp.value.wa_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass('primary', 'no-underline')}
                >
                  <ChatIcon />
                  Ouvrir WhatsApp
                </a>
              ) : null}
              <CopyAction value={whatsapp.value.message} label="Copier le message" />
            </div>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <h3 className="label m-0 text-ink-muted">LIEN DU MEMBRE</h3>
        {link.kind === 'loading' ? (
          <p className="small m-0 text-ink-muted">Chargement du lien…</p>
        ) : null}
        {link.kind === 'error' ? (
          <p className="small m-0 font-semibold text-late">{link.message}</p>
        ) : null}
        {link.kind === 'ready' ? (
          <>
            <p className="small m-0 font-mono break-all text-ink-muted">{link.value.url}</p>
            {link.value.rotated_at ? (
              <p className="small m-0 text-ink-muted">
                Régénéré le {formatDateTime(link.value.rotated_at)}.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <CopyAction value={link.value.url} label="Copier le lien" />
              <Button onClick={() => setConfirming(true)}>Régénérer le lien</Button>
            </div>
          </>
        ) : null}
        <p className="small m-0 text-ink-muted">
          Ce lien est personnel : il donne accès à la cotisation et aux reçus de
          ce membre.
        </p>
      </div>

      {confirming ? (
        <ConfirmDialog
          title="Régénérer le lien ?"
          confirmLabel="Régénérer le lien"
          confirmTone="danger"
          busy={rotating}
          error={rotateError}
          onConfirm={rotate}
          onCancel={() => {
            setConfirming(false);
            setRotateError(null);
          }}
        >
          <Recap rows={[{ label: 'Membre', value: memberName }]} />
          <p className="m-0">
            L’ancien lien ne fonctionnera plus. Le membre devra recevoir le nouveau.
          </p>
        </ConfirmDialog>
      ) : null}
    </Panel>
  );
}
