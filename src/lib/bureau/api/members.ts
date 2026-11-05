/**
 * Les membres : registre, fiche, lien, message WhatsApp, contacts (§5).
 */

import { request } from './core';
import type { Contact, ContactInput, LeftReason, MemberDetail, MemberFilters, MemberInput, MemberLink, MemberListItem, WhatsappMessage } from '../types';

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
