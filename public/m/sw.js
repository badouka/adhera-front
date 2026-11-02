/*
 * Le service worker de la carte de membre (Adhera F4, § 1.4).
 *
 * Il est servi depuis /m/ : il ne peut contrôler que les pages de membre
 * (/m/{jeton}), jamais l'espace du bureau ni la page de vérification /v/.
 *
 * Ce qu'il garde, en « réseau d'abord, cache ensuite » :
 * - la dernière réponse de GET /api/v1/m/{jeton} (et rien sous ce chemin) ;
 * - la page du membre elle-même, pour qu'elle s'ouvre sans réseau ;
 * - les scripts et la police de l'app (/_next/static/, empreints : « cache
 *   d'abord »), l'icône neutre, le manifeste et le logo de l'association.
 *
 * Ce qu'il ne garde JAMAIS (`neverCache`, vérifié par un test) :
 * - une requête qui porte `Authorization` ;
 * - une adresse de l'espace du bureau (/bureau, /api/v1/admin/) ;
 * - la vérification publique (/v/, /api/v1/membership/verify/) ;
 * - le PDF de l'attestation, les reçus, et tout ce qui n'est pas un GET.
 *
 * Sans réseau, la réponse gardée porte deux en-têtes que la page lit pour
 * afficher « Hors connexion — informations du … ».
 */

var CACHE = 'adhera-carte-v1';
var API_ORIGIN = 'https://api.eventflow.africa';
var OFFLINE_HEADER = 'X-Adhera-Hors-Connexion';
var SAVED_AT_HEADER = 'X-Adhera-Enregistre-Le';

var MEMBER_API = /^\/api\/v1\/m\/[A-Za-z0-9_-]+$/;
var MEMBER_PAGE = /^\/m\/[A-Za-z0-9_-]+\/?$/;
var MEMBER_MANIFEST = /^\/m\/[A-Za-z0-9_-]+\/manifest\.webmanifest$/;

function header(request, name) {
  var headers = request.headers;
  if (!headers) return null;
  return typeof headers.get === 'function' ? headers.get(name) : null;
}

/** Vrai pour tout ce qui ne doit JAMAIS entrer dans le cache. */
function neverCache(request) {
  if ((request.method || 'GET').toUpperCase() !== 'GET') return true;
  if (header(request, 'Authorization')) return true;

  var url = new URL(request.url);
  var path = url.pathname;

  if (url.origin === self.location.origin) {
    if (path === '/bureau' || path.indexOf('/bureau/') === 0) return true;
    if (path === '/v' || path.indexOf('/v/') === 0) return true;
    return false;
  }

  if (url.origin === API_ORIGIN) {
    if (path.indexOf('/api/v1/admin') === 0) return true;
    if (path.indexOf('/api/v1/membership/') === 0) return true;
    // Sous /m/{jeton}/ : l'attestation, les reçus, les paiements.
    if (path.indexOf('/api/v1/m/') === 0 && !MEMBER_API.test(path)) return true;
    return false;
  }

  // Aucun autre hôte n'est contacté par la page (R3).
  return true;
}

/** La stratégie d'une requête, ou `null` : le réseau seul, sans cache. */
function strategy(request) {
  if (neverCache(request)) return null;

  var url = new URL(request.url);
  var path = url.pathname;

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate' && MEMBER_PAGE.test(path)) return 'page';
    if (MEMBER_MANIFEST.test(path)) return 'network-first';
    if (path.indexOf('/_next/static/') === 0) return 'cache-first';
    if (path.indexOf('/carte/') === 0) return 'cache-first';
    return null;
  }

  // url.origin === API_ORIGIN (les autres hôtes sont écartés plus haut).
  if (MEMBER_API.test(path)) return 'member-api';
  // Le logo de l'association (`logo_url`), versionné par son contenu.
  if (path.indexOf('/storage-') === 0 && request.destination === 'image') return 'network-first';
  return null;
}

/** La clé d'une page : sans `?vue=carte`, la même page sous ses deux vues. */
function pageKey(request) {
  var url = new URL(request.url);
  return url.origin + url.pathname.replace(/\/$/, '');
}

function stamp(response) {
  var headers = new Headers(response.headers);
  headers.set(SAVED_AT_HEADER, new Date().toISOString());
  return response.blob().then(function (body) {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers,
    });
  });
}

function offline(cached) {
  var headers = new Headers(cached.headers);
  headers.set(OFFLINE_HEADER, '1');
  return cached.blob().then(function (body) {
    return new Response(body, {
      status: cached.status,
      statusText: cached.statusText,
      headers: headers,
    });
  });
}

