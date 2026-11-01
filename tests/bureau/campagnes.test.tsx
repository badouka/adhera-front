/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/campagnes" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CampagnesPage, { campaignState, segmentLabel } from '@/app/bureau/campagnes/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import { calls, campaign, fakeServer, renderInBureau, SESSION } from './fixtures';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  resetSessionCache();
  saveSession(SESSION);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-30T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SENT = campaign({ id: 'c-1' });
const PLANNED = campaign({
  id: 'c-2',
  status: 'draft',
  scheduled_at: '2027-01-02T09:00:00+00:00',
  created_at: '2026-12-30T09:00:00+00:00',
  channels: {
    whatsapp: { total: 0, sent: 0, pending: 0, skipped: 0, failed: 0 },
    email: { total: 0, sent: 0, pending: 0, skipped: 0, failed: 0 },
  },
  cancellable: true,
});
const AUTO = campaign({ id: 'c-3', automatic: true, segment: 'auto:j+1', step: 'j+1' });

const LAUNCHED = {
  ...campaign({ id: 'c-9', created_at: '2026-12-30T10:00:00+00:00' }),
  launched: true,
  whatsapp_queued: 12,
  emails_queued: 7,
  unreachable: 2,
};

describe('Campagnes — la liste', () => {
  it('segment en clair, état, avancement ; les rappels automatiques à part', async () => {
    fakeServer([{ match: 'membership/campaigns', body: [PLANNED, SENT, AUTO] }]);
    renderInBureau(<CampagnesPage />);
    const items = await screen.findAllByRole('article');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Membres non à jour');
    expect(items[0]).toHaveTextContent('Programmée pour le 02/01 à 09:00');
    expect(items[0]).toHaveTextContent('Les destinataires seront fixés à l’heure dite.');
    expect(items[1]).toHaveTextContent('Partie le 02/01 à 09:00');
    expect(items[1]).toHaveTextContent('E-mails : 7 envoyés sur 7 · WhatsApp : 5 envoyés sur 12');
    expect(screen.getByText('Rappels automatiques (1)')).toBeInTheDocument();
  });

  it('libellés', () => {
    expect(segmentLabel('tous_actifs')).toBe('Tous les membres actifs');
    expect(segmentLabel('auto:j-7')).toBe('Rappel automatique, 7 jours avant l’échéance');
    expect(campaignState(campaign({ id: 'x', status: 'cancelled' }), 'Africa/Dakar')).toBe('Annulée');
  });
});

