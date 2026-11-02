import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le service worker LIVRÉ (`public/m/sw.js`), exécuté tel quel dans un bac à
 * sable : un faux `self`, un faux `caches`, un faux `fetch`.
 */
const SOURCE = readFileSync(join(process.cwd(), 'public', 'm', 'sw.js'), 'utf8');
const ORIGIN = 'https://demo-asso.adhera.africa';
const API = 'https://api.eventflow.africa/api/v1';
const TOKEN = 'a'.repeat(64);

type FakeRequest = {
  url: string;
  method: string;
  headers: Headers;
  mode: string;
  destination: string;
};

function req(url: string, init: Partial<Omit<FakeRequest, 'url' | 'headers'>> & { headers?: Record<string, string> } = {}): FakeRequest {
  return {
    url,
    method: init.method ?? 'GET',
    headers: new Headers(init.headers ?? {}),
    mode: init.mode ?? 'cors',
    destination: init.destination ?? '',
  };
}

function load() {
  const store = new Map<string, Response>();
  const cache = {
    put: vi.fn(async (key: string, response: Response) => {
      store.set(key, response);
    }),
    match: vi.fn(async (key: string) => store.get(key)?.clone()),
    delete: vi.fn(async (key: string) => store.delete(key)),
  };
  const listeners: Record<string, (event: unknown) => void> = {};
  const fetchMock = vi.fn();
  const self = {
    location: new URL(`${ORIGIN}/m/sw.js`),
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  } as Record<string, unknown>;
  runInNewContext(SOURCE, {
    self,
    caches: { open: vi.fn(async () => cache), keys: vi.fn(async () => []), delete: vi.fn() },
    fetch: fetchMock,
    URL,
    Headers,
    Response,
    Promise,
    Array,
    JSON,
    Date,
  });
  const api = self.__adheraCarte as {
    neverCache: (r: FakeRequest) => boolean;
    strategy: (r: FakeRequest) => string | null;
  };

  /** Dispatche un `fetch` : rend la réponse servie, ou `undefined` si le SW s'abstient. */
  function dispatch(request: FakeRequest): Promise<Response> | undefined {
    let served: Promise<Response> | undefined;
    listeners.fetch?.({ request, respondWith: (p: Promise<Response>) => (served = p) });
    return served;
  }

  return { api, cache, store, fetchMock, dispatch, listeners };
}

let sw: ReturnType<typeof load>;
beforeEach(() => {
  sw = load();
});

describe('service worker — ce qu’il ne met JAMAIS en cache', () => {
  it('une requête qui porte Authorization, même vers la route du membre', () => {
    const request = req(`${API}/m/${TOKEN}`, { headers: { Authorization: 'Bearer x' } });
    expect(sw.api.neverCache(request)).toBe(true);
    expect(sw.dispatch(request)).toBeUndefined();
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });

  it('l’espace du bureau : ses pages et son API', () => {
    for (const request of [
      req(`${ORIGIN}/bureau`, { mode: 'navigate' }),
      req(`${ORIGIN}/bureau/membres/01a1`, { mode: 'navigate' }),
      req(`${ORIGIN}/bureau/connexion?tenant=x`, { mode: 'navigate' }),
      req(`${API}/admin/membership/members`),
      req(`${API}/admin/membership/documents/01a1/pdf`),
      req(`${API}/admin/login`, { method: 'POST' }),
    ]) {
      expect(sw.api.neverCache(request)).toBe(true);
      expect(sw.dispatch(request)).toBeUndefined();
    }
  });

  it('la vérification publique : /v/ et son API', () => {
    for (const request of [
      req(`${ORIGIN}/v/5RGF6J9Z2UJX`, { mode: 'navigate' }),
      req(`${ORIGIN}/v/5RGF6J9Z2UJX?attestation=ATT-2026-9D2E0D3C`, { mode: 'navigate' }),
      req(`${API}/membership/verify/5RGF6J9Z2UJX`),
    ]) {
      expect(sw.api.neverCache(request)).toBe(true);
      expect(sw.dispatch(request)).toBeUndefined();
    }
  });

  it('le PDF de l’attestation, les reçus, et tout ce qui n’est pas un GET', () => {
    for (const request of [
      req(`${API}/m/${TOKEN}/attestation?tenant=demo-asso`),
      req(`${API}/m/${TOKEN}/receipts/01a1?tenant=demo-asso`),
      req(`${API}/m/${TOKEN}/payments`, { method: 'POST' }),
      req(`${API}/m/${TOKEN}?tenant=x`, { method: 'PUT' }),
    ]) {
      expect(sw.api.neverCache(request)).toBe(true);
      expect(sw.dispatch(request)).toBeUndefined();
    }
  });

  it('aucun autre hôte', () => {
    expect(sw.api.neverCache(req('https://example.com/x.js'))).toBe(true);
  });
});

