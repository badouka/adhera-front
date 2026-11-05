/**
 * Le tableau de bord et les exports Excel (§10, §18.3).
 */

import { request, type DownloadedFile } from './core';
import type { Dashboard } from '../types';

/* ─────────────────────── Tableau de bord et exports ───────────────── */

/** Bornes `YYYY-MM-DD` incluses ; absentes = du 1er janvier à aujourd'hui. */
export type PeriodQuery = { from?: string | null; to?: string | null };

export function getDashboard(period: PeriodQuery, signal?: AbortSignal) {
  return request<Dashboard>('membership/dashboard', { query: period, signal });
}

/** Le registre en Excel (§10) : des BLOBS, jamais du JSON (piège 29). */
export function downloadMembersExport() {
  return request<DownloadedFile>('membership/exports/members.xlsx', { as: 'file' });
}

export function downloadPaymentsExport(period: PeriodQuery) {
  return request<DownloadedFile>('membership/exports/payments.xlsx', {
    query: period,
    as: 'file',
  });
}
