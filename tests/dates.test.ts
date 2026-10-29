import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, isPast, todayInDakar } from '@/lib/dates';

describe('formatDate', () => {
  it('tourne bien dans un fuseau hostile', () => {
    // Le cas qui casse : sans timeZone forcé, `new Date('2027-03-13')` relu à
    // Los Angeles (UTC-7/-8) rend le 12 mars.
    expect(process.env.TZ).toBe('America/Los_Angeles');
  });

  it('formate une date de période', () => {
    expect(formatDate('2027-03-13')).toBe('13 mars 2027');
  });

  it('ne glisse pas d’un jour en arrière à Los Angeles', () => {
    expect(formatDate('2026-01-01')).toBe('1er janvier 2026');
    expect(formatDate('2026-11-04')).toBe('4 novembre 2026');
    expect(formatDate('2026-03-14')).toBe('14 mars 2026');
  });

  it('écrit « 1er » et non « 1 »', () => {
    expect(formatDate('2026-04-01')).toBe('1er avril 2026');
  });

  it('rend une chaîne vide plutôt que « Invalid Date »', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('')).toBe('');
    expect(formatDate('pas-une-date')).toBe('');
    expect(formatDate('2026-02-31')).toBe('');
    expect(formatDate('2026-11-04T12:00:00Z')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('lit un ISO 8601 dans le fuseau de Dakar', () => {
    expect(formatDateTime('2026-11-12T10:30:00Z')).toBe('12 novembre 2026');
  });

  it('ne bascule pas la veille pour un horodatage de fin de journée', () => {
    // 23 h 30 UTC = 23 h 30 à Dakar (UTC+0), mais 15 h 30 à Los Angeles.
    expect(formatDateTime('2026-11-12T23:30:00Z')).toBe('12 novembre 2026');
  });

  it('rend une chaîne vide sur une entrée inexploitable', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('n’importe quoi')).toBe('');
  });
});

describe('todayInDakar / isPast', () => {
  it('rend la date du jour au format YYYY-MM-DD', () => {
    expect(todayInDakar(new Date('2026-11-12T23:30:00Z'))).toBe('2026-11-12');
  });

  it('juge une fin de période passée sans dépendre du fuseau du téléphone', () => {
    const now = new Date('2026-11-12T23:30:00Z');
    expect(isPast('2026-11-11', now)).toBe(true);
    expect(isPast('2026-11-12', now)).toBe(false);
    expect(isPast('2027-03-13', now)).toBe(false);
    expect(isPast(null, now)).toBe(false);
  });
});
