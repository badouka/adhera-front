/**
 * Relances, file WhatsApp et campagnes (§9).
 */

import { request } from './core';
import type { Campaign, CampaignInput, LaunchedCampaign, OutreachDecision, OutreachItem } from '../types';

const seg = encodeURIComponent;

/* ─────────────────────── Relances et campagnes (§9) ───────────────── */

/**
 * La file WhatsApp, la plus urgente d'abord. Elle peut RÉTRÉCIR d'un appel à
 * l'autre (un membre qui a réglé est écarté) ; son ordre est celui du serveur.
 */
export function listOutreach(signal?: AbortSignal) {
  return request<OutreachItem[]>('membership/outreach', { signal });
}

/** Une DÉCLARATION du bureau : le produit ne sait pas si le message est parti. */
export function markOutreachSent(id: string) {
  return request<OutreachDecision>(`membership/outreach/${seg(id)}/sent`, { method: 'POST' });
}

export function skipOutreach(id: string, reason: string) {
  return request<OutreachDecision>(`membership/outreach/${seg(id)}/skip`, {
    method: 'POST',
    json: { reason },
  });
}

export function listCampaigns(signal?: AbortSignal) {
  return request<Campaign[]>('membership/campaigns', { signal });
}

export function createCampaign(input: CampaignInput) {
  const json: Record<string, unknown> = { segment: input.segment, send_email: input.send_email };
  if (input.scheduled_at) json.scheduled_at = input.scheduled_at;
  return request<LaunchedCampaign>('membership/campaigns', { method: 'POST', json });
}

/** `422 campaign_already_sent` : le cron l'a lancée entre-temps — recharger. */
export function cancelCampaign(id: string) {
  return request<Campaign>(`membership/campaigns/${seg(id)}/cancel`, { method: 'POST' });
}
