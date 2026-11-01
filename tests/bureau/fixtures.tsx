import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import {
  BureauContext,
  type BureauContextValue,
} from '@/components/bureau/BureauContext';
import type { BureauSession } from '@/lib/bureau/session';
import type {
  Campaign,
  Category,
  Dashboard,
  MemberDetail,
  MemberListItem,
  OutreachItem,
  Payment,
  Settings,
} from '@/lib/bureau/types';

/**
 * Les charges utiles du contrat bureau v3.5.7, recopiées des réponses réelles
 * de `demo-asso` (`_handoff/adhera-api-bureau.md`). Les `*_formatted` sont ceux
 * que le serveur rend : le client ne les recalcule jamais (R1).
 */

export const TOKEN = 'bureau-token-de-test';

export const SESSION: BureauSession = {
  token: TOKEN,
  tenant: 'demo-asso',
  admin: { id: 3, name: 'Trésorier Démo', email: 'tresorier@demo-asso.test', role: 'tresorier' },
};

export function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    issuer_name: 'Association Démo',
    logo_url: 'https://api.eventflow.africa/storage-tenantdemo-asso/membership/logo-e40fd0e4.png',
    member_types: 'mixte',
    mode_cotisation: 'anniversaire',
    om_merchant_number: '771234567',
    wave_merchant_number: '761234567',
    payment_instructions: 'Orange Money ou Wave au 77 123 45 67.',
    timezone: 'Africa/Dakar',
    metadata: null,
    mode_is_supported: true,
    ...overrides,
  };
}

export function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '01a1893f-d5b7-707e-9a64-6f65cb4a73ae',
    due_id: '01a18799-ba5b-7245-b6c5-c2025c5f4764',
    member_id: '01a18799-0a3e-702e-936a-68c61af98554',
    member_name: 'Moussa Ndiaye (test)',
    amount: 100000,
    amount_formatted: '100 000 FCFA',
    method: 'wave',
    method_label: 'Wave',
    reference: 'TEST-F1',
    paid_on: '2026-10-29',
    status: 'declared',
    declared_at: '2026-10-29T20:00:24+00:00',
    decided_at: null,
    decided_by_user_id: null,
    decided_by_name: null,
    rejection_reason: null,
    has_proof: true,
    receipt: null,
    due: { period_start: '2026-10-01', period_end: '2027-09-30', status: 'partielle' },
    ...overrides,
  };
}

export function memberItem(overrides: Partial<MemberListItem> = {}): MemberListItem {
  return {
    id: '01a18799-0a3e-702e-936a-68c61af98554',
    type: 'personne',
    name: 'Moussa Ndiaye (test)',
    first_name: 'Moussa',
    last_name: 'Ndiaye (test)',
    phone: '775695563',
    email: null,
    region: 'Dakar',
    category_id: 1,
    category_label: 'Membre actif',
    joined_at: '2024-10-01',
    status: 'active',
    left_at: null,
    left_reason: null,
    is_up_to_date: false,
    covered_until: null,
    next_due_date: '2026-10-01',
    balance_due: 150000,
    balance_due_formatted: '150 000 FCFA',
    ...overrides,
  };
}

export const ORGANISATION: MemberListItem = memberItem({
  id: '01a18799-0a46-7321-befc-4c55c08110b7',
  type: 'organisation',
  name: 'Agence Test Conseil (test)',
  first_name: null,
  last_name: null,
  phone: null,
  email: 'badouka+m3@gmail.com',
  joined_at: '2024-06-01',
  next_due_date: '2026-06-01',
  balance_due: null,
  balance_due_formatted: null,
});

export function memberDetail(overrides: Partial<MemberDetail> = {}): MemberDetail {
  return {
    ...memberItem(),
    contacts: [],
    dues: [
      {
        id: '01a18799-ba5b-7245-b6c5-c2025c5f4764',
        period_start: '2026-10-01',
        period_end: '2027-09-30',
        due_date: '2026-10-01',
        status: 'partielle',
        origin: 'platform',
        amount_due: 250000,
        amount_due_formatted: '250 000 FCFA',
        amount_paid: 100000,
        amount_paid_formatted: '100 000 FCFA',
        balance_due: 150000,
        balance_due_formatted: '150 000 FCFA',
        settled_at: null,
        receipts: [
          {
            id: '01a18940-c9a5-71ec-970d-9d7510492173',
            reference: 'REC-2026-CB4A73AE',
            issued_at: '2026-10-29T20:01:26+00:00',
            cancelled_at: null,
            amount_formatted: '100 000 FCFA',
          },
        ],
        receipt_available: true,
      },
    ],
    ...overrides,
  };
}

export const CATEGORIES: Category[] = [
  { id: 2, label: 'Bienfaiteur', mode: 'forfait', amount: 500000, amount_formatted: '500 000 FCFA', sort_order: 0, is_active: true, is_calculable: true },
  { id: 3, label: 'Honoraire', mode: 'exonere', amount: null, amount_formatted: null, sort_order: 0, is_active: true, is_calculable: true },
  { id: 1, label: 'Membre actif', mode: 'forfait', amount: 250000, amount_formatted: '250 000 FCFA', sort_order: 0, is_active: true, is_calculable: true },
];

/**
 * Un texte coupé par des balises (un montant dans `<span class="money">`) :
 * l'élément le plus profond dont le texte complet vaut `text`.
 */
export function fullText(text: string) {
  return (_: string, el: Element | null) =>
    !!el &&
    el.textContent === text &&
    !Array.from(el.children).some((child) => child.textContent === text);
}

/** Une réponse HTTP minimale. */
export function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
    blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
    headers: new Headers(headers),
  } as unknown as Response;
}

