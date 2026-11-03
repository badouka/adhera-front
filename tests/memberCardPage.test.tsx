/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/m/aaaa" }
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialView, MemberPage } from '@/app/m/[token]/MemberPage';
import { attestationErrorMessage } from '@/components/card/AttestationAction';
import { ApiError, OFFLINE_HEADER, SAVED_AT_HEADER } from '@/lib/api';
import { browser } from '@/lib/navigate';
import type { MemberPayload } from '@/lib/types';
import {
  DUE,
  fakeResponse,
  fakeResponseWithHeaders,
  memberCard,
  payload,
  TOKEN,
} from './fixtures';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', `/m/${TOKEN}`);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const UP_TO_DATE: MemberPayload = payload({
  card: memberCard(),
  attestation_available: true,
});

const LATE: MemberPayload = payload({
  standing: { is_up_to_date: false, covered_until: null },
  due: DUE,
  card: memberCard({
    display_name: 'Ousmane Ndiaye',
    is_up_to_date: false,
    valid_until: null,
    standing_label: 'Cotisation à régler',
  }),
  attestation_available: false,
});

function serve(body: MemberPayload) {
  fetchMock.mockResolvedValue(fakeResponse(200, body));
  return render(<MemberPage token={TOKEN} />);
}

describe('F4 § 1.1 — deux vues', () => {
  it('sans carte (`card: null`), la page reste celle d’aujourd’hui : ni onglets, ni carte', async () => {
    serve(payload({ card: null, attestation_available: false }));
    await screen.findByText(/Bonjour Awa Diallo/);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('member-card')).not.toBeInTheDocument();
    expect(screen.getByText('Propulsé par Adhera')).toBeInTheDocument();
    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull();
  });

  it('un serveur antérieur à v3.8 (clé absente) : même chose', async () => {
    serve(payload());
    await screen.findByText(/Bonjour Awa Diallo/);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('à jour : la page s’ouvre sur « Ma carte »', async () => {
    serve(UP_TO_DATE);
    await screen.findByTestId('member-card');
    expect(screen.getByRole('tab', { name: 'Ma carte' })).toHaveAttribute('aria-selected', 'true');
    // La vue carte ne porte que l'association : ni en-tête doublé, ni pied de page.
    expect(screen.queryByText('Propulsé par Adhera')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/adhera|eventflow|digissol/i);
  });

  it('pas à jour : la page s’ouvre sur « Ma cotisation »', async () => {
    serve(LATE);
    await screen.findByText('250 000 FCFA');
    expect(screen.getByRole('tab', { name: 'Ma cotisation' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('member-card')).not.toBeInTheDocument();
  });

  it('?vue=carte force la carte, même pas à jour', async () => {
    window.history.replaceState({}, '', `/m/${TOKEN}?vue=carte`);
    serve(LATE);
    await screen.findByTestId('member-card');
    expect(screen.getByText('Ousmane Ndiaye')).toBeInTheDocument();
  });

  it('initialView : la règle seule', () => {
    expect(initialView(UP_TO_DATE, '')).toBe('carte');
    expect(initialView(LATE, '')).toBe('cotisation');
    expect(initialView(LATE, '?vue=carte')).toBe('carte');
    expect(initialView(payload({ card: null }), '?vue=carte')).toBe('cotisation');
  });

  it('passer d’une vue à l’autre ne recharge rien', async () => {
    const user = userEvent.setup();
    serve(LATE);
    await screen.findByText('250 000 FCFA');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('tab', { name: 'Ma carte' }));
    expect(screen.getByTestId('member-card')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Régler ma cotisation' }));
    expect(await screen.findByText('250 000 FCFA')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Ma carte' }));
    await user.click(screen.getByRole('tab', { name: 'Ma cotisation' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('« Régler ma cotisation » n’existe que pour un membre pas à jour', async () => {
    serve(UP_TO_DATE);
    await screen.findByTestId('member-card');
    expect(screen.queryByRole('button', { name: 'Régler ma cotisation' })).not.toBeInTheDocument();
  });
});

describe('F4 § 1.3 — l’attestation', () => {
  it('attestation_available : le bouton, qui pointe sur la route du membre, tenant en query', async () => {
    serve(UP_TO_DATE);
    const link = await screen.findByRole('link', { name: 'Télécharger mon attestation' });
    expect(link).toHaveAttribute(
      'href',
      `https://api.eventflow.africa/api/v1/m/${TOKEN}/attestation?tenant=demo-asso`,
    );
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('pas disponible et pas à jour : la phrase d’attente, sans bouton', async () => {
    window.history.replaceState({}, '', `/m/${TOKEN}?vue=carte`);
    serve(LATE);
    await screen.findByTestId('member-card');
    expect(screen.queryByRole('link', { name: /attestation/ })).not.toBeInTheDocument();
    expect(
      screen.getByText('Votre attestation sera disponible dès que votre cotisation sera réglée.'),
    ).toBeInTheDocument();
  });

  it('pas disponible mais à jour (clé éteinte côté attestation) : ni bouton, ni phrase', async () => {
    serve({ ...UP_TO_DATE, attestation_available: false });
    await screen.findByTestId('member-card');
    expect(screen.queryByRole('link', { name: /attestation/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('attestation-wait')).not.toBeInTheDocument();
  });

  it('le serveur rend le PDF : le lien est suivi', async () => {
    const open = vi.spyOn(browser, 'open').mockImplementation(() => undefined);
    const user = userEvent.setup();
    serve(UP_TO_DATE);
    const link = await screen.findByRole('link', { name: 'Télécharger mon attestation' });
    fetchMock.mockResolvedValueOnce(fakeResponse(200, {}));
    await user.click(link);
    await waitFor(() => expect(open).toHaveBeenCalledWith(link.getAttribute('href')));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(link.getAttribute('href'));
    expect((init.headers as Record<string, string>)['X-Tenant-Slug']).toBe('demo-asso');
  });

  it('le serveur refuse quand même : son message, tel quel, et le lien n’est pas suivi', async () => {
    const open = vi.spyOn(browser, 'open').mockImplementation(() => undefined);
    const user = userEvent.setup();
    serve(UP_TO_DATE);
    const link = await screen.findByRole('link', { name: 'Télécharger mon attestation' });
    fetchMock.mockResolvedValueOnce(
      fakeResponse(409, {
        message: 'L’association n’a pas encore indiqué son nom : l’attestation ne peut pas être émise.',
        code: 'issuer_missing',
      }),
    );
    await user.click(link);
    expect(
      await screen.findByText('L’association n’a pas encore indiqué son nom : l’attestation ne peut pas être émise.'),
    ).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it('un refus avec un code affiche le message de l’API, code nouveau compris', () => {
    const served = 'Texte rédigé par le serveur.';
    for (const code of ['not_up_to_date', 'not_a_member', 'feature_disabled', 'issuer_missing', 'autre_chose']) {
      expect(attestationErrorMessage(new ApiError(403, code, served))).toBe(served);
    }
    // Sans code (une panne, un 500 de nginx) ou sans message : notre texte, en repli.
    expect(attestationErrorMessage(new ApiError(500, null, served))).not.toBe(served);
    expect(attestationErrorMessage(new ApiError(403, 'autre_chose', '  '))).toMatch(/n’a pas pu être téléchargée/);
    expect(attestationErrorMessage(new ApiError(0, null, ''))).toMatch(/Connexion impossible/);
  });
});

describe('F4 § 1.4 — garder la carte', () => {
  it('pose un manifeste propre au membre, au nom de l’association', async () => {
    serve(UP_TO_DATE);
    await screen.findByTestId('member-card');
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    expect(link).not.toBeNull();
    const href = new URL(link!.getAttribute('href')!, window.location.origin);
    expect(href.pathname).toBe(`/m/${TOKEN}/manifest.webmanifest`);
    expect(href.searchParams.get('nom')).toBe('Cercle des Administrateurs Publics');
    expect(href.searchParams.get('logo')).toBe(memberCard().logo_url);
    // Sans `icon_url`, l'apple-touch-icon retombe aussi sur le logo.
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
      memberCard().logo_url,
    );
  });

  it('manifeste et apple-touch-icon : `organisation.icon_url`, l’icône carrée, telle quelle', async () => {
    const icon = 'https://api.eventflow.africa/storage-tenantdemo-asso/membership/icon-1a2b3c4d.png';
    serve({ ...UP_TO_DATE, organisation: { ...UP_TO_DATE.organisation, icon_url: icon } });
    await screen.findByTestId('member-card');
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const href = new URL(link!.getAttribute('href')!, window.location.origin);
    expect(href.searchParams.get('logo')).toBe(icon);
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(icon);
  });

  it('ni icône ni logo : l’icône neutre de l’app', async () => {
    serve({
      ...UP_TO_DATE,
      organisation: { ...UP_TO_DATE.organisation, icon_url: null },
      card: memberCard({ logo_url: null }),
    });
    await screen.findByTestId('member-card');
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    expect(new URL(link!.getAttribute('href')!, window.location.origin).searchParams.has('logo')).toBe(false);
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
      '/carte/icone-180.png',
    );
  });

  it('hors connexion : la carte depuis le cache, avec le bandeau daté', async () => {
    fetchMock.mockResolvedValue(
      fakeResponseWithHeaders(200, UP_TO_DATE, {
        [OFFLINE_HEADER]: '1',
        [SAVED_AT_HEADER]: '2026-11-02T14:05:00.000Z',
      }),
    );
    render(<MemberPage token={TOKEN} />);
    await screen.findByTestId('member-card');
    // Dakar est à UTC+0 : 14:05.
    expect(screen.getByTestId('offline-banner')).toHaveTextContent(
      'Hors connexion — informations du 2 novembre 2026 à 14:05',
    );
    // Le QR reste affichable : il est engendré localement.
    expect(await screen.findByRole('img', { name: /Code QR/ })).toBeInTheDocument();
  });

  it('en ligne : aucun bandeau', async () => {
    fetchMock.mockResolvedValue(fakeResponseWithHeaders(200, UP_TO_DATE, {}));
    render(<MemberPage token={TOKEN} />);
    await screen.findByTestId('member-card');
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument();
  });
});
