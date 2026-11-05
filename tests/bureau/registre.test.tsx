/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/membres" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnciensPage from '@/app/bureau/anciens/page';
import EnAttentePage from '@/app/bureau/demandes/en-attente/page';
import { Registry } from '@/components/bureau/Registry';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import {
  CATEGORIES,
  calls,
  fakeServer,
  fullText,
  memberItem,
  ORGANISATION,
  renderInBureau,
  SESSION,
  settings,
} from './fixtures';

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

const UP_TO_DATE = memberItem({
  id: 'm-2',
  name: 'Awa Diallo (test)',
  is_up_to_date: true,
  covered_until: '2027-03-13',
  balance_due: 0,
  balance_due_formatted: '0 FCFA',
});

function server(members = [memberItem(), ORGANISATION, UP_TO_DATE]) {
  return fakeServer([
    { match: 'membership/categories', body: CATEGORIES },
    { match: 'membership/members', body: members },
  ]);
}

function memberUrls(fetchMock: ReturnType<typeof server>) {
  return calls(fetchMock)
    .map((c) => c.url)
    .filter((u) => u.includes('/membership/members'));
}

describe('B5 — le registre complet (F5 : il sert « Demandes d’adhésion » et « Anciens membres »)', () => {
  it('ouvre sur les membres actifs (candidats et anciens ont leurs onglets)', async () => {
    const fetchMock = server();
    renderInBureau(<Registry status="active" />);
    await screen.findAllByText('Moussa Ndiaye (test)');
    expect(memberUrls(fetchMock)[0]).toBe(
      'https://api.eventflow.africa/api/v1/admin/membership/members?status=active',
    );
  });

  it('affiche nom, catégorie, pastille, reste à payer ou couverture', async () => {
    server();
    renderInBureau(<Registry status="active" />);
    const cards = within(await screen.findByTestId('member-cards'));
    expect(cards.getByText('Moussa Ndiaye (test)')).toBeInTheDocument();
    expect(cards.getByText(fullText('Reste à payer 150 000 FCFA'))).toBeInTheDocument();
    expect(cards.getByText('À jour jusqu’au 13 mars 2027')).toBeInTheDocument();
    expect(cards.getAllByText('En retard')).toHaveLength(2);
    expect(cards.getByText('À jour')).toBeInTheDocument();
    // Le tableau grand écran porte les mêmes lignes.
    expect(within(screen.getByTestId('member-table')).getByText('Awa Diallo (test)')).toBeInTheDocument();
  });

  it('garde l’ordre du serveur : aucun retri côté client (v3.5.7)', async () => {
    // L'ordre mesuré sur demo-asso : par nom de famille, l'organisation
    // intercalée à la lettre A. Un tri client par `name` le casserait
    // (« Awa Diallo » passerait avant « Mariama Ba »).
    const ordered = [
      memberItem({ id: 'o', type: 'organisation', name: 'Agence Conseil Teranga', first_name: null, last_name: null }),
      memberItem({ id: 'b', name: 'Mariama Ba', first_name: 'Mariama', last_name: 'Ba' }),
      memberItem({ id: 'd', name: 'Awa Diallo', first_name: 'Awa', last_name: 'Diallo' }),
      memberItem({ id: 's', name: 'Fatou Sarr', first_name: 'Fatou', last_name: 'Sarr' }),
    ];
    server(ordered);
    renderInBureau(<Registry status="active" />);
    const table = await screen.findByTestId('member-table');
    const names = within(table).getAllByRole('link').map((a) => a.textContent);
    expect(names).toEqual(['Agence Conseil Teranga', 'Mariama Ba', 'Awa Diallo', 'Fatou Sarr']);
  });

  it('balance_due null → « — », jamais « 0 FCFA »', async () => {
    server([ORGANISATION]);
    renderInBureau(<Registry status="active" />);
    const cards = within(await screen.findByTestId('member-cards'));
    expect(cards.getByText(fullText('Reste à payer —'))).toBeInTheDocument();
    expect(cards.queryByText(/0 FCFA/)).not.toBeInTheDocument();
  });

  it('chaque filtre part au serveur, et se combine', async () => {
    const fetchMock = server();
    const user = userEvent.setup();
    renderInBureau(<Registry status="active" />);
    await screen.findByTestId('member-cards');

    await user.selectOptions(screen.getByLabelText('Situation'), 'not_up_to_date');
    await waitFor(() => expect(memberUrls(fetchMock).at(-1)).toContain('standing=not_up_to_date'));

    await user.selectOptions(screen.getByLabelText('Type de membre'), '1');
    await user.selectOptions(screen.getByLabelText('Type'), 'organisation');
    await waitFor(() =>
      expect(memberUrls(fetchMock).at(-1)).toBe(
        'https://api.eventflow.africa/api/v1/admin/membership/members?status=active&standing=not_up_to_date&type=organisation&category_id=1',
      ),
    );
  });

  it('la recherche attend 300 ms sans frappe avant de partir', async () => {
    const fetchMock = server();
    const user = userEvent.setup();
    renderInBureau(<Registry status="active" />);
    await screen.findByTestId('member-cards');
    const before = memberUrls(fetchMock).length;

    await user.type(screen.getByLabelText('Rechercher'), 'Agence');
    // Six frappes, une seule requête — et pas avant le silence.
    expect(memberUrls(fetchMock).length).toBe(before);
    await waitFor(() => expect(memberUrls(fetchMock).at(-1)).toContain('search=Agence'), {
      timeout: 1500,
    });
    expect(memberUrls(fetchMock).filter((u) => u.includes('search=')).length).toBe(1);
  });

  it('le type ne se propose que si l’association est mixte', async () => {
    server();
    renderInBureau(<Registry status="active" />, { settings: settings({ member_types: 'personnes' }) });
    await screen.findByTestId('member-cards');
    expect(screen.queryByLabelText('Type')).not.toBeInTheDocument();
  });

  it('les candidats qui n’ont pas payé (F6) et « Anciens membres » demandent leur statut', async () => {
    const fetchMock = server();
    const { value, unmount } = renderInBureau(<EnAttentePage />);
    expect(screen.getByRole('heading', { name: 'Demandes d’adhésion' })).toBeInTheDocument();
    await waitFor(() => expect(memberUrls(fetchMock).at(-1)).toContain('status=pending'));
    expect(value.setBack).toHaveBeenCalledWith(expect.objectContaining({ href: '/bureau/demandes' }));
    unmount();
    renderInBureau(<AnciensPage />);
    expect(screen.getByRole('heading', { name: 'Anciens membres' })).toBeInTheDocument();
    await waitFor(() => expect(memberUrls(fetchMock).at(-1)).toContain('status=former'));
  });

  it('pagine côté client par 50', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      memberItem({ id: `m-${i}`, name: `Membre ${String(i).padStart(3, '0')}` }),
    );
    server(many);
    const user = userEvent.setup();
    renderInBureau(<Registry status="active" />);
    const cards = await screen.findByTestId('member-cards');
    expect(within(cards).getAllByRole('link')).toHaveLength(50);
    expect(screen.getByText('Page 1 sur 3')).toBeInTheDocument();
    expect(screen.getByText('120 membres')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Suivants' }));
    expect(within(screen.getByTestId('member-cards')).getByText('Membre 050')).toBeInTheDocument();
  });

  it('un filtre refusé (422) se dit, il ne ressemble pas à une liste vide', async () => {
    fakeServer([
      { match: 'membership/categories', body: CATEGORIES },
      { match: 'membership/members', status: 422, body: { message: 'Catégorie inconnue : 9999.', code: 'unknown_category' } },
    ]);
    renderInBureau(<Registry status="active" />);
    await screen.findByText('Ce type de membre n’existe plus. Rechargez la page.');
    expect(screen.queryByText(/Aucun membre/)).not.toBeInTheDocument();
  });

  it('les anciens membres : aucune pastille « En retard », aucun reste à payer', async () => {
    const owing = { is_up_to_date: false, balance_due: 150000, balance_due_formatted: '150 000 FCFA' };
    server([
      memberItem({ id: 'f-1', name: 'Cheikh Sow (test)', status: 'former', covered_until: '2026-02-28', ...owing }),
      memberItem({ id: 'f-2', name: 'Fatou Ba (test)', status: 'former', covered_until: null, ...owing }),
    ]);
    renderInBureau(<AnciensPage />);
    const cards = within(await screen.findByTestId('member-cards'));
    await cards.findByText('Cheikh Sow (test)');
    expect(cards.getAllByText('Ancien membre')).toHaveLength(2);
    expect(cards.getByText('À jour jusqu’au 28 février 2026')).toBeInTheDocument();
    expect(screen.queryByText('En retard')).toBeNull();
    expect(screen.queryByText(/Reste à payer/)).toBeNull();
    expect(screen.queryByText(/150 000 FCFA/)).toBeNull();
  });

  it('contre-épreuve : les mêmes membres actifs sont « En retard » avec leur reste à payer', async () => {
    const owing = { is_up_to_date: false, balance_due: 150000, balance_due_formatted: '150 000 FCFA' };
    server([memberItem({ id: 'a-1', name: 'Cheikh Sow (test)', status: 'active', covered_until: '2026-02-28', ...owing })]);
    renderInBureau(<Registry status="active" />);
    const cards = within(await screen.findByTestId('member-cards'));
    expect(cards.getByText('En retard')).toBeInTheDocument();
    expect(cards.getByText(fullText('Reste à payer 150 000 FCFA'))).toBeInTheDocument();
  });
});