type Route = {
  method?: string;
  /** Sous-chaîne de l'URL (après `/api/v1/admin/`). */
  match: string | RegExp;
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
};

/**
 * Un faux serveur : chaque appel est servi par la PREMIÈRE route qui
 * correspond (méthode + URL). Les appels restent lisibles dans `fetchMock`.
 */
export function fakeServer(routes: Route[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.replace('https://api.eventflow.africa/api/v1/admin/', '');
    const route = routes.find(
      (r) =>
        (r.method ?? 'GET').toUpperCase() === method &&
        (typeof r.match === 'string' ? path.startsWith(r.match) : r.match.test(path)),
    );
    if (!route) throw new Error(`Route non simulée : ${method} ${path}`);
    return fakeResponse(route.status ?? 200, route.body, route.headers);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function calls(fetchMock: ReturnType<typeof vi.fn>, method = 'GET') {
  return fetchMock.mock.calls
    .filter((c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method)
    .map((c) => ({ url: c[0] as string, init: c[1] as RequestInit }));
}

/** Rend un écran du bureau dans son contexte (session + réglages). */
export function renderInBureau(
  ui: ReactElement,
  overrides: Partial<BureauContextValue> = {},
) {
  const value: BureauContextValue = {
    session: SESSION,
    settings: settings(),
    setSettings: vi.fn(),
    modeSupported: true,
    markModeUnsupported: vi.fn(),
    ...overrides,
  };
  return { value, ...render(<BureauContext.Provider value={value}>{ui}</BureauContext.Provider>) };
}

/* ───────────────────────────── F3 (§9 à §11) ───────────────────────────── */

const MONTHS = [
  ['2025-12', 'décembre 2025'], ['2026-01', 'janvier 2026'], ['2026-02', 'février 2026'],
  ['2026-03', 'mars 2026'], ['2026-04', 'avril 2026'], ['2026-05', 'mai 2026'],
  ['2026-06', 'juin 2026'], ['2026-07', 'juillet 2026'], ['2026-08', 'août 2026'],
  ['2026-09', 'septembre 2026'], ['2026-10', 'octobre 2026'], ['2026-11', 'novembre 2026'],
] as const;

/**
 * La charge de `GET dashboard` (§10). Les nombres bruts sont VOLONTAIREMENT
 * différents de leurs `*_formatted` : un écran qui afficherait le nombre brut,
 * ou le reformaterait, se verrait.
 */
export function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    period: { from: '2026-01-01', to: '2026-11-01' },
    members: { active: 5, up_to_date: 3, not_up_to_date: 2, pending: 1, former: 1 },
    money: {
      collected: 350001,
      collected_formatted: '350 000 FCFA',
      declared_pending: 50001,
      declared_pending_formatted: '50 000 FCFA',
      declared_pending_count: 1,
      outstanding: 650001,
      outstanding_formatted: '650 000 FCFA',
      outstanding_unknown_count: 0,
      recovery_rate: 60,
    },
    by_category: [
      { category_id: 1, label: 'Membre actif', members: 4, up_to_date: 2, collected: 350001, collected_formatted: '350 000 FCFA' },
      { category_id: null, label: 'Sans catégorie', members: 1, up_to_date: 1, collected: 0, collected_formatted: '0 FCFA' },
    ],
    by_method: [
      { method: 'om', label: 'Orange Money', collected: 0, collected_formatted: '0 FCFA' },
      { method: 'wave', label: 'Wave', collected: 250001, collected_formatted: '250 000 FCFA' },
      { method: 'virement', label: 'Virement bancaire', collected: 0, collected_formatted: '0 FCFA' },
      { method: 'cheque', label: 'Chèque', collected: 0, collected_formatted: '0 FCFA' },
      { method: 'especes', label: 'Espèces', collected: 100001, collected_formatted: '100 000 FCFA' },
    ],
    evolution: MONTHS.map(([month, label]) =>
      month === '2026-03'
        ? { month, label, collected: 250001, collected_formatted: '250 000 FCFA' }
        : month === '2026-10'
          ? { month, label, collected: 100001, collected_formatted: '100 000 FCFA' }
          : { month, label, collected: 0, collected_formatted: '0 FCFA' },
    ),
    upcoming: { days: 30, count: 2 },
    outreach: { pending: { 'j-30': 0, 'j-7': 0, 'j+1': 0, campagne: 0 }, total: 0 },
    ...overrides,
  };
}

export function outreachItem(overrides: Partial<OutreachItem> & { id: string }): OutreachItem {
  return {
    member: {
      id: `m-${overrides.id}`,
      first_name: 'Aminata',
      last_name: 'Diop',
      name: 'Aminata Diop',
      phone: '771234567',
    },
    step: 'j+1',
    due_on: '2026-10-02',
    campaign: { id: 'c-auto', segment: 'auto:j+1', automatic: true },
    // Les espaces insécables du serveur, à garder telles quelles.
    message: 'Bonjour Aminata Diop,\nVotre cotisation de 250 000 FCFA est attendue depuis le 02/10/2026.',
    wa_url: 'https://wa.me/221771234567?text=Bonjour',
    phone_is_usable: true,
    url: 'https://demo-asso.adhera.africa/m/jeton',
    ...overrides,
  };
}

export function campaign(overrides: Partial<Campaign> & { id: string }): Campaign {
  return {
    type: 'relance',
    segment: 'non_a_jour',
    status: 'sent',
    automatic: false,
    step: null,
    send_email: true,
    scheduled_at: null,
    created_at: '2027-01-02T09:00:00+00:00',
    channels: {
      whatsapp: { total: 12, sent: 5, pending: 7, skipped: 0, failed: 0 },
      email: { total: 7, sent: 7, pending: 0, skipped: 0, failed: 0 },
    },
    cancellable: false,
    ...overrides,
  };
}
