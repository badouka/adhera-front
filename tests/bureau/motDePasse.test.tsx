/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/mon-mot-de-passe" }
 */

import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MonMotDePassePage, { PASSWORD_CHANGED, PASSWORD_HINT } from '@/app/bureau/mon-mot-de-passe/page';
import { getSession, navigation, resetSessionCache, saveSession } from '@/lib/bureau/session';
import { calls, fakeServer, renderInBureau, SESSION, TOKEN } from './fixtures';

beforeEach(() => {
  window.sessionStorage.clear();
  resetSessionCache();
  saveSession(SESSION);
  vi.spyOn(navigation, 'replace').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CURRENT = 'Mot de passe actuel';
const NEW = 'Nouveau mot de passe';
const CONFIRM = 'Confirmez le nouveau mot de passe';
const SAVE = 'Enregistrer mon mot de passe';

function input(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement;
}

async function fillAndSave(current: string, next: string, confirm = next) {
  const user = userEvent.setup();
  renderInBureau(<MonMotDePassePage />);
  await user.type(input(CURRENT), current);
  await user.type(input(NEW), next);
  await user.type(input(CONFIRM), confirm);
  await user.click(screen.getByRole('button', { name: SAVE }));
  return user;
}

/** Le message d'erreur affiché sous un champ (relié par `aria-describedby`). */
function errorUnder(label: string): string | null {
  const ids = input(label).getAttribute('aria-describedby')?.split(' ') ?? [];
  const el = ids.map((id) => document.getElementById(id)).find((e) => e?.id.endsWith('-error'));
  return el?.textContent ?? null;
}

describe('F3.2 — « Mon mot de passe » : le formulaire', () => {
  it('trois champs sur une colonne, l’aide sous le nouveau, les attributs anti-correction', () => {
    renderInBureau(<MonMotDePassePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Mon mot de passe' })).toBeInTheDocument();
    expect(input(CURRENT)).toHaveAttribute('autocomplete', 'current-password');
    expect(input(NEW)).toHaveAttribute('autocomplete', 'new-password');
    expect(input(CONFIRM)).toHaveAttribute('autocomplete', 'new-password');
    for (const label of [CURRENT, NEW, CONFIRM]) {
      const el = input(label);
      expect(el).toHaveAttribute('type', 'password');
      expect(el).toHaveAttribute('autocapitalize', 'none');
      expect(el).toHaveAttribute('autocorrect', 'off');
      expect(el).toHaveAttribute('spellcheck', 'false');
    }
    expect(screen.getByText(PASSWORD_HINT)).toBeInTheDocument();
    expect(input(NEW).getAttribute('aria-describedby')).toMatch(/-hint/);
    expect(PASSWORD_HINT).toBe(
      '8 caractères minimum. Deux mots et quelques chiffres suffisent, par exemple Baobab-Lagune-4827.',
    );
    expect(screen.getByRole('button', { name: SAVE })).toHaveAttribute('type', 'submit');
  });

  it('« Afficher » bascule le type de SON champ, et lui seul ; « Masquer » le remet', async () => {
    const user = userEvent.setup();
    renderInBureau(<MonMotDePassePage />);
    const toggle = screen.getByRole('button', { name: `Afficher : ${NEW}` });
    expect(toggle).toHaveTextContent('Afficher');
    expect(toggle).toHaveAttribute('type', 'button');
    await user.click(toggle);
    expect(input(NEW)).toHaveAttribute('type', 'text');
    expect(input(CURRENT)).toHaveAttribute('type', 'password');
    expect(input(CONFIRM)).toHaveAttribute('type', 'password');
    expect(toggle).toHaveTextContent('Masquer');
    await user.click(screen.getByRole('button', { name: `Masquer : ${NEW}` }));
    expect(input(NEW)).toHaveAttribute('type', 'password');
    // Chacun des trois champs a le sien.
    expect(screen.getAllByRole('button', { name: /^Afficher : / })).toHaveLength(3);
  });

  it('envoie EXACTEMENT { current_password, password, password_confirmation } en PUT me/password', async () => {
    const fetchMock = fakeServer([{ method: 'PUT', match: 'me/password', body: { message: 'Votre mot de passe a été changé.' } }]);
    await fillAndSave('Ancien-Mot-1', 'Baobab-Lagune-4827', 'Baobab-Lagune-4827');
    await screen.findByText(PASSWORD_CHANGED);
    const [call] = calls(fetchMock, 'PUT');
    expect(call?.url).toBe('https://api.eventflow.africa/api/v1/admin/me/password');
    expect(JSON.parse(call?.init.body as string)).toStrictEqual({
      current_password: 'Ancien-Mot-1',
      password: 'Baobab-Lagune-4827',
      password_confirmation: 'Baobab-Lagune-4827',
    });
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['X-Tenant-Slug']).toBe('demo-asso');
  });

  it('un champ vide est arrêté avant tout envoi', async () => {
    const fetchMock = fakeServer([]);
    const user = userEvent.setup();
    renderInBureau(<MonMotDePassePage />);
    await user.type(input(NEW), 'Baobab-Lagune-4827');
    await user.click(screen.getByRole('button', { name: SAVE }));
    // Les libellés du serveur (§14.2) pour les deux premiers champs.
    expect(errorUnder(CURRENT)).toBe('Saisissez votre mot de passe actuel.');
    expect(errorUnder(CONFIRM)).toBe('Retapez le nouveau mot de passe à l’identique.');
    expect(errorUnder(NEW)).toBeNull();
    expect(input(CURRENT)).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('F3.2 — « Mon mot de passe » : les réponses', () => {
  it('200 : le message de succès, les champs vidés et remasqués, et on reste connecté', async () => {
    fakeServer([{ method: 'PUT', match: 'me/password', body: { message: 'Votre mot de passe a été changé.' } }]);
    const user = await fillAndSave('Ancien-Mot-1', 'Baobab-Lagune-4827');
    expect(await screen.findByRole('status')).toHaveTextContent(PASSWORD_CHANGED);
    expect(PASSWORD_CHANGED).toBe(
      'Votre mot de passe a été changé. Vos autres appareils ont été déconnectés : il faudra vous y reconnecter.',
    );
    for (const label of [CURRENT, NEW, CONFIRM]) {
      expect(input(label).value).toBe('');
      expect(input(label)).toHaveAttribute('type', 'password');
    }
    // La session de cet onglet n'est pas touchée : même jeton, aucune redirection.
    expect(getSession('demo-asso')?.token).toBe(TOKEN);
    expect(navigation.replace).not.toHaveBeenCalled();
    // Retaper efface le message de succès.
    await user.type(input(CURRENT), 'x');
    expect(screen.queryByText(PASSWORD_CHANGED)).toBeNull();
  });

  it('422 (§14.2) : chaque message du serveur sous SON champ, tel quel ; le `message` commun n’est pas répété', async () => {
    const errors = {
      current_password: [
        'Le mot de passe actuel est incorrect. Si vous l’avez oublié, demandez une réinitialisation à votre contact DIGISSOL.',
      ],
      password: [
        'Le nouveau mot de passe doit faire au moins 8 caractères. Deux mots et quelques chiffres suffisent, par exemple « Baobab-Lagune-4827 ».',
      ],
    };
    fakeServer([{
      method: 'PUT', match: 'me/password', status: 422,
      body: { message: 'Le mot de passe n’a pas été changé.', errors },
    }]);
    await fillAndSave('faux', 'court');
    await waitFor(() => expect(errorUnder(CURRENT)).toBe(errors.current_password[0]));
    expect(errorUnder(NEW)).toBe(errors.password[0]);
    expect(errorUnder(CONFIRM)).toBeNull();
    expect(input(CURRENT)).toHaveAttribute('aria-invalid', 'true');
    expect(input(CURRENT)).toHaveFocus();
    expect(screen.queryByText('Le mot de passe n’a pas été changé.')).toBeNull();
    expect(screen.queryByText(PASSWORD_CHANGED)).toBeNull();
    // Un 422 ne déconnecte pas.
    expect(getSession('demo-asso')?.token).toBe(TOKEN);
  });

  it('422 : la confirmation différente arrive sous `password` et reste sous « Nouveau mot de passe »', async () => {
    const mismatch =
      'La confirmation ne correspond pas au nouveau mot de passe : retapez-le à l’identique dans le second champ.';
    fakeServer([{
      method: 'PUT', match: 'me/password', status: 422,
      body: { message: 'Le mot de passe n’a pas été changé.', errors: { password: [mismatch] } },
    }]);
    await fillAndSave('Baobab-Lagune-4827', 'Sagesse-Citron-3376', 'Sagesse-Citron-3377');
    await waitFor(() => expect(errorUnder(NEW)).toBe(mismatch));
    expect(errorUnder(CONFIRM)).toBeNull();
    expect(errorUnder(CURRENT)).toBeNull();
    expect(input(NEW)).toHaveFocus();
  });

  it('422 : plusieurs messages pour un même champ sont tous affichés, bout à bout', async () => {
    const messages = [
      'Le nouveau mot de passe doit être différent de l’actuel.',
      'Ce mot de passe est trop courant : c’est l’un des premiers qu’un intrus essaie.',
    ];
    fakeServer([{
      method: 'PUT', match: 'me/password', status: 422,
      body: { message: 'Le mot de passe n’a pas été changé.', errors: { password: messages } },
    }]);
    await fillAndSave('azerty123', 'azerty123');
    await waitFor(() => expect(errorUnder(NEW)).toBe(messages.join(' ')));
  });

  it('422 sur un seul champ : les deux autres restent sans erreur', async () => {
    fakeServer([{
      method: 'PUT', match: 'me/password', status: 422,
      body: {
        message: 'Le mot de passe n’a pas été changé.',
        errors: { password: ['Le mot de passe ne peut pas contenir le nom de votre espace (« demo-asso ») : choisissez autre chose.'] },
      },
    }]);
    await fillAndSave('Ancien-Mot-1', 'demo-asso-2026');
    await waitFor(() => expect(errorUnder(NEW)).toMatch(/^Le mot de passe ne peut pas contenir le nom de votre espace/));
    expect(errorUnder(CURRENT)).toBeNull();
    expect(errorUnder(CONFIRM)).toBeNull();
    expect(input(NEW)).toHaveFocus();
  });

  it('429 (§14.3, forme nue, sans `code`) : le délai est lu dans `Retry-After`', async () => {
    fakeServer([{
      method: 'PUT', match: 'me/password', status: 429,
      body: { message: 'Too Many Attempts.' }, headers: { 'Retry-After': '170' },
    }]);
    await fillAndSave('Ancien-Mot-1', 'Baobab-Lagune-4827');
    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives. Réessayez dans 3 minutes.');
  });

  it('429 du verrou par compte (10 / heure) : le délai long de `Retry-After`', async () => {
    fakeServer([{
      method: 'PUT', match: 'me/password', status: 429,
      body: { message: 'Too Many Attempts.' }, headers: { 'Retry-After': '3329' },
    }]);
    await fillAndSave('Ancien-Mot-1', 'Baobab-Lagune-4827');
    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives. Réessayez dans 56 minutes.');
  });

  it('coupure réseau : « Connexion impossible. Vérifiez votre réseau, puis réessayez. »', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await fillAndSave('Ancien-Mot-1', 'Baobab-Lagune-4827');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Connexion impossible\. Vérifiez votre réseau, puis réessayez\.$/,
    );
    // Rien n'est perdu : on peut réessayer sans tout retaper.
    expect(input(NEW).value).toBe('Baobab-Lagune-4827');
  });
});
