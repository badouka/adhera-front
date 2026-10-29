/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau" }
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  currentTenant,
  expireSession,
  getSession,
  loginHref,
  navigation,
  resetSessionCache,
  saveSession,
  subscribe,
} from '@/lib/bureau/session';
import { SESSION } from './fixtures';

const KEY = 'adhera.bureau.session';

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetSessionCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('R7 — où vit le jeton', () => {
  it('écrit en sessionStorage, jamais en localStorage ni en cookie', () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    saveSession(SESSION);

    // Le seul setItem passé l'a été sur sessionStorage.
    expect(local).toHaveBeenCalledTimes(1);
    expect(local.mock.contexts[0]).toBe(window.sessionStorage);
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(JSON.parse(window.sessionStorage.getItem(KEY) as string).token).toBe(SESSION.token);
  });

  it('relit la session après un rechargement de l’onglet', () => {
    saveSession(SESSION);
    resetSessionCache(); // la mémoire est perdue, sessionStorage reste
    expect(getSession('demo-asso')?.token).toBe(SESSION.token);
  });

  it('purge la mémoire ET sessionStorage', () => {
    saveSession(SESSION);
    clearSession();
    expect(getSession()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    resetSessionCache();
    expect(getSession()).toBeNull();
  });

  it('refuse un jeton émis pour une autre association, et le purge', () => {
    saveSession({ ...SESSION, tenant: 'autre-asso' });
    expect(getSession('demo-asso')).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('ignore une entrée corrompue', () => {
    window.sessionStorage.setItem(KEY, '{pas du json');
    expect(getSession()).toBeNull();
    window.sessionStorage.setItem(KEY, JSON.stringify({ token: '' }));
    resetSessionCache();
    expect(getSession()).toBeNull();
  });

  it('prévient les abonnés d’une purge', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    saveSession(SESSION);
    clearSession();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe('expiration', () => {
  it('purge et renvoie à la connexion avec « session expirée »', () => {
    const replace = vi.spyOn(navigation, 'replace').mockImplementation(() => {});
    saveSession(SESSION);

    expireSession();

    expect(getSession()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(replace).toHaveBeenCalledWith('/bureau/connexion?session=expiree');
  });
});

describe('le tenant', () => {
  it('vient du sous-domaine', () => {
    expect(currentTenant()).toBe('demo-asso');
  });

  it('en production, ne retombe JAMAIS sur la session hors sous-domaine', () => {
    saveSession(SESSION);
    expect(currentTenant({ hostname: 'example.com', search: '' }, true)).toBeNull();
  });

  it('en local, garde le tenant de la session entre deux pages', () => {
    saveSession(SESSION);
    expect(currentTenant({ hostname: 'localhost', search: '' }, false)).toBe('demo-asso');
  });

  it('sur le sous-domaine, l’URL de connexion ne porte pas le tenant', () => {
    expect(loginHref(false, 'demo-asso')).toBe('/bureau/connexion');
    expect(loginHref(true, 'demo-asso')).toBe('/bureau/connexion?session=expiree');
  });
});
