import { describe, expect, it } from 'vitest';
import { isValidSlug, resolveTenant, tenantFromHost } from '@/lib/tenant';

describe('tenantFromHost', () => {
  it('extrait le slug d’un sous-domaine', () => {
    expect(tenantFromHost('demo-asso.adhera.africa')).toBe('demo-asso');
  });

  it('refuse le domaine nu, un autre domaine et un sous-domaine imbriqué', () => {
    expect(tenantFromHost('adhera.africa')).toBeNull();
    expect(tenantFromHost('evil.com')).toBeNull();
    expect(tenantFromHost('a.b.adhera.africa')).toBeNull();
  });

  it('refuse un domaine qui imite le suffixe', () => {
    expect(tenantFromHost('evil-adhera.africa')).toBeNull();
    expect(tenantFromHost('demo.adhera.africa.evil.com')).toBeNull();
  });

  it('normalise la casse et ignore le port', () => {
    expect(tenantFromHost('Demo-Asso.Adhera.Africa')).toBe('demo-asso');
    expect(tenantFromHost('demo-asso.adhera.africa:3002')).toBe('demo-asso');
  });

  it('refuse un slug hors format', () => {
    expect(tenantFromHost('-demo.adhera.africa')).toBeNull();
    expect(tenantFromHost('demo-.adhera.africa')).toBeNull();
    expect(tenantFromHost('a.adhera.africa')).toBeNull();
    expect(tenantFromHost('de_mo.adhera.africa')).toBeNull();
  });

  it('refuse une entrée vide', () => {
    expect(tenantFromHost('')).toBeNull();
  });
});

describe('isValidSlug', () => {
  it('valide le format attendu avant de l’envoyer dans un en-tête', () => {
    expect(isValidSlug('demo-asso')).toBe(true);
    expect(isValidSlug('abc')).toBe(true);
    expect(isValidSlug('a'.repeat(63))).toBe(true);
    // Le format du brief impose trois caractères au minimum.
    expect(isValidSlug('ab')).toBe(false);
    expect(isValidSlug('a')).toBe(false);
    expect(isValidSlug('Demo')).toBe(false);
    expect(isValidSlug('demo asso')).toBe(false);
    expect(isValidSlug('demo/asso')).toBe(false);
    expect(isValidSlug('a'.repeat(64))).toBe(false);
  });
});

describe('resolveTenant', () => {
  it('se fie au nom d’hôte', () => {
    const location = { hostname: 'demo-asso.adhera.africa', search: '' };
    expect(resolveTenant(location, true)).toBe('demo-asso');
  });

  it('accepte ?tenant= en développement local seulement', () => {
    const location = { hostname: 'localhost', search: '?tenant=demo-asso' };
    expect(resolveTenant(location, false)).toBe('demo-asso');
    expect(resolveTenant(location, true)).toBeNull();
  });

  it('n’accepte pas ?tenant= depuis un hôte non local', () => {
    const location = { hostname: 'evil.com', search: '?tenant=demo-asso' };
    expect(resolveTenant(location, false)).toBeNull();
  });

  it('refuse un ?tenant= hors format', () => {
    const location = { hostname: 'localhost', search: '?tenant=../evil' };
    expect(resolveTenant(location, false)).toBeNull();
  });
});