describe('Campagnes — nouvelle campagne', () => {
  it('trois choix, par défaut : non à jour, maintenant, e-mails ; le récapitulatif R9 sur une ligne', async () => {
    const fetchMock = fakeServer([
      { method: 'POST', match: 'membership/campaigns', status: 201, body: LAUNCHED },
      { match: 'membership/campaigns', body: [] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<CampagnesPage />);
    await user.click(await screen.findByRole('button', { name: 'Nouvelle campagne' }));

    expect(screen.getByRole('radio', { name: 'Les membres qui ne sont pas à jour' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Tous les membres actifs' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Maintenant' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Envoyer aussi un e-mail aux membres qui ont une adresse' })).toBeChecked();
    expect(screen.getByTestId('recap')).toHaveTextContent(
      'Campagne vers les membres non à jour — maintenant — e-mails automatiques et WhatsApp ajoutés à votre file',
    );

    await user.click(screen.getByRole('button', { name: 'Lancer la campagne' }));
    const [post] = calls(fetchMock, 'POST');
    expect(JSON.parse(post?.init.body as string)).toEqual({ segment: 'non_a_jour', send_email: true });

    // Après : les nombres du serveur, et le chemin vers la file.
    const counts = await screen.findByTestId('launch-counts');
    expect(counts).toHaveTextContent('12 WhatsApp ajoutés à votre file');
    expect(counts).toHaveTextContent('7 e-mails programmés');
    expect(counts).toHaveTextContent('2 membres injoignables (ni téléphone ni e-mail) : à prévenir autrement');
    expect(screen.getByRole('link', { name: 'Commencer les envois WhatsApp' })).toHaveAttribute('href', '/bureau/a-envoyer');
  });

  it('§3 — « n déjà dans votre file », distinct des injoignables (§12.5)', async () => {
    fakeServer([
      { method: 'POST', match: 'membership/campaigns', status: 201, body: { ...LAUNCHED, whatsapp_queued: 0, already_queued: 3 } },
      { match: 'membership/campaigns', body: [] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<CampagnesPage />);
    await user.click(await screen.findByRole('button', { name: 'Nouvelle campagne' }));
    await user.click(screen.getByRole('button', { name: 'Lancer la campagne' }));
    expect((await screen.findByTestId('already-queued')).textContent).toBe('3 déjà dans votre file');
    // Les injoignables restent 2 : jamais 2 + 3.
    expect(screen.getByTestId('launch-counts')).toHaveTextContent('2 membres injoignables');
    expect(screen.getByTestId('launch-counts')).not.toHaveTextContent(/\b5\b/);
    // Leur message attend dans la file : le chemin reste proposé.
    expect(screen.getByRole('link', { name: 'Commencer les envois WhatsApp' })).toBeInTheDocument();
  });

  it('programmée, tous les actifs, sans e-mail : l’instant envoyé et le récapitulatif', async () => {
    const fetchMock = fakeServer([
      { method: 'POST', match: 'membership/campaigns', status: 201, body: { ...PLANNED, launched: false, whatsapp_queued: 0, emails_queued: 0, unreachable: 0 } },
      { match: 'membership/campaigns', body: [] },
    ]);
    const user = userEvent.setup();
    const { container } = renderInBureau(<CampagnesPage />);
    await user.click(await screen.findByRole('button', { name: 'Nouvelle campagne' }));
    await user.click(screen.getByRole('radio', { name: 'Tous les membres actifs' }));
    await user.click(screen.getByRole('radio', { name: 'Programmer' }));
    await user.click(screen.getByRole('checkbox'));

    const date = container.querySelector('input[type="date"]') as HTMLInputElement;
    const time = container.querySelector('input[type="time"]') as HTMLInputElement;
    await user.clear(date);
    await user.type(date, '2027-01-02');
    await user.clear(time);
    await user.type(time, '09:00');
    expect(screen.getByTestId('recap')).toHaveTextContent(
      'Campagne vers tous les membres actifs — le 02/01 à 09:00 — WhatsApp ajoutés à votre file, sans e-mail',
    );
    await user.click(screen.getByRole('button', { name: 'Programmer la campagne' }));
    const [post] = calls(fetchMock, 'POST');
    expect(JSON.parse(post?.init.body as string)).toEqual({
      segment: 'tous_actifs',
      send_email: false,
      scheduled_at: '2027-01-02T09:00:00.000Z',
    });
    expect(await screen.findByText(/Campagne programmée pour le 02\/01 à 09:00/)).toBeInTheDocument();
  });

  it('une date passée est refusée avant l’envoi', async () => {
    const fetchMock = fakeServer([{ match: 'membership/campaigns', body: [] }]);
    const user = userEvent.setup();
    const { container } = renderInBureau(<CampagnesPage />);
    await user.click(await screen.findByRole('button', { name: 'Nouvelle campagne' }));
    await user.click(screen.getByRole('radio', { name: 'Programmer' }));
    const date = container.querySelector('input[type="date"]') as HTMLInputElement;
    await user.clear(date);
    await user.type(date, '2026-12-01');
    await user.click(screen.getByRole('button', { name: 'Programmer la campagne' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choisissez une date et une heure à venir.');
    expect(calls(fetchMock, 'POST')).toHaveLength(0);
  });
});

describe('Campagnes — annuler une campagne programmée', () => {
  it('la confirmation dit la date et l’heure, et qu’aucun message ne partira', async () => {
    const fetchMock = fakeServer([
      { method: 'POST', match: 'membership/campaigns/c-2/cancel', body: { ...PLANNED, status: 'cancelled', cancellable: false } },
      { match: 'membership/campaigns', body: [PLANNED, SENT] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<CampagnesPage />);
    await user.click(await screen.findByRole('button', { name: 'Annuler cette campagne' }));
    const dialog = screen.getByRole('dialog', { name: 'Annuler la campagne du 2 janvier à 09:00 ?' });
    expect(dialog).toHaveTextContent('Aucun message ne partira.');
    await user.click(within(dialog).getByRole('button', { name: 'Annuler la campagne' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock, 'POST').map((c) => c.url)).toEqual([
      'https://api.eventflow.africa/api/v1/admin/membership/campaigns/c-2/cancel',
    ]);
    expect(screen.getAllByRole('article')[0]).toHaveTextContent('Annulée');
    expect(screen.queryByRole('button', { name: 'Annuler cette campagne' })).toBeNull();
  });

  it('422 campaign_already_sent : le message dit pourquoi, et la liste est rechargée', async () => {
    const fetchMock = fakeServer([
      { method: 'POST', match: 'membership/campaigns/c-2/cancel', status: 422, body: { code: 'campaign_already_sent', message: 'x' } },
      { match: 'membership/campaigns', body: [PLANNED] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<CampagnesPage />);
    await user.click(await screen.findByRole('button', { name: 'Annuler cette campagne' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler la campagne' }));
    expect(
      await screen.findByText('Cette campagne est déjà partie : elle ne peut plus être annulée.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(calls(fetchMock).filter((c) => c.url.endsWith('membership/campaigns'))).toHaveLength(2),
    );
  });
});
