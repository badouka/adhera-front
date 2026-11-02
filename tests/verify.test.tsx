/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/v/5RGF6J9Z2UJX" }
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metadata } from '@/app/v/[code]/page';
import { NOT_FOUND_TEXT, VerifyPage } from '@/app/v/[code]/VerifyPage';
import type { Verification } from '@/lib/types';
import { fakeResponse } from './fixtures';

const CODE = '5RGF6J9Z2UJX';
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', `/v/${CODE}`);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function verification(overrides: Partial<Verification> = {}): Verification {
  return {
    organisation: {
      name: 'Cercle des Administrateurs Publics',
      logo_url: 'https://api.eventflow.africa/storage-tenantdemo-asso/membership/logo-1a2b3c4d.png',
    },
    member: {
      display_name: 'Aminata Diop',
      type: 'personne',
      category_label: 'Membre actif',
      member_number: '0001',
      member_since: '2026-03-10',
    },
    standing: 'up_to_date',
    valid_until: '2027-03-09',
    checked_at: '2026-11-02T09:00:00+00:00',
    attestation: null,
    ...overrides,
  };
}

async function show(body: Verification | { status: number; body: unknown }) {
  if ('status' in body && typeof body.status === 'number') {
    fetchMock.mockResolvedValue(fakeResponse(body.status, body.body));
  } else {
    fetchMock.mockResolvedValue(fakeResponse(200, body));
  }
  render(<VerifyPage code={CODE} />);
}

describe('F4 § 2 — la vérification publique', () => {
  it('appelle membership/verify/{code} avec le tenant de l’hôte', async () => {
    await show(verification());
    await screen.findByTestId('verify-verdict');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.eventflow.africa/api/v1/membership/verify/${CODE}`);
    expect((init.headers as Record<string, string>)['X-Tenant-Slug']).toBe('demo-asso');
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.cache).toBe('no-store');
  });

  it('up_to_date : vert, « Membre à jour de sa cotisation », jusqu’au …', async () => {
    await show(verification());
    const verdict = await screen.findByTestId('verify-verdict');
    expect(verdict).toHaveTextContent('Membre à jour de sa cotisation');
    expect(verdict).toHaveTextContent('jusqu’au 9 mars 2027');
    expect(verdict.className).toContain('bg-paid-soft');
    // L'identifiant n'est jamais affiché.
    expect(document.body.textContent).not.toContain('up_to_date');
  });

  it('up_to_date sans date (exonéré) : le verdict seul', async () => {
    await show(verification({ valid_until: null }));
    const verdict = await screen.findByTestId('verify-verdict');
    expect(verdict.textContent).toBe('Membre à jour de sa cotisation');
  });

  it('not_up_to_date : orange, « Membre — cotisation non à jour »', async () => {
    await show(verification({ standing: 'not_up_to_date', valid_until: null }));
    const verdict = await screen.findByTestId('verify-verdict');
    expect(verdict.textContent).toBe('Membre — cotisation non à jour');
    expect(verdict.className).toContain('bg-due-soft');
  });

  it('former : gris, « N’est plus membre de l’association »', async () => {
    await show(verification({ standing: 'former', valid_until: null }));
    const verdict = await screen.findByTestId('verify-verdict');
    expect(verdict.textContent).toBe('N’est plus membre de l’association');
    expect(verdict.className).toContain('bg-surface');
  });

  it('sous le verdict : le membre ; les lignes nulles disparaissent', async () => {
    await show(verification());
    await screen.findByTestId('verify-verdict');
    expect(screen.getByText('Aminata Diop')).toBeInTheDocument();
    expect(screen.getByText('Membre actif')).toBeInTheDocument();
    expect(screen.getByText('N° 0001')).toBeInTheDocument();
    expect(screen.getByText('Membre depuis le 10 mars 2026')).toBeInTheDocument();
    cleanup();

    await show(
      verification({
        member: { display_name: 'Awa Gueye', type: 'personne', category_label: null, member_number: null, member_since: null },
      }),
    );
    await screen.findByText('Awa Gueye');
    expect(document.body.textContent).not.toMatch(/N°|depuis|—/);
  });

  it('« Vérifié le … », en date et heure de l’appareil, fuseau compris', async () => {
    await show(verification());
    const text = (await screen.findByTestId('verify-checked-at')).textContent ?? '';
    expect(text).toMatch(/^Vérifié le \d{1,2}(er)? novembre 2026 à \d{2}:00 \(.+\)$/);
    // Sous `npm test` (TZ=America/Los_Angeles) : 09:00 UTC se lit 01:00, UTC−8.
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/Los_Angeles') {
      expect(text).toBe('Vérifié le 2 novembre 2026 à 01:00 (UTC−8)');
    }
  });

  it('en haut, le logo et le nom de l’association ; en bas, « Vérification assurée par Adhera »', async () => {
    await show(verification());
    await screen.findByTestId('verify-verdict');
    expect(screen.getByRole('banner')).toHaveTextContent('Cercle des Administrateurs Publics');
    expect(screen.getByRole('banner').querySelector('img')).toHaveAttribute(
      'src',
      verification().organisation.logo_url,
    );
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Vérification assurée par Adhera');
    expect(screen.queryByText('Propulsé par Adhera')).not.toBeInTheDocument();
  });
});

describe('F4 § 2 — avec ?attestation=', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', `/v/${CODE}?attestation=ATT-2026-9D2E0D3C`);
  });

  it('transmet la référence à l’API', async () => {
    await show(verification());
    await screen.findByTestId('verify-verdict');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.eventflow.africa/api/v1/membership/verify/${CODE}?attestation=ATT-2026-9D2E0D3C`,
    );
  });

  it('valide : référence, délivrance, valable jusqu’au', async () => {
    await show(
      verification({
        attestation: {
          reference: 'ATT-2026-9D2E0D3C',
          issued_at: '2026-11-02T09:00:00+00:00',
          valid_until: '2027-03-09',
          is_valid: true,
        },
      }),
    );
    const line = await screen.findByTestId('verify-attestation');
    expect(line).toHaveTextContent('Attestation ATT-2026-9D2E0D3C, délivrée le 2 novembre 2026');
    expect(line).toHaveTextContent('valable jusqu’au 9 mars 2027');
    expect(line).not.toHaveTextContent('plus valide');
  });

  it('plus valide : en rouge, « Cette attestation n’est plus valide », sans date de validité', async () => {
    await show(
      verification({
        standing: 'not_up_to_date',
        valid_until: null,
        attestation: {
          reference: 'ATT-2026-9D2E0D3C',
          issued_at: '2026-11-02T09:00:00+00:00',
          valid_until: '2027-03-09',
          is_valid: false,
        },
      }),
    );
    const invalid = await screen.findByTestId('verify-attestation-invalid');
    expect(invalid).toHaveTextContent('Cette attestation n’est plus valide');
    expect(invalid.className).toContain('text-late');
    expect(screen.getByTestId('verify-attestation')).not.toHaveTextContent('valable jusqu’au');
  });

  it('null : « Aucune attestation ne correspond à cette référence pour ce membre. »', async () => {
    await show(verification({ attestation: null }));
    expect(await screen.findByTestId('verify-attestation')).toHaveTextContent(
      'Aucune attestation ne correspond à cette référence pour ce membre.',
    );
  });

  it('sans ?attestation= : aucune ligne d’attestation', async () => {
    window.history.replaceState({}, '', `/v/${CODE}`);
    await show(verification());
    await screen.findByTestId('verify-verdict');
    expect(screen.queryByTestId('verify-attestation')).not.toBeInTheDocument();
  });
});

