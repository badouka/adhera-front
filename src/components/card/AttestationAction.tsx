'use client';

import { useState } from 'react';
import { DownloadIcon } from '@/components/Icons';
import { ApiError, attestationUrl, checkAttestation } from '@/lib/api';
import { browser } from '@/lib/navigate';

export const ATTESTATION_WAIT =
  'Votre attestation sera disponible dès que votre cotisation sera réglée.';

/**
 * Les refus que le serveur rédige POUR LE MEMBRE (§16.3, v3.8.1) : leur
 * `message` s'affiche tel quel. R4 : on reconnaît le `code`, jamais le texte.
 */
const MEMBER_FACING_CODES = new Set([
  'not_up_to_date',
  'not_a_member',
  'feature_disabled',
  'issuer_missing',
  'member_not_found',
]);

export function attestationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && MEMBER_FACING_CODES.has(error.code) && error.message.trim()) {
      return error.message;
    }
    if (error.status === 0) {
      return 'Connexion impossible. Vérifiez votre réseau, puis réessayez.';
    }
    if (error.status === 429) return 'Trop de tentatives, réessayez dans une minute.';
  }
  return 'Votre attestation n’a pas pu être téléchargée. Réessayez dans un instant.';
}

/**
 * « Télécharger mon attestation » (F4 § 1.3).
 *
 * C'est `attestation_available` — et lui seul — qui fait exister le bouton.
 * Le lien est celui d'un reçu (le tenant en query, `rel="noreferrer"`) ; avant
 * de le suivre, on vérifie que le serveur rend bien le PDF, pour qu'un refus
 * s'affiche ici, en mots, au lieu d'une page de JSON.
 */
export function AttestationAction({
  token,
  tenant,
  available,
  upToDate,
}: {
  token: string;
  tenant: string;
  available: boolean;
  upToDate: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!available) {
    return upToDate ? null : (
      <p className="m-0 text-center text-ink-muted" data-testid="attestation-wait">
        {ATTESTATION_WAIT}
      </p>
    );
  }

  const href = attestationUrl(token, tenant);

  async function open(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await checkAttestation(token, tenant);
      browser.open(href);
    } catch (cause) {
      setError(attestationErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <a
        href={href}
        rel="noreferrer"
        onClick={open}
        aria-disabled={busy || undefined}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-indigo text-[18px] font-bold text-on-indigo no-underline"
      >
        <DownloadIcon size={22} />
        {busy ? 'Préparation…' : 'Télécharger mon attestation'}
      </a>
      {error ? (
        <p role="alert" className="m-0 rounded-[var(--radius-md)] bg-late-soft p-3 font-semibold text-late">
          {error}
        </p>
      ) : null}
    </div>
  );
}
