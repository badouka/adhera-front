/**
 * Les pièces émises : reçus et attestations (§7, §16.4).
 */

import { request } from './core';
import type { IssuedAttestation } from '../types';

const seg = encodeURIComponent;

/* ──────────────────────────── Pièces émises ───────────────────────── */

/**
 * `GET membership/documents/{id}/pdf`. La route exige le Bearer : un simple
 * `<a href>` ne peut pas le porter, on tire donc le PDF en blob.
 */
export function fetchDocument(id: string) {
  return request<Blob>(`membership/documents/${seg(id)}/pdf`, { as: 'blob' });
}

/**
 * `POST members/{id}/attestation` (§16.4) : rend la PIÈCE ; son PDF passe par
 * `documents/{document_id}/pdf`, la route des reçus. Aucun forçage : un membre
 * pas à jour ou non actif est refusé (403), pour le bureau comme pour lui.
 */
export function issueAttestation(memberId: string) {
  return request<IssuedAttestation>(`membership/members/${seg(memberId)}/attestation`, {
    method: 'POST',
  });
}
