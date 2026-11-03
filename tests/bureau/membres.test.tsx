/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/membres" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MembresPage, { readFilter } from '@/app/bureau/membres/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import { calls, fakeServer, memberItem, renderInBureau, SESSION, share } from './fixtures';

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
  window.history.replaceState(null, '', '/bureau/membres');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MAME = memberItem({
  id: 'm-16',
  name: 'Mame Diarra Lo',
  first_name: 'Mame Diarra',
  last_name: 'Lo',
  category_label: 'Bienfaiteur',
  member_number: '0016',
  phone: '77 000 00 16',
  next_due_date: '2026-09-03',
  balance_due: 100001,
  balance_due_formatted: '100 000 FCFA',
});
const MARIAMA = memberItem({
  id: 'm-12',
  name: 'Mariama Cissé',
  first_name: 'Mariama',
  last_name: 'Cissé',
  member_number: '0012',
  phone: null,
  next_due_date: '2026-02-03',
  balance_due: 25001,
  balance_due_formatted: '25 000 FCFA',
});
const AMINATA = memberItem({
  id: 'm-1',
  name: 'Aminata Diop',
  first_name: 'Aminata',
  last_name: 'Diop',
  member_number: '0001',
  is_up_to_date: true,
  covered_until: '2027-03-02',
  balance_due: 0,
  balance_due_formatted: '0 FCFA',
});
const ROKHAYA = memberItem({
  id: 'm-13',
  name: 'Rokhaya Sène',
  first_name: 'Rokhaya',
  is_up_to_date: true,
  covered_until: '2026-12-02',
  next_due_date: '2026-12-03',
  balance_due: 0,
  balance_due_formatted: '0 FCFA',
});

/** L'ordre du serveur : volontairement PAS celui des restes à payer. */
const ALL = [AMINATA, MARIAMA, MAME, ROKHAYA];

function server(extra: Parameters<typeof fakeServer>[0] = []) {
  return fakeServer([
    ...extra,
    { match: /membership\/members\?.*standing=renewing_soon/, body: [ROKHAYA] },
    { match: 'membership/members?status=active', body: ALL },
  ]);
}

