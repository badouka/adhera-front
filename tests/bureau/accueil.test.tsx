/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccueilPage, { headline } from '@/app/bureau/page';
import TousLesPaiementsPage from '@/app/bureau/paiements/page';
import PlusPage, { PLUS_ENTRIES } from '@/app/bureau/plus/page';
import ProfilPage from '@/app/bureau/profil/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import { calls, dashboard, fakeServer, ME, payment, renderInBureau, SESSION, simple } from './fixtures';

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
  vi.restoreAllMocks();
});

function home(overrides: Parameters<typeof simple>[0] = {}) {
  return fakeServer([{ match: 'membership/dashboard', body: dashboard({ simple: simple(overrides) }) }]);
}

describe('Écran 1 — l’accueil, tout depuis `simple` (§18.3)', () => {
  it('« 7 membres sur 15 sont à jour » en tête ; les montants servis, jamais les bruts', async () => {
    const fetchMock = home();
    renderInBureau(<AccueilPage />);
    expect(await screen.findByTestId('headline')).toHaveTextContent('7 membres sur 15 sont à jour');
    const text = document.body.textContent ?? '';
    for (const raw of ['290001', '235001', '45001']) expect(text).not.toContain(raw);
    // Une seule lecture, sans borne : le serveur décide de l'exercice.
    expect(calls(fetchMock).map((c) => c.url)).toEqual([
      'https://api.eventflow.africa/api/v1/admin/membership/dashboard',
    ]);
  });

  it('headline : le singulier', () => {
    expect(headline(simple({ up_to_date_count: 1 }))).toBe('1 membre sur 15 est à jour');
  });

  it('les tuiles : « Reçu en {year} » (l’année du SERVEUR), « Reste à recevoir », « À vérifier » — et elles mènent au bon endroit', async () => {
    home({ year: 2031 });
    renderInBureau(<AccueilPage />);
    const received = await screen.findByTestId('tile-received');
    // L'année est `simple.year`, jamais celle du téléphone.
    expect(received).toHaveTextContent('Reçu en 2031235 000 FCFA');
    expect(received).toHaveAttribute('href', '/bureau/paiements');
    const remaining = screen.getByTestId('tile-remaining');
    expect(remaining).toHaveTextContent('Reste à recevoir290 000 FCFAce que doivent encore les 8 membres en retard');
    expect(remaining).toHaveAttribute('href', '/bureau/membres?filtre=retard');
    const verify = screen.getByTestId('tile-verify');
    expect(verify).toHaveTextContent('À vérifier2 paiementsannoncés par des membres, 45 000 FCFA');
    expect(verify).toHaveAttribute('href', '/bureau/a-verifier');
    // La troisième tuile n'existe que sur ordinateur.
    expect(verify.className).toContain('hidden');
    expect(verify.className).toContain('lg:flex');
  });

  it('aucun getFullYear() dans l’accueil : l’année est celle de l’association', () => {
    const code = readFileSync(join(process.cwd(), 'src', 'app', 'bureau', 'page.tsx'), 'utf8');
    expect(code).not.toMatch(/getFullYear\s*\(/);
    expect(code).toContain('simple.year');
  });

  it('des paiements à vérifier : « 2 membres disent avoir payé » et « Vérifier ces 2 paiements »', async () => {
    home();
    renderInBureau(<AccueilPage />);
    const block = await screen.findByTestId('to-verify');
    expect(within(block).getByRole('heading', { name: '2 membres disent avoir payé' })).toBeInTheDocument();
    expect(within(block).getByRole('link', { name: 'Vérifier ces 2 paiements' })).toHaveAttribute(
      'href',
      '/bureau/a-verifier',
    );
    expect(screen.queryByTestId('nothing-to-verify')).not.toBeInTheDocument();
  });

  it('un seul : « 1 membre dit avoir payé », « Vérifier ce paiement »', async () => {
    home({ to_verify_count: 1 });
    renderInBureau(<AccueilPage />);
    const block = await screen.findByTestId('to-verify');
    expect(block).toHaveTextContent('1 membre dit avoir payé');
    expect(within(block).getByRole('link', { name: 'Vérifier ce paiement' })).toBeInTheDocument();
  });

  it('rien à vérifier : « Rien à vérifier », et aucun bouton de vérification', async () => {
    home({ to_verify_count: 0, to_verify_total: 0, to_verify_total_formatted: '0 FCFA' });
    renderInBureau(<AccueilPage />);
    expect(await screen.findByTestId('nothing-to-verify')).toHaveTextContent('Rien à vérifier');
    expect(screen.queryByRole('link', { name: /Vérifier ce/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('tile-verify')).toHaveTextContent('0 paiementrien à vérifier');
  });

  it('les lignes « en retard » et « à renouveler » ouvrent la liste filtrée', async () => {
    home();
    renderInBureau(<AccueilPage />);
    const late = await screen.findByTestId('row-late');
    expect(late).toHaveTextContent('8 membres en retardVoir qui');
    expect(late).toHaveAttribute('href', '/bureau/membres?filtre=retard');
    const soon = screen.getByTestId('row-renewing');
    expect(soon).toHaveTextContent('1 membre doit renouveler d’ici 30 jours');
    expect(soon).toHaveAttribute('href', '/bureau/membres?filtre=renouveler');
  });

  it('« à renouveler » ABSENTE à 0 ; au pluriel au-delà de 1', async () => {
    home({ renewing_soon_count: 0 });
    const { unmount } = renderInBureau(<AccueilPage />);
    await screen.findByTestId('row-late');
    expect(screen.queryByTestId('row-renewing')).not.toBeInTheDocument();
    unmount();
    home({ renewing_soon_count: 3, renewing_soon_days: 45 });
    renderInBureau(<AccueilPage />);
    expect(await screen.findByTestId('row-renewing')).toHaveTextContent(
      '3 membres doivent renouveler d’ici 45 jours',
    );
  });

  it('N2 — en bas, « Un membre a payé : l’enregistrer » ; aucun autre bouton d’enregistrement', async () => {
    home();
    renderInBureau(<AccueilPage />);
    const record = await screen.findByRole('link', { name: 'Un membre a payé : l’enregistrer' });
    expect(record).toHaveAttribute('href', '/bureau/enregistrer');
    expect(screen.queryByRole('link', { name: /Encaisser/ })).not.toBeInTheDocument();
  });

  it('un serveur sans `simple` (antérieur à v3.8.4) : l’accueil le dit, l’enregistrement reste possible', async () => {
    fakeServer([{ match: 'membership/dashboard', body: dashboard() }]);
    renderInBureau(<AccueilPage />);
    expect(await screen.findByText('L’accueil n’a pas pu être chargé.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Un membre a payé : l’enregistrer' })).toBeInTheDocument();
  });
});

describe('N3 — « Plus »', () => {
  it('chaque entrée mène à l’écran existant ; « Se déconnecter » est là', () => {
    renderInBureau(<PlusPage />);
    const links = within(screen.getByRole('navigation', { name: 'Plus' })).getAllByRole('link');
    expect(links.map((a) => [a.textContent?.replace('›', '').trim(), a.getAttribute('href')])).toEqual([
      ['Relancer les membres', '/bureau/campagnes'],
      ['Rappels WhatsApp à envoyer', '/bureau/a-envoyer'],
      ['Demandes d’adhésion', '/bureau/demandes'],
      ['Anciens membres', '/bureau/anciens'],
      ['Tous les paiements', '/bureau/paiements'],
      ['Chiffres détaillés et fichiers Excel', '/bureau/chiffres'],
      ['Types de membres et montants', '/bureau/types-de-membres'],
      ['Paramètres de l’association', '/bureau/reglages'],
      ['Mon profil', '/bureau/profil'],
      ['Changer mon mot de passe', '/bureau/mon-mot-de-passe'],
    ]);
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
  });

  it('chaque adresse de « Plus » a sa page dans src/app/bureau', () => {
    for (const { href } of PLUS_ENTRIES) {
      const file = join(process.cwd(), 'src', 'app', ...href.split('/').filter(Boolean), 'page.tsx');
      expect(() => readFileSync(file)).not.toThrow();
    }
  });
});

describe('§18.7 — « Mon profil »', () => {
  it('lit le nom, l’adresse et le rôle du serveur ; corrige le NOM, et rien d’autre', async () => {
    const updated = { ...ME, name: 'Sokhna DIAWARA', message: 'Votre nom a été enregistré.' };
    const fetchMock = fakeServer([{ method: 'PUT', match: /^me$/, body: updated }]);
    const user = userEvent.setup();
    const { value } = renderInBureau(<ProfilPage />);
    expect(screen.getByText('tresorier@demo-asso.test')).toBeInTheDocument();
    expect(screen.getByText('Trésorière')).toBeInTheDocument();
    const field = screen.getByLabelText('Votre nom');
    expect(field).toHaveValue('Fatim Diarra');
    await user.clear(field);
    await user.type(field, '  Sokhna   DIAWARA ');
    await user.click(screen.getByRole('button', { name: 'Enregistrer mon nom' }));
    expect(await screen.findByText('Votre nom a été enregistré.')).toBeInTheDocument();
    const [put] = calls(fetchMock, 'PUT');
    expect(put?.url).toBe('https://api.eventflow.africa/api/v1/admin/me');
    expect(JSON.parse(put?.init.body as string)).toEqual({ name: 'Sokhna DIAWARA' });
    expect(value.setMe).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sokhna DIAWARA' }));
    expect(value.setBack).toHaveBeenCalledWith(expect.objectContaining({ href: '/bureau/plus' }));
  });

  it('un nom trop court est arrêté avant l’envoi ; un 422 s’affiche tel quel', async () => {
    const fetchMock = fakeServer([
      {
        method: 'PUT',
        match: /^me$/,
        status: 422,
        body: { message: 'Votre nom n’a pas été modifié.', errors: { name: ['Votre nom ne peut pas dépasser 80 caractères.'] } },
      },
    ]);
    const user = userEvent.setup();
    renderInBureau(<ProfilPage />);
    const field = screen.getByLabelText('Votre nom');
    await user.clear(field);
    await user.type(field, 'A');
    await user.click(screen.getByRole('button', { name: 'Enregistrer mon nom' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Votre nom doit faire au moins 2 caractères.');
    expect(calls(fetchMock, 'PUT')).toHaveLength(0);
    await user.clear(field);
    await user.type(field, 'Awa Diop');
    await user.click(screen.getByRole('button', { name: 'Enregistrer mon nom' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Votre nom ne peut pas dépasser 80 caractères.');
  });

  it('le cadre n’a pas encore lu admin/me : la page le lit', async () => {
    const fetchMock = fakeServer([{ match: /^me$/, body: ME }]);
    renderInBureau(<ProfilPage />, { me: null });
    expect(await screen.findByText('Trésorière')).toBeInTheDocument();
    expect(calls(fetchMock).map((c) => c.url)).toEqual(['https://api.eventflow.africa/api/v1/admin/me']);
  });
});

describe('A6 — « Tous les paiements »', () => {
  const LIST = [
    payment({ id: 'p1', member_name: 'Fatou Sarr', status: 'validated', method: 'especes', method_label: 'Espèces', paid_on: '2026-08-05', amount_formatted: '10 000 FCFA', receipt: { id: 'r1', reference: 'REC-1' } }),
    payment({ id: 'p2', member_name: 'Pape Mbaye', status: 'rejected', method: 'om', method_label: 'Orange Money', paid_on: '2026-11-02', amount_formatted: '25 000 FCFA' }),
    payment({ id: 'p3', member_name: 'Ndeye Thiam', status: 'declared', method: 'wave', method_label: 'Wave', paid_on: '2026-11-03', amount_formatted: '25 000 FCFA' }),
  ];

  it('le journal entier (status=all), le plus récent d’abord, avec « Accepté », « Refusé », « À vérifier »', async () => {
    const fetchMock = fakeServer([{ match: 'membership/payments?status=all', body: LIST }]);
    renderInBureau(<TousLesPaiementsPage />);
    const journal = await screen.findByTestId('journal');
    const lines = within(journal).getAllByRole('listitem').map((li) => li.textContent);
    expect(lines[0]).toContain('Ndeye Thiam');
    expect(lines[0]).toContain('À vérifier');
    expect(lines[1]).toContain('Refusé');
    expect(lines[2]).toContain('Accepté');
    expect(calls(fetchMock)[0]?.url).toBe(
      'https://api.eventflow.africa/api/v1/admin/membership/payments?status=all',
    );
  });

  it('un filtre par jour (la date en toutes lettres) et par moyen de paiement', async () => {
    fakeServer([{ match: 'membership/payments?status=all', body: LIST }]);
    const user = userEvent.setup();
    renderInBureau(<TousLesPaiementsPage />);
    await screen.findByTestId('journal');
    await user.selectOptions(screen.getByLabelText('Moyen de paiement'), 'om');
    await waitFor(() =>
      expect(within(screen.getByTestId('journal')).getAllByRole('listitem')).toHaveLength(1),
    );
    expect(screen.getByTestId('journal')).toHaveTextContent('Pape Mbaye');
    await user.click(screen.getByRole('button', { name: 'Tout afficher' }));
    const day = screen.getByLabelText('Jour');
    await user.type(day, '2026-08-05');
    expect(screen.getByTestId('day-words')).toHaveTextContent('Le 5 août 2026');
    expect(within(screen.getByTestId('journal')).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByTestId('journal')).toHaveTextContent('Fatou Sarr');
  });
});