describe('service worker — réseau d’abord, cache ensuite', () => {
  const memberUrl = `${API}/m/${TOKEN}`;

  it('en ligne : la réponse du réseau, et une copie datée dans le cache', async () => {
    sw.fetchMock.mockResolvedValue(new Response('{"card":null}', { status: 200 }));
    const response = await sw.dispatch(req(memberUrl, { headers: { 'X-Tenant-Slug': 'demo-asso' } }));
    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
    expect(await response!.text()).toBe('{"card":null}');
    expect(response!.headers.get('X-Adhera-Hors-Connexion')).toBeNull();
    const stored = sw.store.get(memberUrl)!;
    expect(stored.headers.get('X-Adhera-Enregistre-Le')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('hors connexion : la copie gardée, marquée « hors connexion »', async () => {
    sw.fetchMock.mockResolvedValueOnce(new Response('{"v":1}', { status: 200 }));
    await (await sw.dispatch(req(memberUrl)))!.text();
    sw.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const response = await sw.dispatch(req(memberUrl));
    expect(await response!.text()).toBe('{"v":1}');
    expect(response!.headers.get('X-Adhera-Hors-Connexion')).toBe('1');
    expect(response!.headers.get('X-Adhera-Enregistre-Le')).toBeTruthy();
  });

  it('hors connexion, sans copie : l’échec du réseau remonte (écran « Erreur technique »)', async () => {
    sw.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(sw.dispatch(req(memberUrl))).rejects.toThrow('Failed to fetch');
  });

  it('un 404 (lien régénéré) efface la copie : plus de carte hors connexion', async () => {
    sw.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await sw.dispatch(req(memberUrl));
    sw.fetchMock.mockResolvedValueOnce(new Response('{"code":"member_not_found"}', { status: 404 }));
    const response = await sw.dispatch(req(memberUrl));
    expect(response!.status).toBe(404);
    expect(sw.store.has(memberUrl)).toBe(false);
  });

  it('une erreur serveur n’écrase pas la copie', async () => {
    sw.fetchMock.mockResolvedValueOnce(new Response('{"v":1}', { status: 200 }));
    await sw.dispatch(req(memberUrl));
    sw.fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    expect((await sw.dispatch(req(memberUrl)))!.status).toBe(500);
    expect(await sw.store.get(memberUrl)!.text()).toBe('{"v":1}');
  });

  it('la page du membre : réseau d’abord, rangée sans `?vue=carte`', async () => {
    sw.fetchMock.mockResolvedValueOnce(new Response('<html>carte</html>', { status: 200 }));
    await sw.dispatch(req(`${ORIGIN}/m/${TOKEN}?vue=carte`, { mode: 'navigate' }));
    expect(sw.store.has(`${ORIGIN}/m/${TOKEN}`)).toBe(true);
    sw.fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const response = await sw.dispatch(req(`${ORIGIN}/m/${TOKEN}?vue=carte`, { mode: 'navigate' }));
    expect(await response!.text()).toBe('<html>carte</html>');
  });

  it('les scripts de l’app : cache d’abord (empreints)', async () => {
    const url = `${ORIGIN}/_next/static/chunks/abc123.js`;
    sw.fetchMock.mockResolvedValueOnce(new Response('js', { status: 200 }));
    await sw.dispatch(req(url));
    await sw.dispatch(req(url));
    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('les stratégies, une par une', () => {
    expect(sw.api.strategy(req(memberUrl))).toBe('member-api');
    expect(sw.api.strategy(req(`${ORIGIN}/m/${TOKEN}`, { mode: 'navigate' }))).toBe('page');
    expect(sw.api.strategy(req(`${ORIGIN}/m/${TOKEN}/manifest.webmanifest?nom=X`))).toBe('network-first');
    expect(sw.api.strategy(req(`${ORIGIN}/carte/icone-192.png`))).toBe('cache-first');
    expect(
      sw.api.strategy(
        req('https://api.eventflow.africa/storage-tenantdemo-asso/membership/logo.png', { destination: 'image' }),
      ),
    ).toBe('network-first');
    expect(sw.api.strategy(req(`${ORIGIN}/`, { mode: 'navigate' }))).toBeNull();
  });
});

describe('service worker — ce que la page lui remet', () => {
  function message(data: unknown) {
    let done: Promise<unknown> = Promise.resolve();
    sw.listeners.message?.({ data, waitUntil: (p: Promise<unknown>) => (done = p) });
    return done;
  }

  it('la réponse du membre, à sa seule adresse exacte', async () => {
    await message({ type: 'precache', urls: [], member: { url: `${API}/m/${TOKEN}`, body: '{"a":1}' } });
    expect(sw.store.has(`${API}/m/${TOKEN}`)).toBe(true);

    for (const url of [
      `${API}/admin/membership/members`,
      `${API}/membership/verify/X`,
      `${API}/m/${TOKEN}/attestation`,
      `${API}/m/${TOKEN}?x=1`,
      `https://evil.example/api/v1/m/${TOKEN}`,
    ]) {
      await message({ type: 'precache', urls: [], member: { url, body: '{}' } });
      expect(sw.store.has(url)).toBe(false);
    }
  });

  it('les scripts de l’app et la page du membre, rien d’autre', async () => {
    sw.fetchMock.mockImplementation(async () => new Response('x', { status: 200 }));
    await message({
      type: 'precache',
      urls: [
        `/m/${TOKEN}`,
        `${ORIGIN}/_next/static/chunks/a.js`,
        `${ORIGIN}/bureau/membres`,
        `${ORIGIN}/v/CODE`,
        'https://evil.example/_next/static/x.js',
      ],
    });
    expect([...sw.store.keys()].sort()).toEqual(
      [`${ORIGIN}/_next/static/chunks/a.js`, `${ORIGIN}/m/${TOKEN}`].sort(),
    );
  });
});
