/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/a-envoyer" }
 */

import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AEnvoyerPage, { reasonLabel } from '@/app/bureau/a-envoyer/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import type { OutreachItem } from '@/lib/bureau/types';
import { calls, campaign, fakeResponse, outreachItem, renderInBureau, SESSION } from './fixtures';

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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const A = outreachItem({ id: 'o-1' });
const B = outreachItem({
  id: 'o-2',
  member: { id: 'm-2', first_name: 'Moussa', last_name: 'Ndiaye', name: 'Moussa Ndiaye', phone: '775695563' },
  step: null,
  due_on: null,
  campaign: { id: 'c-1', segment: 'non_a_jour', automatic: false },
  message: 'Bonjour Moussa Ndiaye,\nmessage de campagne.',
});
const C = outreachItem({
  id: 'o-3',
  member: { id: 'm-3', first_name: 'Fatou', last_name: 'Sarr', name: 'Fatou Sarr', phone: '761234567' },
  step: 'j-7',
  due_on: '2026-11-08',
  message: 'Bonjour Fatou Sarr,\nVotre cotisation arrive à échéance le 8 novembre 2026.',
});

/**
 * Un serveur à états : `queues` sert les lectures successives de la file (la
 * dernière se répète), et chaque POST est noté.
 */
function server(queues: OutreachItem[][], posts: Record<string, { status: number; body: unknown }> = {}) {
  let reads = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.replace('https://api.eventflow.africa/api/v1/admin/', '');
    if (method === 'GET' && path === 'membership/outreach') {
      const queue = queues[Math.min(reads, queues.length - 1)] ?? [];
      reads += 1;
      return fakeResponse(200, queue);
    }
    if (method === 'GET' && path === 'membership/campaigns') {
      return fakeResponse(200, [campaign({ id: 'c-1', created_at: '2027-01-02T09:00:00+00:00' })]);
    }
    if (method === 'POST') {
      const hit = Object.entries(posts).find(([k]) => path.endsWith(k));
      if (hit) return fakeResponse(hit[1].status, hit[1].body);
      return fakeResponse(200, { id: 'x', status: 'sent', sent_at: null, skip_reason: null });
    }
    throw new Error(`Route non simulée : ${method} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof server>) => calls(fetchMock, 'POST');

describe('« À envoyer » — la file WhatsApp, un membre à la fois', () => {
  it('une carte : prénom et nom, téléphone, pourquoi, et le message DU SERVEUR', async () => {
    server([[A, B, C]]);
    renderInBureau(<AEnvoyerPage />);
    expect(await screen.findByRole('heading', { name: 'Aminata Diop' })).toBeInTheDocument();
    expect(screen.getByText('771234567')).toBeInTheDocument();
    expect(screen.getByText('En retard depuis le 2 octobre')).toBeInTheDocument();
    // Le texte exact, espaces insécables comprises : jamais recomposé.
    expect(screen.getByTestId('message').textContent).toBe(A.message);
    expect(screen.getByTestId('counter')).toHaveTextContent('1 sur 3');
    // Une seule carte à la fois.
    expect(screen.queryByText('Moussa Ndiaye')).toBeNull();
  });

  it('« Ouvrir WhatsApp » ouvre wa_url et ne marque RIEN', async () => {
    const fetchMock = server([[A, B]]);
    const user = userEvent.setup();
    renderInBureau(<AEnvoyerPage />);
    const open = await screen.findByRole('link', { name: 'Ouvrir WhatsApp' });
    expect(open).toHaveAttribute('href', A.wa_url);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    // Avant l'ouverture, pas de « Envoyé ✓ ».
    expect(screen.queryByRole('button', { name: 'Envoyé ✓' })).toBeNull();

    open.addEventListener('click', (e) => e.preventDefault());
    await user.click(open);
    expect(posts(fetchMock)).toHaveLength(0);
    // Au retour : « Envoyé ✓ » attend, et « Passer ».
    expect(screen.getByRole('button', { name: 'Envoyé ✓' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Passer' })).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('« Envoyé ✓ » → POST …/sent, puis la carte suivante aussitôt', async () => {
    const fetchMock = server([[A, B, C], [B, C]]);
    const user = userEvent.setup();
    renderInBureau(<AEnvoyerPage />);
    const open = await screen.findByRole('link', { name: 'Ouvrir WhatsApp' });
    open.addEventListener('click', (e) => e.preventDefault());
    await user.click(open);
    await user.click(screen.getByRole('button', { name: 'Envoyé ✓' }));

    expect(await screen.findByRole('heading', { name: 'Moussa Ndiaye' })).toBeInTheDocument();
    expect(posts(fetchMock).map((c) => c.url)).toEqual([
      'https://api.eventflow.africa/api/v1/admin/membership/outreach/o-1/sent',
    ]);
    expect(screen.getByTestId('counter')).toHaveTextContent('2 sur 3');
    // La date de la campagne vient de la liste des campagnes.
    expect(screen.getByText('Campagne du 2 janvier')).toBeInTheDocument();
  });

  it('« Passer » exige un motif ; un toucher pour les deux motifs courants', async () => {
    const fetchMock = server([[A, B]]);
    const user = userEvent.setup();
    renderInBureau(<AEnvoyerPage />);
    await user.click(await screen.findByRole('button', { name: 'Passer' }));
    // Rien n'est envoyé tant qu'aucun motif n'est choisi.
    expect(posts(fetchMock)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Pas de WhatsApp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Numéro incorrect' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Numéro incorrect' }));

    await screen.findByRole('heading', { name: 'Moussa Ndiaye' });
    const [skip] = posts(fetchMock);
    expect(skip?.url).toBe('https://api.eventflow.africa/api/v1/admin/membership/outreach/o-1/skip');
    expect(JSON.parse(skip?.init.body as string)).toEqual({ reason: 'Numéro incorrect' });
  });

  it('« Autre » demande un mot : vide, refusé ; rempli, envoyé tel quel', async () => {
    const fetchMock = server([[A, B]]);
    const user = userEvent.setup();
    renderInBureau(<AEnvoyerPage />);
    await user.click(await screen.findByRole('button', { name: 'Passer' }));
    await user.click(screen.getByRole('button', { name: 'Autre' }));
    await user.click(screen.getByRole('button', { name: 'Passer ce membre' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Indiquez le motif en quelques mots.');
    expect(posts(fetchMock)).toHaveLength(0);

    await user.type(screen.getByLabelText('Autre motif'), 'Décédé, à retirer');
    await user.click(screen.getByRole('button', { name: 'Passer ce membre' }));
    await screen.findByRole('heading', { name: 'Moussa Ndiaye' });
    expect(JSON.parse(posts(fetchMock)[0]?.init.body as string)).toEqual({ reason: 'Décédé, à retirer' });
  });

  it('un membre écarté par le serveur disparaît sans geste, et sans erreur', async () => {
    // Après le premier envoi, la relecture ne rend plus B (il a réglé).
    server([[A, B, C], [C]]);
    const user = userEvent.setup();
    renderInBureau(<AEnvoyerPage />);
    const open = await screen.findByRole('link', { name: 'Ouvrir WhatsApp' });
    open.addEventListener('click', (e) => e.preventDefault());
    await user.click(open);
    await user.click(screen.getByRole('button', { name: 'Envoyé ✓' }));

    expect(await screen.findByRole('heading', { name: 'Fatou Sarr' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('counter')).toHaveTextContent('2 sur 2');
  });

  it('un message déjà traité ailleurs (422 message_not_pending) s’en va sans bruit', async () => {
    server([[A, B], [B]], { 'o-1/sent': { status: 422, body: { code: 'message_not_pending', message: 'x' } } });
    const user = userEvent.setup();
    renderInBureau(<AEnvoyerPage />);
    const open = await screen.findByRole('link', { name: 'Ouvrir WhatsApp' });
    open.addEventListener('click', (e) => e.preventDefault());
    await user.click(open);
    await user.click(screen.getByRole('button', { name: 'Envoyé ✓' }));
    expect(await screen.findByRole('heading', { name: 'Moussa Ndiaye' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('en fin de file : « Tout est envoyé. » avec le nombre envoyé', async () => {
    server([[A], []]);
    const user = userEvent.setup();
    renderInBureau(<AEnvoyerPage />);
    const open = await screen.findByRole('link', { name: 'Ouvrir WhatsApp' });
    open.addEventListener('click', (e) => e.preventDefault());
    await user.click(open);
    await user.click(screen.getByRole('button', { name: 'Envoyé ✓' }));
    expect(await screen.findByText('Tout est envoyé.')).toBeInTheDocument();
    expect(screen.getByTestId('summary')).toHaveTextContent('1 message envoyé.');
  });

  it('une file vide le dit', async () => {
    server([[]]);
    renderInBureau(<AEnvoyerPage />);
    expect(await screen.findByText('Aucun message à envoyer.')).toBeInTheDocument();
  });

  it('§3 — sous « Ouvrir WhatsApp » : revenir ici après l’envoi', async () => {
    server([[A, B]]);
    renderInBureau(<AEnvoyerPage />);
    const open = await screen.findByRole('link', { name: 'Ouvrir WhatsApp' });
    const hint = screen.getByTestId('return-hint');
    expect(hint.textContent).toBe('Après l’envoi, revenez sur cette page pour passer au suivant.');
    expect(open.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('wa_url null : la copie du message, jamais un lien deviné', async () => {
    server([[outreachItem({ id: 'o-9', wa_url: null, phone_is_usable: false })]]);
    renderInBureau(<AEnvoyerPage />);
    const copy = await screen.findByRole('button', { name: 'Copier le message' });
    // La copie précède « Envoyé ✓ », dans la barre d'action.
    expect(copy.compareDocumentPosition(screen.getByRole('button', { name: 'Envoyé ✓' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Envoyé ✓' })).toBeInTheDocument();
    // Pas de lien à ouvrir : pas de consigne de retour non plus.
    expect(screen.queryByTestId('return-hint')).toBeNull();
  });

  it('touchers comptés : « Ouvrir WhatsApp », puis « Envoyé ✓ » (le retour est le geste du téléphone)', async () => {
    const fetchMock = server([[A, B], [B]]);
    const user = userEvent.setup();
    renderInBureau(<AEnvoyerPage />);
    let taps = 0;
    const open = await screen.findByRole('link', { name: 'Ouvrir WhatsApp' });
    open.addEventListener('click', (e) => e.preventDefault());
    await user.click(open);
    taps += 1;
    await user.click(screen.getByRole('button', { name: 'Envoyé ✓' }));
    taps += 1;
    await screen.findByRole('heading', { name: 'Moussa Ndiaye' });
    expect(taps).toBe(2);
    expect(posts(fetchMock)).toHaveLength(1);
  });
});

describe('le motif d’une carte, en clair', () => {
  const today = '2026-11-01';
  it('j+1 : en retard ; j-7 : une échéance À VENIR, jamais « en retard »', () => {
    expect(reasonLabel(A, {}, today)).toBe('En retard depuis le 2 octobre');
    expect(reasonLabel(C, {}, today)).toBe('Échéance dans 7 jours');
    expect(reasonLabel({ ...C, due_on: '2026-11-02' }, {}, today)).toBe('Échéance demain');
    expect(reasonLabel(C, {}, today)).not.toMatch(/retard/i);
  });

  it('une campagne : sa date si elle est connue', () => {
    expect(reasonLabel(B, { 'c-1': '2 janvier' }, today)).toBe('Campagne du 2 janvier');
    expect(reasonLabel(B, {}, today)).toBe('Campagne du bureau');
  });
});

describe('aucun retri de la file', () => {
  it('l’ordre est celui du serveur', async () => {
    server([[C, A, B]]);
    renderInBureau(<AEnvoyerPage />);
    expect(await screen.findByRole('heading', { name: 'Fatou Sarr' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('counter')).toHaveTextContent('1 sur 3'));
  });
});