describe('F4 § 2 — un seul cas d’erreur', () => {
  it('le 404 : un texte, et un seul', async () => {
    await show({
      status: 404,
      body: { message: 'Aucun membre ne correspond à ce code.', code: 'verification_not_found' },
    });
    expect(await screen.findByTestId('verify-not-found')).toHaveTextContent(NOT_FOUND_TEXT);
    expect(NOT_FOUND_TEXT).toBe(
      'Aucun membre ne correspond à ce code. Vérifiez que vous avez scanné le bon document.',
    );
    // Pas de nom d'association : on ne sait pas laquelle.
    expect(screen.getByRole('banner').textContent).toBe('');
  });

  it('quel que soit le corps du 404, le même écran (aucune variante)', async () => {
    for (const body of [{ code: 'feature_disabled', message: 'Option éteinte' }, {}, null]) {
      cleanup();
      await show({ status: 404, body });
      const text = (await screen.findByTestId('verify-not-found')).textContent;
      expect(text).toBe(NOT_FOUND_TEXT);
      expect(document.body.textContent).not.toMatch(/éteinte|feature/);
    }
  });

  it('un hôte qui ne désigne aucune association : le même texte, sans appel', async () => {
    const original = window.location.href;
    // `resolveTenant` lit l'hôte : on le simule hors adhera.africa.
    vi.spyOn(await import('@/lib/tenant'), 'resolveTenant').mockReturnValue(null);
    render(<VerifyPage code={CODE} />);
    expect(await screen.findByTestId('verify-not-found')).toHaveTextContent(NOT_FOUND_TEXT);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.href).toBe(original);
  });
});

describe('F4 § 2 — noindex, aucune mesure d’audience', () => {
  it('la page porte noindex', () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