describe('Écran 7 — les membres', () => {
  it('trois filtres comptés ; « En retard » d’abord, comme la maquette', async () => {
    const fetchMock = server();
    renderInBureau(<MembresPage />);
    const rows = await screen.findByTestId('member-rows');
    expect(screen.getByRole('button', { name: 'Tous · 4' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'En retard · 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'À jour · 2' })).toBeInTheDocument();
    // « À renouveler » n'existe que depuis l'accueil.
    expect(screen.queryByRole('button', { name: /À renouveler/ })).not.toBeInTheDocument();
    // L'ordre du serveur, jamais retrié.
    expect(within(rows).getAllByRole('link').map((a) => a.querySelector('b')?.textContent)).toEqual([
      'Mariama Cissé',
      'Mame Diarra Lo',
    ]);
    // Les membres ACTIFS seulement : candidats et anciens sont dans « Plus ».
    expect(calls(fetchMock)[0]?.url).toBe(
      'https://api.eventflow.africa/api/v1/admin/membership/members?status=active',
    );
  });

  it('une ligne : le nom, « {type} · n° {numéro} », et « RESTE À PAYER » ou « À jour »', async () => {
    server();
    const user = userEvent.setup();
    renderInBureau(<MembresPage />);
    const rows = await screen.findByTestId('member-rows');
    const mame = within(rows).getByRole('link', { name: /Mame Diarra Lo/ });
    expect(mame).toHaveAttribute('href', '/bureau/membres/m-16');
    expect(mame).toHaveTextContent('Bienfaiteur · n° 0016');
    expect(mame).toHaveTextContent('Reste à payer');
    // R1 : le montant servi, jamais le brut.
    expect(mame).toHaveTextContent('100 000 FCFA');
    expect(document.body.textContent).not.toContain('100001');

    await user.click(screen.getByRole('button', { name: 'À jour · 2' }));
    const ok = within(screen.getByTestId('member-rows')).getByRole('link', { name: /Aminata Diop/ });
    expect(ok).toHaveTextContent('À jour');
    expect(ok).not.toHaveTextContent('Reste à payer');
  });

  it('« Tous » montre tout le monde, dans l’ordre du serveur', async () => {
    server();
    const user = userEvent.setup();
    renderInBureau(<MembresPage />);
    await screen.findByTestId('member-rows');
    await user.click(screen.getByRole('button', { name: 'Tous · 4' }));
    const names = within(screen.getByTestId('member-rows'))
      .getAllByRole('link')
      .map((a) => a.querySelector('b')?.textContent);
    expect(names).toEqual(['Aminata Diop', 'Mariama Cissé', 'Mame Diarra Lo', 'Rokhaya Sène']);
  });

  it('?filtre=renouveler (depuis l’accueil) : la liste du SERVEUR, standing=renewing_soon', async () => {
    window.history.replaceState(null, '', '/bureau/membres?filtre=renouveler');
    const fetchMock = server();
    renderInBureau(<MembresPage />);
    const chip = await screen.findByRole('button', { name: 'À renouveler · 1' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    const rows = within(screen.getByTestId('member-rows'));
    expect(rows.getAllByRole('link')).toHaveLength(1);
    expect(rows.getByText('Rokhaya Sène')).toBeInTheDocument();
    expect(calls(fetchMock).some((c) => c.url.includes('standing=renewing_soon'))).toBe(true);
  });

  it('readFilter : « En retard » par défaut, et les quatre valeurs', () => {
    expect(readFilter('')).toBe('retard');
    expect(readFilter('?filtre=tous')).toBe('tous');
    expect(readFilter('?filtre=a-jour')).toBe('a-jour');
    expect(readFilter('?filtre=renouveler')).toBe('renouveler');
    expect(readFilter('?filtre=n-importe')).toBe('retard');
  });

  it('la recherche (nom ou téléphone) part au serveur après 300 ms', async () => {
    const fetchMock = server();
    const user = userEvent.setup();
    renderInBureau(<MembresPage />);
    await screen.findByTestId('member-rows');
    await user.type(screen.getByPlaceholderText('Chercher : nom ou téléphone'), '77 000');
    await waitFor(() =>
      expect(calls(fetchMock).some((c) => c.url.includes('search=77+000'))).toBe(true),
    );
  });

  it('ordinateur : le tableau, « Aurait dû payer le », et les deux gestes de la ligne', async () => {
    server();
    renderInBureau(<MembresPage />);
    const table = await screen.findByTestId('member-table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'N°',
      'Nom',
      'Téléphone',
      'Situation',
      'Aurait dû payer le',
      'Reste à payer',
      'Actions',
    ]);
    const mame = within(table).getByRole('link', { name: 'Mame Diarra Lo' }).closest('tr') as HTMLElement;
    expect(mame).toHaveTextContent('3 septembre 2026');
    expect(within(mame).getByRole('link', { name: 'Mame Diarra a payé' })).toHaveAttribute(
      'href',
      '/bureau/enregistrer?membre=m-16',
    );
    expect(within(mame).getByRole('button', { name: 'Rappel WhatsApp' })).toBeInTheDocument();
    // Sans téléphone : pas de bouton qui échoue.
    const mariama = within(table).getByRole('link', { name: 'Mariama Cissé' }).closest('tr') as HTMLElement;
    expect(mariama).toHaveTextContent('pas de téléphone');
    expect(within(mariama).queryByRole('button', { name: 'Rappel WhatsApp' })).not.toBeInTheDocument();
  });

  it('« Rappel WhatsApp » : le message du serveur, ouvert sur `share.whatsapp_url`', async () => {
    const fetchMock = server([
      {
        match: 'membership/members/m-16/whatsapp',
        body: { message: 'Bonjour', wa_url: 'https://wa.me/ancien', phone_is_usable: true, url: 'x', share: share({ whatsapp_url: 'https://wa.me/221770000016?text=Rappel' }) },
      },
    ]);
    const tab = { opener: {}, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const user = userEvent.setup();
    renderInBureau(<MembresPage />);
    const table = await screen.findByTestId('member-table');
    const row = within(table).getByRole('link', { name: 'Mame Diarra Lo' }).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Rappel WhatsApp' }));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith('https://wa.me/221770000016?text=Rappel'));
    expect(calls(fetchMock, 'POST')).toHaveLength(0);
  });

  it('A12 — « Imprimer cette liste » : une feuille propre, le nom, le téléphone et le reste à payer', async () => {
    server();
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const user = userEvent.setup();
    renderInBureau(<MembresPage />);
    await screen.findByTestId('member-rows');
    await user.click(screen.getByRole('button', { name: 'Imprimer cette liste' }));
    expect(print).toHaveBeenCalledTimes(1);

    const sheet = screen.getByTestId('print-sheet');
    // Invisible à l'écran, seule à l'impression.
    expect(sheet.className).toContain('hidden');
    expect(sheet.className).toContain('print:block');
    expect(within(sheet).getByRole('heading', { name: 'Les membres en retard' })).toBeInTheDocument();
    expect(within(sheet).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Nom',
      'Téléphone',
      'Reste à payer',
    ]);
    const lines = within(sheet).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(lines).toEqual(['Mariama Cissé—25 000 FCFA', 'Mame Diarra Lo77 000 00 16100 000 FCFA']);
    // Le reste de l'écran disparaît à l'impression.
    expect(screen.getByTestId('member-rows').className).toContain('print:hidden');
    expect(screen.getByTestId('member-table').parentElement?.className).toContain('print:hidden');
  });
});
