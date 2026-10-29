import type { MemberPayload } from '@/lib/types';

/**
 * Une charge utile simulée, calquée sur le contrat v3.5.1. Les montants
 * `*_formatted` sont ceux que le serveur rendrait : le client ne les recalcule
 * jamais (R1).
 */
export function payload(overrides: Partial<MemberPayload> = {}): MemberPayload {
  return {
    organisation: {
      name: 'Association Démo',
      om_merchant_number: '77 000 00 00',
      wave_merchant_number: null,
      payment_instructions: null,
    },
    member: { name: 'Awa Diallo' },
    standing: { is_up_to_date: true, covered_until: '2027-03-13' },
    due: null,
    pending_declaration: null,
    receipts: [],
    ...overrides,
  };
}

/** E3 — une cotisation due, non entamée. */
export const DUE = {
  period_start: '2025-11-05',
  period_end: '2026-11-04',
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
