/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TableauDeBordPage, { rateLabel } from '@/app/bureau/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import { calls, dashboard, fakeResponse, fakeServer, renderInBureau, SESSION } from './fixtures';

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

function dashboardUrls(fetchMock: ReturnType<typeof fakeServer>) {
  return calls(fetchMock)
    .map((c) => c.url)
    .filter((u) => u.includes('/membership/dashboard'));
}

describe('Tableau de bord — les chiffres', () => {
  it('« signalé » n’est JAMAIS additionné à « encaissé »', async () => {
    fakeServer([{ match: 'membership/dashboard', body: dashboard() }]);
    renderInBureau(<TableauDeBordPage />);

    expect(await screen.findByTestId('collected')).toHaveTextContent('350 000 FCFA');
    const declared = screen.getByTestId('declared');
    expect(declared).toHaveTextContent('Signalé par les membres, en attente de validation');
    expect(declared).toHaveTextContent('50 000 FCFA');
    expect(declared).toHaveTextContent('1 paiement');
    // 350 000 + 50 000 n'apparaît nulle part.
    expect(document.body.textContent).not.toContain('400 000');
    expect(declared).not.toContainElement(screen.getByTestId('collected'));
  });

  it('les montants viennent des *_formatted, jamais des nombres bruts', async () => {
    fakeServer([{ match: 'membership/dashboard', body: dashboard() }]);
    renderInBureau(<TableauDeBordPage />);
    await screen.findByTestId('collected');
    const text = document.body.textContent ?? '';
    // Les bruts de la charge valent 350001, 50001, 650001… : aucun ne s'affiche.
    for (const raw of ['350001', '50001', '650001', '250001', '100001', '350 001', '650 001']) {
      expect(text).not.toContain(raw);
    }
    expect(screen.getByTestId('outstanding')).toHaveTextContent('650 000 FCFA');
  });

  it('le taux à jour en grand ; `null` s’affiche « — », jamais « 0 % »', async () => {
    expect(rateLabel(60)).toBe('60 %');
    expect(rateLabel(0)).toBe('0 %');
    expect(rateLabel(null)).toBe('—');

    const empty = dashboard();
    empty.members = { active: 0, up_to_date: 0, not_up_to_date: 0, pending: 0, former: 0 };
    empty.money = { ...empty.money, recovery_rate: null };
    fakeServer([{ match: 'membership/dashboard', body: empty }]);
    renderInBureau(<TableauDeBordPage />);
    expect(await screen.findByTestId('rate')).toHaveTextContent(/^—$/);
    expect(document.body.textContent).not.toMatch(/0\s%/);
    expect(screen.getByText('Aucun membre actif pour le moment.')).toBeInTheDocument();
  });

  it('effectifs, échéances à venir et ventilations', async () => {
    fakeServer([{ match: 'membership/dashboard', body: dashboard() }]);
    renderInBureau(<TableauDeBordPage />);
    expect(await screen.findByTestId('rate')).toHaveTextContent('60 %');
    expect(screen.getByText('Membres actifs').nextSibling).toHaveTextContent('5');
    expect(screen.getByText('Pas à jour').nextSibling).toHaveTextContent('2');
    expect(screen.getByText('Candidatures').nextSibling).toHaveTextContent('1');
    expect(screen.getByTestId('upcoming')).toHaveTextContent('2 échéances dans les 30 prochains jours.');

    const methods = screen.getByRole('heading', { name: 'Par moyen de paiement' }).closest('section') as HTMLElement;
    // Les 5 moyens, à 0 compris, dans l'ordre servi.
    expect(within(methods).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual([
      'Orange Money0 FCFA',
      'Wave250 000 FCFA',
      'Virement bancaire0 FCFA',
      'Chèque0 FCFA',
      'Espèces100 000 FCFA',
    ]);
    const cats = screen.getByRole('heading', { name: 'Par catégorie' }).closest('section') as HTMLElement;
    expect(within(cats).getByText('Sans catégorie')).toBeInTheDocument();
  });

  it('un total partiel dit pourquoi', async () => {
    const d = dashboard();
    d.money = { ...d.money, outstanding_unknown_count: 2 };
    fakeServer([{ match: 'membership/dashboard', body: d }]);
    renderInBureau(<TableauDeBordPage />);
    expect(await screen.findByTestId('unknown')).toHaveTextContent(
      /Total partiel : 2 cotisations n’ont pas de montant fixé .* ne sont pas comptées/,
    );
  });

  it('les 12 barres sont là, mois vides compris, avec un libellé au toucher', async () => {
    fakeServer([{ match: 'membership/dashboard', body: dashboard() }]);
    const user = userEvent.setup();
    renderInBureau(<TableauDeBordPage />);
    const bars = await screen.findAllByTestId('bar');
    expect(bars).toHaveLength(12);
    expect(bars[0]).toHaveAttribute('aria-label', 'décembre 2025 : 0 FCFA');
    // Le mois le plus récent est lu par défaut.
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('novembre 2026 : 0 FCFA');
    await user.click(bars[3] as Element);
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('mars 2026 : 250 000 FCFA');
    // Un mois vide n'a pas de barre dessinée, mais sa colonne existe.
    expect((bars[0] as Element).querySelector('path')).toBeNull();
    expect((bars[3] as Element).querySelector('path')).not.toBeNull();
  });
});

describe('Tableau de bord — les trois boutons', () => {
  it('« Encaisser », « À valider (n) », « À envoyer (n) » ; un zéro reste visible, grisé', async () => {
    fakeServer([{ match: 'membership/dashboard', body: dashboard() }]);
    renderInBureau(<TableauDeBordPage />);
    const actions = screen.getByRole('navigation', { name: 'Actions' });
    expect(within(actions).getByRole('link', { name: 'Encaisser' })).toHaveAttribute('href', '/bureau/encaisser');
    const toValidate = await within(actions).findByRole('link', { name: 'À valider (1)' });
    expect(toValidate).toHaveAttribute('href', '/bureau/a-valider');
    expect(toValidate).not.toHaveAttribute('data-idle');
    const toSend = within(actions).getByRole('link', { name: 'À envoyer (0)' });
    expect(toSend).toHaveAttribute('href', '/bureau/a-envoyer');
    expect(toSend).toHaveAttribute('data-idle', 'true');
  });
});

describe('Tableau de bord — la période', () => {
  it('« Cette année » par défaut : aucune borne, le serveur décide', async () => {
    const fetchMock = fakeServer([{ match: 'membership/dashboard', body: dashboard() }]);
    renderInBureau(<TableauDeBordPage />);
    await screen.findByTestId('collected');
    expect(dashboardUrls(fetchMock)).toEqual([
      'https://api.eventflow.africa/api/v1/admin/membership/dashboard',
    ]);
    expect(screen.getByRole('radio', { name: 'Cette année' })).toHaveAttribute('aria-checked', 'true');
  });

  it('« 12 derniers mois » : du 1er du mois, onze mois plus tôt, à aujourd’hui', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    const fetchMock = fakeServer([{ match: 'membership/dashboard', body: dashboard() }]);
    const user = userEvent.setup();
    renderInBureau(<TableauDeBordPage />);
    await screen.findByTestId('collected');
    await user.click(screen.getByRole('radio', { name: '12 derniers mois' }));
    await waitFor(() =>
      expect(dashboardUrls(fetchMock).at(-1)).toBe(
        'https://api.eventflow.africa/api/v1/admin/membership/dashboard?from=2025-12-01&to=2026-11-01',
      ),
    );
    vi.useRealTimers();
  });

  it('deux dates : envoyées telles quelles, et refusées à l’envers', async () => {
    const fetchMock = fakeServer([{ match: 'membership/dashboard', body: dashboard() }]);
    const user = userEvent.setup();
    const { container } = renderInBureau(<TableauDeBordPage />);
    await screen.findByTestId('collected');
    await user.click(screen.getByRole('radio', { name: 'Choisir les dates' }));
    const [from, to] = Array.from(container.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    await user.type(from as HTMLInputElement, '2026-06-30');
    await user.type(to as HTMLInputElement, '2026-01-01');
    await user.click(screen.getByRole('button', { name: 'Afficher' }));
    expect(screen.getByRole('alert')).toHaveTextContent('La première date doit précéder la seconde.');
    await user.clear(to as HTMLInputElement);
    await user.type(to as HTMLInputElement, '2026-09-30');
    await user.click(screen.getByRole('button', { name: 'Afficher' }));
    await waitFor(() =>
      expect(dashboardUrls(fetchMock).at(-1)).toBe(
        'https://api.eventflow.africa/api/v1/admin/membership/dashboard?from=2026-06-30&to=2026-09-30',
      ),
    );
  });
});

describe('Tableau de bord — les exports', () => {
  it('fetch avec le jeton, lu en blob, remis au navigateur', async () => {
    const created: Blob[] = [];
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn((b: Blob) => {
        created.push(b);
        return 'blob:x';
      }),
      revokeObjectURL: vi.fn(),
    }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const fetchMock = fakeServer([
      { match: 'membership/dashboard', body: dashboard() },
      { match: 'membership/exports/members.xlsx', body: null },
      { match: 'membership/exports/payments.xlsx', body: null },
    ]);
    const user = userEvent.setup();
    renderInBureau(<TableauDeBordPage />);
    await screen.findByTestId('collected');

    await user.click(screen.getByRole('button', { name: 'Registre des membres (Excel)' }));
    await user.click(screen.getByRole('button', { name: 'Versements de la période (Excel)' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));

    const exports = calls(fetchMock).filter((c) => c.url.includes('/exports/'));
    expect(exports.map((c) => c.url)).toEqual([
      'https://api.eventflow.africa/api/v1/admin/membership/exports/members.xlsx',
      'https://api.eventflow.africa/api/v1/admin/membership/exports/payments.xlsx',
    ]);
    for (const c of exports) {
      expect((c.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SESSION.token}`);
    }
    expect(created).toHaveLength(2);
  });

  it('un refus du serveur s’affiche clairement', async () => {
    fakeServer([
      { match: 'membership/dashboard', body: dashboard() },
      { match: 'membership/exports/payments.xlsx', status: 422, body: { message: 'Bad', code: 'invalid_period' } },
    ]);
    const user = userEvent.setup();
    renderInBureau(<TableauDeBordPage />);
    await screen.findByTestId('collected');
    await user.click(screen.getByRole('button', { name: 'Versements de la période (Excel)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Les dates de la période ne sont pas valides.');
  });

  it('§4 — le bouton nomme le fichier comme le serveur, et compose le nom seulement si l’en-tête manque', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    fakeServer([
      { match: 'membership/dashboard', body: dashboard() },
      {
        match: 'membership/exports/members.xlsx',
        body: null,
        headers: { 'Content-Disposition': 'attachment; filename="registre-association-f31-2026-11-01.xlsx"' },
      },
      // Sans en-tête : le nom de repli, bâti sur la période servie.
      { match: 'membership/exports/payments.xlsx', body: null },
    ]);
    const user = userEvent.setup();
    renderInBureau(<TableauDeBordPage />);
    await screen.findByTestId('collected');
    await user.click(screen.getByRole('button', { name: 'Registre des membres (Excel)' }));
    await user.click(screen.getByRole('button', { name: 'Versements de la période (Excel)' }));
    await waitFor(() => expect(names).toHaveLength(2));
    expect(names).toEqual([
      'registre-association-f31-2026-11-01.xlsx',
      'versements-2026-01-01_2026-11-01.xlsx',
    ]);
  });

  it('le nom du fichier : celui du serveur s’il est lisible', async () => {
    const { request } = await import('@/lib/bureau/api');
    vi.stubGlobal('fetch', vi.fn(async () =>
      fakeResponse(200, null, { 'Content-Disposition': 'attachment; filename="registre-2026-11-01.xlsx"' }),
    ));
    const file = await request<{ filename: string | null }>('membership/exports/members.xlsx', { as: 'file' });
    expect(file.filename).toBe('registre-2026-11-01.xlsx');
  });
});
