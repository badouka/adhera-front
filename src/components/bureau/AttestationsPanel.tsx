'use client';

import { useState } from 'react';
import { Pastille } from '@/components/Pastille';
import { ApiError } from '@/lib/api';
import { fetchDocument, isSessionError, issueAttestation } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import type { IssuedAttestation, MemberAttestation } from '@/lib/bureau/types';
import { formatDate, formatDateTime } from '@/lib/dates';
import { pdfName, ReceiptButton, saveBlob } from './Documents';
import { Button, EmptyState, Notice, Panel } from './ui';

export const NO_LONGER_VALID_HELP =
  'Un encaissement a été annulé, ou la date est dépassée. Prévenez le membre avant qu’il ne présente ce document.';

/**
 * Un refus de délivrance (403 `not_up_to_date`, `not_a_member`,
 * `feature_disabled` ; 409 `issuer_missing`) : son `message` est rédigé en
 * français par le serveur, il s'affiche tel quel. Il n'existe AUCUN forçage.
 */
export function issueErrorMessage(error: unknown): string {
  if (
    error instanceof ApiError &&
    (error.status === 403 || error.status === 409) &&
    error.message.trim()
  ) {
    return error.message;
  }
  return errorMessage(error, 'L’attestation n’a pas pu être délivrée.');
}

/**
 * Les attestations du membre (F4 § 3.2). Le bloc n'existe que si l'option
 * `membership_card` est allumée — c'est la fiche qui en décide.
 *
 * `is_valid` est RECALCULÉ à chaque lecture : une annulation d'encaissement
 * éteint une attestation déjà remise sans que rien ne la touche. L'écran le
 * dit avant que le membre ne l'apprenne de sa banque.
 */
export default function AttestationsPanel({
  attestations,
  memberId,
  canIssue,
  onIssued,
}: {
  attestations: MemberAttestation[];
  memberId: string;
  /** Faux pour un ancien membre : aucun geste ne part de sa fiche. */
  canIssue: boolean;
  onIssued: (issued: IssuedAttestation) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  async function issue() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setPdfError(null);
    let issued: IssuedAttestation;
    try {
      issued = await issueAttestation(memberId);
    } catch (cause) {
      if (!isSessionError(cause)) setError(issueErrorMessage(cause));
      setBusy(false);
      return;
    }
    // La pièce existe : la fiche se recharge, même si le PDF échoue ensuite.
    onIssued(issued);
    try {
      saveBlob(await fetchDocument(issued.document_id), pdfName(issued.reference));
    } catch (cause) {
      if (!isSessionError(cause)) {
        setPdfError(
          errorMessage(
            cause,
            `L’attestation ${issued.reference} est délivrée, mais son PDF n’a pas pu être téléchargé. Réessayez depuis la liste.`,
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Attestations"
      actions={
        canIssue ? (
          <Button tone="secondary" onClick={issue} disabled={busy}>
            {busy ? 'Délivrance…' : 'Délivrer une attestation'}
          </Button>
        ) : null
      }
    >
      {error ? (
        <p role="alert" className="m-0 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late">
          {error}
        </p>
      ) : null}
      {pdfError ? <Notice tone="due">{pdfError}</Notice> : null}

      {attestations.length === 0 ? (
        <EmptyState>Aucune attestation délivrée.</EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {attestations.map((attestation) => {
            const issued = formatDateTime(attestation.issued_at);
            const until = formatDate(attestation.valid_until);
            return (
              <li
                key={attestation.document_id}
                data-valid={attestation.is_valid ? 'true' : 'false'}
                className={`flex flex-col gap-2 rounded-[var(--radius-sm)] border p-3 ${
                  attestation.is_valid ? 'border-line' : 'border-late'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold break-all">{attestation.reference}</span>
                  {attestation.is_valid ? (
                    <Pastille tone="paid">Valide</Pastille>
                  ) : (
                    <Pastille tone="late">Plus valide</Pastille>
                  )}
                </div>
                <span className="small tnum text-ink-muted">
                  {[
                    issued ? `Délivrée le ${issued}` : null,
                    until ? `valable jusqu’au ${until}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {attestation.is_valid ? null : (
                  <p className="small m-0 font-semibold text-late">{NO_LONGER_VALID_HELP}</p>
                )}
                <span>
                  <ReceiptButton
                    receiptId={attestation.document_id}
                    reference={attestation.reference}
                    label="Télécharger l’attestation"
                    failure="L’attestation n’a pas pu être téléchargée."
                    compact
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
