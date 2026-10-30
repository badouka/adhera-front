/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/membres/nouveau" }
 */

import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NouveauMembrePage from '@/app/bureau/membres/nouveau/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import { CATEGORIES, calls, fakeServer, memberDetail, renderInBureau, SESSION } from './fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  resetSessionCache();
  saveSession(SESSION);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function server() {
  return fakeServer([
    { method: 'POST', match: 'membership/members', status: 201, body: memberDetail() },
    { match: 'membership/categories', body: CATEGORIES },
  ]);
}

describe('B6 — prénom et nom, ou raison sociale', () => {
  it('une personne exige prénom ET nom, sans appeler l’API', async () => {
    const fetchMock = server();
    const user = userEvent.setup();
    renderInBureau(<NouveauMembrePage />);
    await user.type(screen.getByLabelText(/^Nom/), 'Gueye');
    await user.click(screen.getByRole('button', { name: 'Ajouter le membre' }));

    expect(screen.getByText('Indiquez le prénom.')).toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);
    // Aucun champ « nom complet » pour une personne.
    expect(screen.queryByLabelText(/nom complet/i)).not.toBeInTheDocument();
  });

  it('une personne : POST first_name + last_name, jamais name', async () => {
    const fetchMock = server();
    const user = userEvent.setup();
    renderInBureau(<NouveauMembrePage />);
    await user.type(screen.getByLabelText(/^Prénom/), 'Seynabou');
    await user.type(screen.getByLabelText(/^Nom/), 'Gueye');
    await user.click(screen.getByRole('button', { name: 'Ajouter le membre' }));

    await waitFor(() => expect(calls(fetchMock, 'POST')).toHaveLength(1));
    const body = JSON.parse(calls(fetchMock, 'POST')[0]?.init.body as string);
    expect(body).toMatchObject({ type: 'personne', first_name: 'Seynabou', last_name: 'Gueye' });
    expect(body).not.toHaveProperty('name');
  });

  it('une organisation : la seule « Raison sociale », exigée, puis envoyée en `name`', async () => {
    const fetchMock = server();
    const user = userEvent.setup();
    renderInBureau(<NouveauMembrePage />);
    await user.click(screen.getByRole('radio', { name: 'Organisation' }));
    expect(screen.queryByLabelText(/^Prénom/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ajouter le membre' }));
    expect(screen.getByText('Indiquez la raison sociale.')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Raison sociale/), 'SARL Teranga');
    await user.click(screen.getByRole('button', { name: 'Ajouter le membre' }));
    await waitFor(() => expect(calls(fetchMock, 'POST')).toHaveLength(1));
    const body = JSON.parse(calls(fetchMock, 'POST')[0]?.init.body as string);
    expect(body).toMatchObject({ type: 'organisation', name: 'SARL Teranga' });
    expect(body).not.toHaveProperty('first_name');
  });

  it('respecte le 422 du serveur : le champ désigné, en français', async () => {
    fakeServer([
      {
        method: 'POST',
        match: 'membership/members',
        status: 422,
        body: { message: 'Membre invalide.', errors: { last_name: ['The nom field is required.'] } },
      },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    const user = userEvent.setup();
    renderInBureau(<NouveauMembrePage />);
    await user.type(screen.getByLabelText(/^Prénom/), 'Awa');
    await user.type(screen.getByLabelText(/^Nom/), 'Ba');
    await user.click(screen.getByRole('button', { name: 'Ajouter le membre' }));
    await screen.findByText('Indiquez le nom de famille (255 caractères au plus).');
    expect(document.body.textContent).not.toMatch(/field is required/);
  });
});
