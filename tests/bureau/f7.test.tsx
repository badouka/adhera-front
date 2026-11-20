/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau" }
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnexionPage from '@/app/bureau/connexion/page';
import DemandesPage from '@/app/bureau/demandes/page';
import TypesDeMembresPage from '@/app/bureau/types-de-membres/page';
import { AnswersList } from '@/components/bureau/Answers';
import { BureauFrame } from '@/components/bureau/BureauFrame';
import { listCategories } from '@/lib/bureau/api/categories';
import { navigation, resetSessionCache, saveSession } from '@/lib/bureau/session';
import type { Category, MemberAnswer } from '@/lib/bureau/types';
import {
  calls,
  CATEGORIES,
  fakeServer,
  memberItem,
  ME,
  renderInBureau,
  SESSION,
  settings,
} from './fixtures';

const nav = vi.hoisted(() => ({
  pathname: '/bureau',
  params: {} as Record<string, string>,
  router: { push: vi.fn(), replace: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => nav.router,
  useParams: () => nav.params,
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
  nav.pathname = '/bureau';
  nav.router.replace.mockReset();
  vi.spyOn(navigation, 'replace').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const body = (fetchMock: ReturnType<typeof vi.fn>, method: string, index = 0) =>
  JSON.parse(calls(fetchMock, method)[index]?.init.body as string) as Record<string, unknown>;

/* ───────────────────────────── § 1 — la recette ───────────────────────────── */

describe('P2 — « Demandes d’adhésion » s’ouvre depuis « Plus » avec « < Plus »', () => {
  const CANDIDATE = memberItem({ id: 'm-awa', name: 'Awa Gueye', first_name: 'Awa', status: 'pending', answers: [] });

  it('la barre de retour, comme les onze autres écrans de « Plus »', async () => {
    saveSession(SESSION);
    fakeServer([
      { match: /^membership\/members\?status=pending/, body: [CANDIDATE] },
      { match: /^membership\/members\?status=rejected/, body: [] },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    const { value } = renderInBureau(<DemandesPage />);
    await screen.findByTestId('application');
    expect(value.setBack).toHaveBeenLastCalledWith({ href: '/bureau/plus', label: 'Plus', onClick: undefined });
  });

  it('pendant un refus, « Retour » revient à la demande', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    fakeServer([
      { match: /^membership\/members\?status=pending/, body: [CANDIDATE] },
      { match: /^membership\/members\?status=rejected/, body: [] },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    const { value } = renderInBureau(<DemandesPage />);
    await user.click(await screen.findByRole('button', { name: 'Refuser la demande' }));
    await screen.findByTestId('refuse-application');
    expect(value.setBack).toHaveBeenLastCalledWith(
      expect.objectContaining({ href: '/bureau/demandes', label: 'Retour' }),
    );
  });

  it('en 390 px, la barre de retour remplace la barre du bas', async () => {
    saveSession(SESSION);
    nav.pathname = '/bureau/demandes';
    fakeServer([
      { match: 'membership/settings', body: settings() },
      { match: /^me$/, body: ME },
      { match: 'membership/payments', body: [] },
      { match: /^membership\/members\?status=pending/, body: [CANDIDATE] },
      { match: /^membership\/members\?status=rejected/, body: [] },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    render(
      <BureauFrame>
        <DemandesPage />
      </BureauFrame>,
    );
    await screen.findByTestId('application');
    // Hors de la barre latérale de l'ordinateur : la barre de retour, et elle seule.
    const back = screen.getAllByRole('link', { name: 'Plus' }).filter((link) => !link.closest('aside'));
    expect(back).toHaveLength(1);
    expect(back[0]).toHaveAttribute('href', '/bureau/plus');
    expect(screen.queryByRole('navigation', { name: 'Navigation' })).not.toBeInTheDocument();
  });
});

describe('P4 — « Proposé sur la page « Adhérer » » se lit, et ne part que s’il a été touché', () => {
  const PUBLIC: Category[] = [
    { ...CATEGORIES[2]!, is_public: true },
    { ...CATEGORIES[1]!, is_public: false },
  ];

  it('dans la liste, l’état positif aussi', async () => {
    saveSession(SESSION);
    fakeServer([{ match: 'membership/categories', body: PUBLIC }]);
    renderInBureau(<TypesDeMembresPage />);
    const actif = (await screen.findByText('Membre actif')).closest('li') as HTMLElement;
    expect(within(actif).getByTestId('category-public')).toHaveTextContent('Proposé sur la page « Adhérer »');
    const honoraire = screen.getByText('Honoraire').closest('li') as HTMLElement;
    expect(honoraire).toHaveTextContent('Non proposé sur la page « Adhérer »');
  });

  it('modifier un type sans toucher la case : `is_public` ne part pas, la valeur en base reste', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    const fetchMock = fakeServer([
      { method: 'PUT', match: 'membership/categories/1', body: { ...PUBLIC[0], label: 'Membre titulaire' } },
      { match: 'membership/categories', body: PUBLIC },
    ]);
    renderInBureau(<TypesDeMembresPage />);
    const actif = (await screen.findByText('Membre actif')).closest('li') as HTMLElement;
    await user.click(within(actif).getByRole('button', { name: 'Modifier' }));
    const name = screen.getByLabelText(/^Nom \*$/);
    await user.clear(name);
    await user.type(name, 'Membre titulaire');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce type de membre' }));
    await screen.findByText('« Membre titulaire » est modifiée.');
    expect(body(fetchMock, 'PUT')).not.toHaveProperty('is_public');
  });

  it('la case touchée : `is_public` part, tel qu’affiché', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    const fetchMock = fakeServer([
      { method: 'PUT', match: 'membership/categories/1', body: { ...PUBLIC[0], is_public: false } },
      { match: 'membership/categories', body: PUBLIC },
    ]);
    renderInBureau(<TypesDeMembresPage />);
    const actif = (await screen.findByText('Membre actif')).closest('li') as HTMLElement;
    await user.click(within(actif).getByRole('button', { name: 'Modifier' }));
    await user.click(screen.getByRole('checkbox', { name: /Proposé sur la page « Adhérer »/ }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce type de membre' }));
    await waitFor(() => expect(body(fetchMock, 'PUT')).toMatchObject({ is_public: false }));
  });
});

describe('B11 — la licence échue arrête l’espace du bureau, et dit à qui écrire', () => {
  const REFUSAL = (code: string) => ({
    status: 403,
    body: { code, error_code: code, error: 'Votre licence a expiré.', message: 'Votre licence a expiré. Renouvelez pour réactiver votre espace.' },
  });

  it.each([
    ['license_expired', 'La licence de votre association a expiré. Pour la renouveler, écrivez à Adhera.'],
    ['trial_expired', 'La période d’essai de votre association est terminée. Pour continuer, écrivez à Adhera.'],
    ['tenant_inactive', 'L’espace de votre association est suspendu. Pour en savoir plus, écrivez à Adhera.'],
  ])('au chargement, %s : la phrase décidée, les contacts d’Adhera, jamais « Réessayer »', async (code, text) => {
    saveSession(SESSION);
    fakeServer([{ match: 'membership/settings', ...REFUSAL(code) }]);
    render(<BureauFrame>contenu protégé</BureauFrame>);
    const screenLicence = await screen.findByTestId('licence');
    expect(screenLicence).toHaveTextContent(text);
    // Le message servi n'est pas affiché : il ne dit pas à qui écrire.
    expect(screenLicence).not.toHaveTextContent('Renouvelez pour réactiver votre espace');
    expect(within(screenLicence).getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/221782414064');
    expect(within(screenLicence).getByRole('link', { name: 'contact@adhera.africa' })).toHaveAttribute('href', 'mailto:contact@adhera.africa');
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
    expect(screen.queryByText('contenu protégé')).not.toBeInTheDocument();
  });

  it('un refus reçu par N’IMPORTE QUEL écran, après le chargement, bascule l’espace entier', async () => {
    saveSession(SESSION);
    fakeServer([
      { match: 'membership/settings', body: settings() },
      { match: /^me$/, body: ME },
      { match: 'membership/payments', body: [] },
      { match: 'membership/categories', ...REFUSAL('license_expired') },
    ]);
    function Ecran() {
      return (
        <button type="button" onClick={() => void listCategories().catch(() => undefined)}>
          Charger
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <BureauFrame>
        <Ecran />
      </BureauFrame>,
    );
    await user.click(await screen.findByRole('button', { name: 'Charger' }));
    expect(await screen.findByTestId('licence')).toHaveTextContent('La licence de votre association a expiré.');
  });

  it('contre-épreuve : un autre 403 (role_not_allowed) ne touche pas au cadre', async () => {
    saveSession(SESSION);
    const fetchMock = fakeServer([
      { match: 'membership/settings', body: settings() },
      { match: /^me$/, body: ME },
      { match: 'membership/payments', body: [] },
      { match: 'membership/categories', status: 403, body: { code: 'role_not_allowed', message: 'Non.' } },
    ]);
    const user = userEvent.setup();
    render(
      <BureauFrame>
        <button type="button" onClick={() => void listCategories().catch(() => undefined)}>
          Charger
        </button>
      </BureauFrame>,
    );
    await user.click(await screen.findByRole('button', { name: 'Charger' }));
    await waitFor(() =>
      expect(calls(fetchMock).some((c) => c.url.includes('membership/categories'))).toBe(true),
    );
    expect(screen.queryByTestId('licence')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Charger' })).toBeInTheDocument();
  });

  it('à la connexion : la phrase du code, et les contacts d’Adhera', async () => {
    nav.pathname = '/bureau/connexion';
    const user = userEvent.setup();
    fakeServer([{ method: 'POST', match: 'login', ...REFUSAL('tenant_inactive') }]);
    render(<ConnexionPage />);
    await user.type(await screen.findByLabelText('E-mail'), 'bureau@exemple.sn');
    await user.type(screen.getByLabelText('Mot de passe'), 'ce-qui-est-tapé');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    const alert = await screen.findByText('L’espace de votre association est suspendu. Pour en savoir plus, écrivez à Adhera.');
    const box = alert.parentElement as HTMLElement;
    expect(within(box).getByRole('link', { name: 'contact@adhera.africa' })).toBeInTheDocument();
  });
});

describe('« Pas de réponse » ne s’écrit plus sous une question sans réponse', () => {
  it('la question reste listée, rien dessous', () => {
    const answers: MemberAnswer[] = [
      { question_id: 1, label: 'Profession', type: 'text', value: 'Enseignante', value_label: 'Enseignante', archived: false },
      { question_id: 2, label: 'Pièce d’identité', type: 'file', value: null, value_label: null, archived: false },
    ];
    render(<AnswersList answers={answers} />);
    const list = screen.getByTestId('answers');
    expect(list).toHaveTextContent('Pièce d’identité');
    expect(list).not.toHaveTextContent('Pas de réponse');
  });
});
