/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau" }
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnexionPage from '@/app/bureau/connexion/page';
import PlusPage from '@/app/bureau/plus/page';
import { useBackBar } from '@/components/bureau/BureauContext';
import { BureauFrame } from '@/components/bureau/BureauFrame';
import { getSession, navigation, resetSessionCache, saveSession } from '@/lib/bureau/session';
import { calls, fakeServer, ME, SESSION, settings } from './fixtures';

const nav = vi.hoisted(() => ({
  pathname: '/bureau',
  router: { push: vi.fn(), replace: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => nav.router,
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let replace: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.sessionStorage.clear();
  resetSessionCache();
  nav.pathname = '/bureau';
  nav.router.replace.mockReset();
  replace = vi.spyOn(navigation, 'replace').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/bureau');
});

describe('le cadre du bureau', () => {
  it('sans session : retour à la connexion, aucune donnée chargée', async () => {
    const fetchMock = fakeServer([]);
    render(<BureauFrame>contenu protégé</BureauFrame>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/bureau/connexion'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText('contenu protégé')).not.toBeInTheDocument();
  });

  it('en-tête : le nom de l’association, jamais coupé, et « Connecté·e : nom, rôle » lu par GET admin/me', async () => {
    saveSession(SESSION);
    const fetchMock = fakeServer([
      { match: 'membership/settings', body: settings({ issuer_name: 'Association des techniciens supérieurs en anesthésie-réanimation du Sénégal' }) },
      { match: /^me$/, body: ME },
      { match: 'membership/payments', body: [] },
    ]);
    const { container } = render(<BureauFrame>contenu protégé</BureauFrame>);

    await screen.findByText('contenu protégé');
    const header = container.querySelector('header') as HTMLElement;
    await within(header).findByText('Connecté·e : Fatim Diarra, Trésorière');
    const name = within(header).getByText(
      'Association des techniciens supérieurs en anesthésie-réanimation du Sénégal',
    );
    expect(name.className).toContain('break-words');
    expect(name.className).not.toContain('truncate');
    expect(calls(fetchMock).some((c) => c.url === 'https://api.eventflow.africa/api/v1/admin/me')).toBe(true);
    const logo = container.querySelector('aside img') as HTMLImageElement;
    expect(logo.src).toBe(
      'https://api.eventflow.africa/storage-tenantdemo-asso/membership/logo-e40fd0e4.png',
    );
    // Pas de bannière quand le mode est pris en charge.
    expect(screen.queryByText(/pas encore pris en charge/)).not.toBeInTheDocument();
  });

  it('GET admin/me en échec : le nom de la connexion, sans rôle inventé', async () => {
    saveSession(SESSION);
    fakeServer([
      { match: 'membership/settings', body: settings() },
      { match: /^me$/, status: 500, body: {} },
      { match: 'membership/payments', body: [] },
    ]);
    const { container } = render(<BureauFrame>contenu</BureauFrame>);
    await screen.findByText('contenu');
    const header = container.querySelector('header') as HTMLElement;
    expect(within(header).getByText('Connecté·e : Trésorier Démo')).toBeInTheDocument();
  });

  it('N1 — quatre entrées, pas une de plus, et le nombre à vérifier ; aucun « Encaisser »', async () => {
    saveSession(SESSION);
    const fetchMock = fakeServer([
      { match: 'membership/settings', body: settings() },
      { match: /^me$/, body: ME },
      { match: 'membership/payments', body: [{ id: 'a' }, { id: 'b' }] },
    ]);
    const { container } = render(<BureauFrame>contenu</BureauFrame>);
    await screen.findByText('contenu');

    const sidebar = within(container.querySelector('aside') as HTMLElement);
    const tabbar = within(screen.getByRole('navigation', { name: 'Navigation' }));
    await waitFor(() => expect(tabbar.getByTestId('verify-count')).toHaveTextContent('2'));
    expect(sidebar.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Accueil', '/bureau'],
      ['Membres', '/bureau/membres'],
      ['Paiements à vérifier2', '/bureau/a-verifier'],
      ['Plus', '/bureau/plus'],
    ]);
    expect(tabbar.getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Accueil',
      'Membres',
      'Paiements2',
      'Plus',
    ]);
    expect(tabbar.getByRole('link', { name: 'Accueil' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: /Encaisser/ })).not.toBeInTheDocument();
    // Le compteur : la file des paiements signalés, telle que le serveur la sert.
    expect(
      calls(fetchMock).some((c) => c.url.endsWith('/admin/membership/payments?status=declared')),
    ).toBe(true);
  });

  it('une entrée rangée dans « Plus » allume « Plus »', async () => {
    nav.pathname = '/bureau/campagnes';
    saveSession(SESSION);
    fakeServer([
      { match: 'membership/settings', body: settings() },
      { match: /^me$/, body: ME },
      { match: 'membership/payments', body: [] },
    ]);
    render(<BureauFrame>contenu</BureauFrame>);
    await screen.findByText('contenu');
    const tabbar = within(screen.getByRole('navigation', { name: 'Navigation' }));
    expect(tabbar.getByRole('link', { name: 'Plus' })).toHaveAttribute('aria-current', 'page');
    expect(tabbar.queryByTestId('verify-count')).not.toBeInTheDocument();
  });

  it('un écran d’un geste : « Retour » à la place de l’en-tête et de la barre du bas', async () => {
    saveSession(SESSION);
    fakeServer([
      { match: 'membership/settings', body: settings() },
      { match: /^me$/, body: ME },
      { match: 'membership/payments', body: [] },
    ]);
    function Geste() {
      useBackBar({ href: '/bureau/membres', label: 'Les membres' });
      return <p>un geste</p>;
    }
    const { container } = render(
      <BureauFrame>
        <Geste />
      </BureauFrame>,
    );
    await screen.findByText('un geste');
    expect(screen.getByRole('link', { name: 'Les membres' })).toHaveAttribute('href', '/bureau/membres');
    expect(container.querySelector('header')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('mode_is_supported: false → UNE bannière', async () => {
    saveSession(SESSION);
    fakeServer([{ match: 'membership/settings', body: settings({ mode_is_supported: false, mode_cotisation: 'exercice_civil' }) }]);
    render(<BureauFrame>contenu</BureauFrame>);
    await screen.findByText('contenu');
    expect(
      screen.getAllByText(
        'Le mode de cotisation de votre association n’est pas encore pris en charge. Contactez DIGISSOL.',
      ),
    ).toHaveLength(1);
  });

  it('se déconnecter (dans « Plus ») : révoque, purge, revient à la connexion', async () => {
    saveSession(SESSION);
    const fetchMock = fakeServer([
      { method: 'POST', match: 'logout', body: { success: true } },
      { match: 'membership/settings', body: settings() },
      { match: /^me$/, body: ME },
      { match: 'membership/payments', body: [] },
    ]);
    const user = userEvent.setup();
    render(
      <BureauFrame>
        <PlusPage />
      </BureauFrame>,
    );
    await user.click(await screen.findByRole('button', { name: 'Se déconnecter' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/bureau/connexion'));
    expect(calls(fetchMock, 'POST')[0]?.url).toBe('https://api.eventflow.africa/api/v1/admin/logout');
    expect(getSession()).toBeNull();
  });

  it('un 401 au chargement → session purgée, « expirée »', async () => {
    saveSession(SESSION);
    fakeServer([{ match: 'membership/settings', status: 401, body: { success: false, message: 'Unauthorized.' } }]);
    render(<BureauFrame>contenu</BureauFrame>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/bureau/connexion?session=expiree'));
    expect(getSession()).toBeNull();
  });

  it('la page de connexion passe au travers de la garde', () => {
    nav.pathname = '/bureau/connexion';
    render(<BureauFrame>formulaire</BureauFrame>);
    expect(screen.getByText('formulaire')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('B1 — la connexion', () => {
  async function fill(email: string, password: string) {
    const user = userEvent.setup();
    render(<ConnexionPage />);
    await user.type(await screen.findByLabelText('E-mail'), email);
    await user.type(screen.getByLabelText('Mot de passe'), password);
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
  }

  it('n’affiche ni nom ni logo d’association avant connexion', async () => {
    fakeServer([]);
    const { container } = render(<ConnexionPage />);
    await screen.findByRole('button', { name: 'Se connecter' });
    expect(document.body.textContent).not.toMatch(/Association Démo/);
    expect(container.querySelector('img')).toBeNull();
  });

  it('un 401 → un message unique, quel que soit le cas', async () => {
    fakeServer([{ method: 'POST', match: 'login', status: 401, body: { success: false, message: 'Invalid credentials.', data: null } }]);
    await fill('tresorier@demo-asso.test', 'mauvais');
    await screen.findByText('E-mail ou mot de passe incorrect.');
    expect((screen.getByLabelText('Mot de passe') as HTMLInputElement).value).toBe('');
    expect(replace).not.toHaveBeenCalled();
  });

  it('un 429 du verrou par compte : le délai réel, lu dans le corps', async () => {
    fakeServer([{
      method: 'POST', match: 'login', status: 429,
      body: { message: 'Trop de tentatives.', code: 'too_many_attempts', retry_after: 2470 },
      headers: { 'Retry-After': '60' },
    }]);
    await fill('tresorier@demo-asso.test', 'x');
    // 2 470 s = 41,2 min → 42, arrondi au supérieur. Le corps l'emporte.
    await screen.findByText('Trop de tentatives. Réessayez dans 42 minutes.');
    expect(document.body.textContent).not.toMatch(/quelques minutes/);
  });

  it('un 429 sans `retry_after` : le délai de l’en-tête `Retry-After`', async () => {
    fakeServer([{
      method: 'POST', match: 'login', status: 429,
      body: { message: 'Too Many Attempts.' },
      headers: { 'Retry-After': '3329' },
    }]);
    await fill('tresorier@demo-asso.test', 'x');
    await screen.findByText('Trop de tentatives. Réessayez dans 56 minutes.');
  });

  it('§4 — un 429 du limiteur par IP : le délai réel, lu dans `Retry-After`', async () => {
    // Le limiteur par IP ne met rien dans le corps ; l'en-tête est exposé en
    // CORS depuis S3d — le délai affiché est enfin le sien, pas une borne.
    fakeServer([{
      method: 'POST', match: 'login', status: 429,
      body: { message: 'Too Many Attempts.' },
      headers: { 'Retry-After': '170' },
    }]);
    await fill('tresorier@demo-asso.test', 'x');
    await screen.findByText('Trop de tentatives. Réessayez dans 3 minutes.');
  });

  it('un 429 du limiteur IP, sans délai lisible : sa borne, 1 minute', async () => {
    // Un serveur qui ne servirait pas l'en-tête : le repli tient encore.
    fakeServer([{ method: 'POST', match: 'login', status: 429, body: { message: 'Too Many Attempts.' } }]);
    await fill('tresorier@demo-asso.test', 'x');
    await screen.findByText('Trop de tentatives. Réessayez dans 1 minute.');
  });

  it('un succès garde le jeton dans l’onglet et ouvre le tableau de bord', async () => {
    fakeServer([{ method: 'POST', match: 'login', body: { success: true, message: 'Login successful.', data: { token: 'jeton-neuf', admin: SESSION.admin } } }]);
    await fill('tresorier@demo-asso.test', 'bon');
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/bureau'));
    expect(getSession('demo-asso')?.token).toBe('jeton-neuf');
    expect(window.localStorage.length).toBe(0);
  });

  it('F3.2 — e-mail et mot de passe : ni majuscule ni correction d’office ; « Afficher » sur le mot de passe', async () => {
    fakeServer([]);
    const user = userEvent.setup();
    render(<ConnexionPage />);
    const email = await screen.findByLabelText('E-mail');
    const password = screen.getByLabelText('Mot de passe');
    for (const el of [email, password]) {
      expect(el).toHaveAttribute('autocapitalize', 'none');
      expect(el).toHaveAttribute('autocorrect', 'off');
      expect(el).toHaveAttribute('spellcheck', 'false');
    }
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Afficher : Mot de passe' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Masquer : Mot de passe' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('après expiration : « Votre session a expiré »', async () => {
    window.history.replaceState(null, '', '/bureau/connexion?session=expiree');
    fakeServer([]);
    render(<ConnexionPage />);
    await screen.findByText('Votre session a expiré. Reconnectez-vous.');
  });
});
