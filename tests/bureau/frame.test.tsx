/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau" }
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnexionPage from '@/app/bureau/connexion/page';
import { BureauFrame } from '@/components/bureau/BureauFrame';
import { getSession, navigation, resetSessionCache, saveSession } from '@/lib/bureau/session';
import { calls, fakeServer, SESSION, settings } from './fixtures';

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

  it('en-tête : nom et logo de l’association, personne connectée, déconnexion', async () => {
    saveSession(SESSION);
    fakeServer([{ match: 'membership/settings', body: settings() }]);
    const { container } = render(<BureauFrame>contenu protégé</BureauFrame>);

    await screen.findByText('contenu protégé');
    expect(screen.getAllByText('Association Démo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Trésorier Démo').length).toBeGreaterThan(0);
    const logo = container.querySelector('img') as HTMLImageElement;
    expect(logo.src).toBe(
      'https://api.eventflow.africa/storage-tenantdemo-asso/membership/logo-e40fd0e4.png',
    );
    expect(screen.getAllByRole('button', { name: 'Se déconnecter' }).length).toBeGreaterThan(0);
    // Pas de bannière quand le mode est pris en charge.
    expect(screen.queryByText(/pas encore pris en charge/)).not.toBeInTheDocument();
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

  it('se déconnecter : révoque, purge, revient à la connexion', async () => {
    saveSession(SESSION);
    const fetchMock = fakeServer([
      { method: 'POST', match: 'logout', body: { success: true } },
      { match: 'membership/settings', body: settings() },
    ]);
    const user = userEvent.setup();
    render(<BureauFrame>contenu</BureauFrame>);
    await screen.findByText('contenu');

    await user.click(screen.getAllByRole('button', { name: 'Se déconnecter' })[0] as HTMLElement);

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

  it('un 429 → « Trop de tentatives »', async () => {
    fakeServer([{ method: 'POST', match: 'login', status: 429, body: { message: 'Too Many Attempts.' } }]);
    await fill('tresorier@demo-asso.test', 'x');
    await screen.findByText('Trop de tentatives, réessayez dans quelques minutes.');
  });

  it('un succès garde le jeton dans l’onglet et ouvre « À valider »', async () => {
    fakeServer([{ method: 'POST', match: 'login', body: { success: true, message: 'Login successful.', data: { token: 'jeton-neuf', admin: SESSION.admin } } }]);
    await fill('tresorier@demo-asso.test', 'bon');
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/bureau'));
    expect(getSession('demo-asso')?.token).toBe('jeton-neuf');
    expect(window.localStorage.length).toBe(0);
  });

  it('après expiration : « Votre session a expiré »', async () => {
    window.history.replaceState(null, '', '/bureau/connexion?session=expiree');
    fakeServer([]);
    render(<ConnexionPage />);
    await screen.findByText('Votre session a expiré. Reconnectez-vous.');
  });
});