function memberApi(request) {
  var key = request.url;
  return caches.open(CACHE).then(function (cache) {
    return fetch(request).then(
      function (response) {
        if (response.ok) {
          return stamp(response.clone()).then(function (copy) {
            return cache.put(key, copy).then(function () {
              return response;
            });
          });
        }
        // Un lien régénéré (404) ne doit plus montrer la carte hors connexion.
        if (response.status === 404) {
          return cache.delete(key).then(function () {
            return response;
          });
        }
        return response;
      },
      function (error) {
        return cache.match(key).then(function (cached) {
          if (!cached) throw error;
          return offline(cached);
        });
      },
    );
  });
}

function networkFirst(request, key) {
  return caches.open(CACHE).then(function (cache) {
    return fetch(request).then(
      function (response) {
        // Une réponse opaque (logo sans CORS) se garde aussi : elle n'a pas d'`ok`.
        if (response.ok || response.type === 'opaque') {
          return cache.put(key, response.clone()).then(function () {
            return response;
          });
        }
        return response;
      },
      function (error) {
        return cache.match(key).then(function (cached) {
          if (!cached) throw error;
          return cached;
        });
      },
    );
  });
}

function cacheFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request.url).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (!response.ok) return response;
        return cache.put(request.url, response.clone()).then(function () {
          return response;
        });
      });
    });
  });
}

function handle(request) {
  var kind = strategy(request);
  if (kind === 'member-api') return memberApi(request);
  if (kind === 'page') return networkFirst(request, pageKey(request));
  if (kind === 'network-first') return networkFirst(request, request.url);
  if (kind === 'cache-first') return cacheFirst(request);
  return null;
}

/**
 * La page envoie, une fois chargée, les scripts qu'elle a déjà lus : ils sont
 * arrivés AVANT que ce service worker ne la contrôle, et sans eux la page ne
 * s'ouvrirait pas hors connexion. Seuls les fichiers de l'app sont acceptés.
 */
function precache(urls) {
  var accepted = [];
  (Array.isArray(urls) ? urls : []).forEach(function (raw) {
    try {
      var url = new URL(raw, self.location.origin);
      if (url.origin !== self.location.origin) return;
      var path = url.pathname;
      if (MEMBER_PAGE.test(path)) {
        // La page elle-même : rangée sous la clé d'une navigation.
        accepted.push({ url: url.origin + path, key: url.origin + path.replace(/\/$/, ''), fresh: true });
      } else if (path.indexOf('/_next/static/') === 0 || path.indexOf('/carte/') === 0) {
        accepted.push({ url: url.href, key: url.href, fresh: false });
      }
    } catch (e) {
      // Une adresse illisible est ignorée.
    }
  });
  return caches.open(CACHE).then(function (cache) {
    return Promise.all(
      accepted.map(function (item) {
        return cache.match(item.key).then(function (hit) {
          if (hit && !item.fresh) return undefined;
          return fetch(item.url, { credentials: 'same-origin' }).then(
            function (response) {
              if (response.ok) return cache.put(item.key, response);
              return undefined;
            },
            function () {
              return undefined;
            },
          );
        });
      }),
    );
  });
}

/**
 * La réponse que la page vient de lire, avant d'être contrôlée : gardée pour
 * le hors-connexion, sans second appel à l'API. Seule l'adresse exacte de
 * GET /api/v1/m/{jeton} est acceptée.
 */
function remember(member) {
  if (!member || typeof member.url !== 'string' || typeof member.body !== 'string') {
    return Promise.resolve();
  }
  var url;
  try {
    url = new URL(member.url);
  } catch (e) {
    return Promise.resolve();
  }
  if (url.origin !== API_ORIGIN || url.search !== '' || !MEMBER_API.test(url.pathname)) {
    return Promise.resolve();
  }
  try {
    JSON.parse(member.body);
  } catch (e) {
    return Promise.resolve();
  }
  var headers = new Headers({ 'Content-Type': 'application/json' });
  headers.set(SAVED_AT_HEADER, new Date().toISOString());
  return caches.open(CACHE).then(function (cache) {
    return cache.put(url.href, new Response(member.body, { status: 200, headers: headers }));
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (name) {
              return name.indexOf('adhera-carte-') === 0 && name !== CACHE;
            })
            .map(function (name) {
              return caches.delete(name);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener('fetch', function (event) {
  var response = handle(event.request);
  if (response) event.respondWith(response);
});

self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'precache') {
    event.waitUntil(Promise.all([precache(data.urls), remember(data.member)]));
  }
});

// Pour les tests (tests/serviceWorker.test.ts), sans effet dans le navigateur.
self.__adheraCarte = {
  neverCache: neverCache,
  strategy: strategy,
  handle: handle,
  precache: precache,
  remember: remember,
};
