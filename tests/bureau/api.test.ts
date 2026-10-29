/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau" }
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BureauApiError,
  buildQuery,
  deleteCategory,
  fetchDocument,
  getProofUrl,
  INVALID_CREDENTIALS,
  isSessionError,
  listMembers,
  listPayments,
  login,
  logout,
  createMember,
} from '@/lib/bureau/api';
import { getSession, navigation, resetSessionCache, saveSession } from '@/lib/bureau/session';
import { fakeResponse, memberItem, SESSION, TOKEN } from './fixtures';

const fetchMock = vi.fn();
let replace: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.sessionStorage.clear();
  resetSessionCache();
  saveSession(SESSION);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  replace = vi.spyOn(navigation, 'replace').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastInit(): RequestInit {
  return fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
}

describe('les en-têtes de chaque appel', () => {
  it('posent Authorization, X-Tenant-Slug, Accept et no-store', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, []));
    await listMembers({});

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.eventflow.africa/api/v1/admin/membership/members');
    const headers = lastInit().headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['X-Tenant-Slug']).toBe('demo-asso');
    expect(headers.Accept).toBe('application/json');
    expect(lastInit().cache).toBe('no-store');
    expect(lastInit().referrerPolicy).toBe('no-referrer');
  });

  it('n’envoie pas les filtres vides (vide vaut « absent »)', () => {
    expect(buildQuery({ status: '', standing: 'up_to_date', search: '  ', category_id: 2 })).toBe(
      '?standing=up_to_date&category_id=2',
    );
    expect(buildQuery({})).toBe('');
  });

  it('demande l’historique d’un membre avec status=all', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, []));
    await listPayments({ member_id: 'abc', status: 'all' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.eventflow.africa/api/v1/admin/membership/payments?member_id=abc&status=all',
    );
  });
});

describe('les deux enveloppes', () => {
  it('admin/membership/* : un tableau NU', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, [memberItem()]));
    const members = await listMembers({});
    expect(members).toHaveLength(1);
    expect(members[0]?.name).toBe('Moussa Ndiaye (test)');
  });

  it('login : { success, message, data }', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(200, {
        success: true,
        message: 'Login successful.',
        data: { token: 'nouveau', admin: SESSION.admin },
      }),
    );
    const data = await login('demo-asso', 'tresorier@demo-asso.test', 'secret');
    expect(data.token).toBe('nouveau');
    expect(data.admin.name).toBe('Trésorier Démo');
    // La connexion ne porte pas d'Authorization.
    expect((lastInit().headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('login : un succès sans data est refusé', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { success: false, message: 'x', data: null }));
    await expect(login('demo-asso', 'a@b.c', 'x')).rejects.toBeInstanceOf(BureauApiError);
  });
});

describe('R7 — un 401 purge et redirige', () => {
  it('sur une route quelconque', async () => {
    fetchMock.mockResolvedValue(fakeResponse(401, { success: false, message: 'Unauthorized.' }));

    const error = await listPayments({ status: 'declared' }).catch((e) => e);

    expect(isSessionError(error)).toBe(true);
    expect(getSession()).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
    expect(replace).toHaveBeenCalledWith('/bureau/connexion?session=expiree');
  });

  it('aussi sur un téléchargement de reçu', async () => {
    fetchMock.mockResolvedValue(fakeResponse(401, {}));
    await fetchDocument('r-1').catch(() => {});
    expect(getSession()).toBeNull();
    expect(replace).toHaveBeenCalledWith('/bureau/connexion?session=expiree');
  });

  it('mais PAS le 401 de la connexion : c’est un refus d’identifiants', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(401, { success: false, message: 'Invalid credentials.', data: null }),
    );
    const error = await login('demo-asso', 'a@b.c', 'faux').catch((e) => e);
    expect(error).toBeInstanceOf(BureauApiError);
    expect(error.code).toBe(INVALID_CREDENTIALS);
    expect(replace).not.toHaveBeenCalled();
    expect(getSession()).not.toBeNull();
  });

  it('sans session, n’appelle même pas l’API', async () => {
    window.sessionStorage.clear();
    resetSessionCache();
    const error = await listMembers({}).catch((e) => e);
    expect(isSessionError(error)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/bureau/connexion');
  });
});

describe('les erreurs typées', () => {
  it('un 422 avec code → code et corps conservés', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(422, {
        message: 'Cette catégorie est utilisée : la désactiver plutôt que la supprimer.',
        code: 'category_in_use',
        members: 6,
        dues: 7,
      }),
    );
    const error = await deleteCategory(1).catch((e) => e);
    expect(error).toBeInstanceOf(BureauApiError);
    expect(error.status).toBe(422);
    expect(error.code).toBe('category_in_use');
    expect(error.body.members).toBe(6);
    expect(error.body.dues).toBe(7);
  });

  it('un 422 de validation → errors par champ, sans code', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(422, {
        message: 'Membre invalide.',
        errors: { name: ['The name field is required.'] },
      }),
    );
    const error = await createMember({
      type: 'personne', name: '', phone: null, email: null, region: null, category_id: null, joined_at: null,
    }).catch((e) => e);
    expect(error.status).toBe(422);
    expect(error.code).toBeNull();
    expect(Object.keys(error.errors)).toEqual(['name']);
  });

  it('une panne réseau → statut 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await listMembers({}).catch((e) => e);
    expect(error.status).toBe(0);
  });
});

describe('le justificatif', () => {
  it('rend le lien signé TEL QUEL', async () => {
    const signed = 'https://api.eventflow.africa/api/v1/proof/x?tenant=demo-asso&signature=abc';
    fetchMock.mockResolvedValue(fakeResponse(200, { url: signed }));
    expect(await getProofUrl('p-1')).toBe(signed);
  });
});

describe('la déconnexion', () => {
  it('révoque le jeton puis purge, même si le réseau tombe', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await logout();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.eventflow.africa/api/v1/admin/logout');
    expect(getSession()).toBeNull();
  });
});
