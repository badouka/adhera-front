import { describe, expect, it } from 'vitest';
import { GET } from '@/app/m/[token]/manifest.webmanifest/route';
import { buildManifest, homeIconUrl, manifestHref, safeLogoUrl } from '@/lib/manifest';

const TOKEN = 'a'.repeat(64);
const LOGO = 'https://api.eventflow.africa/storage-tenantdemo-asso/membership/logo-1a2b3c4d.png';
const ICON = 'https://api.eventflow.africa/storage-tenantdemo-asso/membership/icon-1a2b3c4d.png';

describe('F4 § 1.4 — le manifeste de la carte', () => {
  it('start_url, scope et name', () => {
    const manifest = buildManifest(TOKEN, 'Cercle des Administrateurs Publics', LOGO);
    expect(manifest.name).toBe('Cercle des Administrateurs Publics');
    expect(manifest.short_name).toBe('Ma carte');
    expect(manifest.start_url).toBe(`/m/${TOKEN}?vue=carte`);
    expect(manifest.scope).toBe(`/m/${TOKEN}`);
    // L'adresse de départ est bien DANS la portée.
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons).toEqual([
      { src: LOGO, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ]);
  });

  it('un nom vide retombe sur « Ma carte de membre »', () => {
    expect(buildManifest(TOKEN, '', null).name).toBe('Ma carte de membre');
    expect(buildManifest(TOKEN, '   ', null).name).toBe('Ma carte de membre');
    expect(buildManifest(TOKEN, null, null).name).toBe('Ma carte de membre');
  });

  it('sans logo : l’icône de carte neutre, servie par l’app', () => {
    const icons = buildManifest(TOKEN, 'X', null).icons;
    expect(icons.map((i) => i.src)).toEqual(['/carte/icone-192.png', '/carte/icone-512.png']);
  });

  it('un logo qui ne vient pas de l’API est ignoré', () => {
    expect(safeLogoUrl('https://evil.example/logo.png')).toBeNull();
    expect(safeLogoUrl('http://api.eventflow.africa/logo.png')).toBeNull();
    expect(safeLogoUrl('javascript:alert(1)')).toBeNull();
    expect(buildManifest(TOKEN, 'X', 'https://evil.example/logo.png').icons[0]?.src).toBe(
      '/carte/icone-192.png',
    );
  });

  it('l’icône de l’écran d’accueil : icon_url, à défaut logo_url', () => {
    expect(homeIconUrl(ICON, LOGO)).toBe(ICON);
    expect(homeIconUrl(null, LOGO)).toBe(LOGO);
    expect(homeIconUrl(undefined, LOGO)).toBe(LOGO);
    expect(homeIconUrl(null, null)).toBeNull();
    // Une icône qui ne vient pas de l'API n'est pas servie.
    expect(homeIconUrl('https://evil.example/icon.png', LOGO)).toBeNull();
  });

  it('l’adresse de l’API passe TELLE QUELLE : jamais recomposée ni normalisée', () => {
    // `new URL(...).toString()` mettrait l'hôte en minuscules et encoderait l'espace.
    const raw = 'https://API.eventflow.africa/storage-tenantdemo-asso/membership/icon 1a2b.png';
    expect(safeLogoUrl(raw)).toBe(raw);
    expect(homeIconUrl(raw, LOGO)).toBe(raw);
    expect(buildManifest(TOKEN, 'X', ICON).icons).toEqual([
      { src: ICON, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ]);
  });

  it('manifestHref porte le nom et le logo, rien si le nom est vide', () => {
    expect(manifestHref(TOKEN, '', null)).toBe(`/m/${TOKEN}/manifest.webmanifest`);
    const href = new URL(manifestHref(TOKEN, 'Asso & Cie', LOGO), 'https://x.adhera.africa');
    expect(href.searchParams.get('nom')).toBe('Asso & Cie');
    expect(href.searchParams.get('logo')).toBe(LOGO);
  });

  it('la route engendre le manifeste, sans appeler l’API (R2)', async () => {
    const url = `https://demo-asso.adhera.africa${manifestHref(TOKEN, 'Association Recette F4', null)}`;
    const response = await GET(new Request(url), { params: Promise.resolve({ token: TOKEN }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/^application\/manifest\+json/);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body.name).toBe('Association Recette F4');
    expect(body.start_url).toBe(`/m/${TOKEN}?vue=carte`);
    expect(body.scope).toBe(`/m/${TOKEN}`);
  });

  it('un jeton invraisemblable : 404', async () => {
    const response = await GET(new Request('https://x.adhera.africa/m/x/manifest.webmanifest'), {
      params: Promise.resolve({ token: '../x' }),
    });
    expect(response.status).toBe(404);
  });
});
