/**
 * Les réglages de l'association (§3, §10, §12.1, §17.10, §18.6, §19, §20.5).
 */

import { request } from './core';
import type { ArrearsPolicy, Settings, SettingsInput } from '../types';

/* ───────────────────────────── Réglages ───────────────────────────── */

export function getSettings(signal?: AbortSignal) {
  return request<Settings>('membership/settings', { signal });
}

export function updateSettings(input: SettingsInput) {
  return request<Settings>('membership/settings', { method: 'PUT', json: input });
}

export function uploadLogo(file: File) {
  const form = new FormData();
  form.set('logo', file);
  return request<Settings>('membership/settings/logo', { method: 'POST', form });
}

export function deleteLogo() {
  return request<Settings>('membership/settings/logo', { method: 'DELETE' });
}

/**
 * Ce que l'association réclame (§12.1). Un `422` porte son libellé FRANÇAIS
 * dans `errors.arrears_policy` (ligne Y du §0), sans `code`.
 */
export function setArrearsPolicy(policy: ArrearsPolicy) {
  return request<Settings>('membership/settings', {
    method: 'PUT',
    json: { arrears_policy: policy },
  });
}

/** L'e-mail du matin aux vérificateurs (§18.6). */
export function setVerificationDigest(enabled: boolean) {
  return request<Settings>('membership/settings', {
    method: 'PUT',
    json: { verification_digest_enabled: enabled },
  });
}

/** Le seul moyen d'arrêter le rapport du lundi (§10). */
export function setWeeklyReport(enabled: boolean) {
  return request<Settings>('membership/settings', {
    method: 'PUT',
    json: { weekly_report_enabled: enabled },
  });
}
