'use client';

import { useState } from 'react';
import { DownloadIcon } from '@/components/Icons';
import { fetchDocument, getProofUrl, isSessionError } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import { EyeIcon } from './Icons';
import { buttonClass } from './ui';

/**
 * Remet un blob au navigateur sous un nom de fichier. L'URL `blob:` est
 * révoquée après coup ; le délai laisse aux navigateurs mobiles le temps de
 * démarrer le téléchargement.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Un nom de fichier sûr, dérivé de la référence servie (`REC-2026-…`). */
function pdfName(reference: string): string {
  const safe = reference.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'recu'}.pdf`;
}

/**
 * « Télécharger le reçu ». `GET documents/{id}/pdf` exige le Bearer : le PDF
 * est tiré par le client, jamais par un lien nu. Le PDF est généré à la
 * demande côté serveur : deux clics rendent le même document.
 */
export function ReceiptButton({
  receiptId,
  reference,
  label = 'Télécharger le reçu',
  tone = 'secondary',
  compact = false,
}: {
  receiptId: string;
  reference: string;
  label?: string;
  tone?: 'primary' | 'secondary' | 'ghost';
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await fetchDocument(receiptId);
      saveBlob(blob, pdfName(reference));
    } catch (cause) {
      if (!isSessionError(cause)) {
        setError(errorMessage(cause, 'Le reçu n’a pas pu être téléchargé.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        aria-label={compact ? `${label} ${reference}` : undefined}
        className={buttonClass(tone, compact ? 'min-h-10 px-3 small' : '')}
      >
        <DownloadIcon size={18} />
        {busy ? 'Téléchargement…' : compact ? reference : label}
      </button>
      {error ? (
        <span role="alert" className="small font-semibold text-late">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * « Voir la capture » jointe par le membre. Le lien signé vit 60 minutes : il est demandé AU
 * CLIC, jamais au chargement de la liste, et ouvert tel quel — toute
 * retouche (paramètre ajouté, recomposition) invalide sa signature.
 *
 * Les navigateurs mobiles bloquent un `window.open` lancé après un `await` :
 * l'onglet est donc ouvert tout de suite, coupé de `opener` (l'équivalent de
 * `noopener`), puis dirigé vers le lien quand il arrive. Si l'onglet a été
 * bloqué malgré tout, un lien `noopener noreferrer` prend le relais.
 */
export function ProofButton({ paymentId }: { paymentId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFallbackUrl(null);

    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;

    try {
      const url = await getProofUrl(paymentId);
      if (tab && !tab.closed) tab.location.replace(url);
      else setFallbackUrl(url);
    } catch (cause) {
      tab?.close();
      if (!isSessionError(cause)) {
        setError(errorMessage(cause, 'La capture n’a pas pu être ouverte.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={buttonClass('secondary')}
      >
        <EyeIcon />
        {busy ? 'Ouverture…' : 'Voir la capture'}
      </button>
      {fallbackUrl ? (
        <a
          href={fallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="small font-semibold"
        >
          Ouvrir la capture dans un nouvel onglet
        </a>
      ) : null}
      {error ? (
        <span role="alert" className="small font-semibold text-late">
          {error}
        </span>
      ) : null}
    </span>
  );
}
