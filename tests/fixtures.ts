import type { MemberPayload } from '@/lib/types';

/**
 * Une charge utile simulée, calquée sur le contrat v3.5.7. Les montants
 * `*_formatted` sont ceux que le serveur rendrait : le client ne les recalcule
 * jamais (R1).
 */
export function payload(overrides: Partial<MemberPayload> = {}): MemberPayload {
  return {
    organisation: {
      name: 'Association Démo',
      logo_url: null,
      om_merchant_number: '77 000 00 00',
      wave_merchant_number: null,
      payment_instructions: null,
    },
    member: { name: 'Awa Diallo', first_name: 'Awa', last_name: 'Diallo' },
    standing: { is_up_to_date: true, covered_until: '2027-03-13' },
    due: null,
    pending_declaration: null,
    last_rejection: null,
    receipts: [],
    ...overrides,
  };
}

/** E3 — une cotisation due, non entamée. */
export const DUE = {
  period_start: '2025-11-05',
  period_end: '2026-11-04',
  period_label: 'du 5 novembre 2025 au 4 novembre 2026',
  category_label: 'Membre actif',
  amount_due: 250000,
  amount_due_formatted: '250 000 FCFA',
  amount_paid: 0,
  amount_paid_formatted: '0 FCFA',
  balance: 250000,
  balance_formatted: '250 000 FCFA',
  status: 'due' as const,
};

/** E3b — une cotisation partiellement réglée. */
export const DUE_PARTIAL = {
  ...DUE,
  amount_paid: 100000,
  amount_paid_formatted: '100 000 FCFA',
  balance: 150000,
  balance_formatted: '150 000 FCFA',
  status: 'partielle' as const,
};

export const TOKEN = 'a'.repeat(64);

/** Une réponse HTTP minimale, suffisante pour `fetchMember`. */
export function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  } as unknown as Response;
}

/** La carte de §16.2 : Aminata Diop, à jour. */
export function memberCard(overrides: Partial<import('@/lib/types').MemberCard> = {}) {
  return {
    organisation_name: 'Cercle des Administrateurs Publics',
    logo_url: 'https://api.eventflow.africa/storage-tenantdemo-asso/membership/logo-1a2b3c4d.png',
    display_name: 'Aminata Diop',
    first_name: 'Aminata',
    last_name: 'Diop',
    type: 'personne',
    category_label: 'Membre actif',
    member_number: '0001',
    member_since: '2026-03-10',
    is_up_to_date: true,
    valid_until: '2027-03-09',
    standing_label: 'À jour',
    verify_url: 'https://demo-asso.adhera.africa/v/5RGF6J9Z2UJX',
    ...overrides,
  };
}

/** Une réponse avec des en-têtes (celle que rend le service worker hors connexion). */
export function fakeResponseWithHeaders(
  status: number,
  body: unknown,
  headers: Record<string, string>,
): Response {
  return { ...fakeResponse(status, body), headers: new Headers(headers) } as unknown as Response;
}
