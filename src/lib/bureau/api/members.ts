/**
 * Les membres : registre, fiche, lien, message WhatsApp, contacts (§5).
 */

import { request } from './core';
import type { Contact, ContactInput, DecidedMember, FileLink, LeftReason, MemberDetail, MemberFilters, MemberInput, MemberLink, MemberListItem, WhatsappMessage } from '../types';

/* ────────────────────────────── Membres ───────────────────────────── */

const seg = encodeURIComponent;

export function listMembers(filters: MemberFilters, signal?: AbortSignal) {
  return request<MemberListItem[]>('membership/members', {
    query: { ...filters },
    signal,
  });
}

export function getMember(id: string, signal?: AbortSignal) {
  return request<MemberDetail>(`membership/members/${seg(id)}`, { signal });
}

export function createMember(input: MemberInput) {
  return request<MemberDetail>('membership/members', { method: 'POST', json: input });
}

export function updateMember(id: string, input: MemberInput) {
  return request<MemberDetail>(`membership/members/${seg(id)}`, {
    method: 'PUT',
    json: input,
  });
}

export function leaveMember(id: string, leftAt: string, reason: LeftReason) {
  // Le champ s'appelle bien `left_reason` : un `reason` est rejeté en 422.
  return request<MemberDetail>(`membership/members/${seg(id)}/leave`, {
    method: 'POST',
    json: { left_at: leftAt, left_reason: reason },
  });
}

export function getMemberLink(id: string, signal?: AbortSignal) {
  return request<MemberLink>(`membership/members/${seg(id)}/link`, { signal });
}

export function rotateMemberLink(id: string) {
  return request<MemberLink>(`membership/members/${seg(id)}/link/rotate`, {
    method: 'POST',
  });
}

export function getWhatsapp(id: string, signal?: AbortSignal) {
  return request<WhatsappMessage>(`membership/members/${seg(id)}/whatsapp`, {
    signal,
  });
}

export function createContact(memberId: string, input: ContactInput) {
  return request<Contact>(`membership/members/${seg(memberId)}/contacts`, {
    method: 'POST',
    json: input,
  });
}

export function deleteContact(memberId: string, contactId: string) {
  return request<{ deleted: boolean }>(
    `membership/members/${seg(memberId)}/contacts/${seg(contactId)}`,
    { method: 'DELETE' },
  );
}

/* ───────────────────── Les demandes d'adhésion (§17.6) ───────────────────── */

/**
 * « Admettre » : aucun corps. La réponse est la fiche, plus `share`, le message
 * de bienvenue — le canal RÉEL d'un candidat sans e-mail, à proposer juste
 * après. `409 not_a_candidate` nomme l'état du membre dans son message.
 */
export function admitApplication(id: string) {
  return request<DecidedMember>(`membership/members/${seg(id)}/admit`, { method: 'POST' });
}

/**
 * « Refuser la demande » : un motif de 10 caractères au moins, écrit POUR le
 * candidat. AUCUN message ne part tout seul : `share` est proposé, jamais
 * envoyé par le serveur. `409 payment_already_accepted` si un paiement l'a déjà
 * admis.
 */
export function rejectApplication(id: string, reason: string) {
  return request<DecidedMember>(`membership/members/${seg(id)}/reject-application`, {
    method: 'POST',
    json: { reason },
  });
}

/**
 * §21.5 — le lien d'une pièce justificative, à demander AU CLIC : il vit
 * 5 minutes, et n'est jamais servi dans une liste.
 */
export function getFileLink(uuid: string) {
  return request<FileLink>(`membership/files/${seg(uuid)}/url`);
}
