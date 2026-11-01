/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/encaisser" }
 */

import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EncaisserPage from '@/app/bureau/encaisser/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import { newIdempotencyKey } from '@/lib/idempotency';
import { fakeResponse, memberDetail, memberItem, payment, renderInBureau, SESSION } from './fixtures';

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

const MOUSSA = memberDetail();
const DONE = payment({
  status: 'validated',
  method: 'especes',
  method_label: 'Espèces',
  amount: 150000,
  amount_formatted: '150 000 FCFA',
  reference: null,
  receipt: { id: 'r-9', reference: 'REC-2026-AAAA0001' },
});

type PostReply = { network: true } | { status: number; body: unknown };

/** Le serveur d'« Encaisser » ; chaque POST consomme la réponse suivante. */
function server(replies: PostReply[]) {
  const keys: Array<string | undefined> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST') {
      keys.push((init?.headers as Record<string, string>)['Idempotency-Key']);
      const reply = replies.shift();
      if (!reply || 'network' in reply) throw new TypeError('Failed to fetch');
      return fakeResponse(reply.status, reply.body);
    }
    if (url.includes('status=active')) return fakeResponse(200, [memberItem()]);
    if (url.includes('status=pending')) return fakeResponse(200, []);
    if (url.includes(`members/${MOUSSA.id}`)) return fakeResponse(200, MOUSSA);
    throw new Error(`Route non simulée : ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, keys };
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Nom, prénom ou téléphone'), 'Mou');
  await user.click(await screen.findByRole('button', { name: /Moussa Ndiaye \(test\)/ }, { timeout: 1500 }));
  return screen.findByRole('button', { name: 'Encaisser 150 000 FCFA' });
}

describe('Idempotency-Key — une clé par intention d’encaisser', () => {
  it('un UUID, différent à chaque tirage', () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newIdempotencyKey()).not.toBe(a);
  });

  it('coupure réseau puis réessai : la MÊME clé sur les deux envois du même panneau', async () => {
    const { keys } = server([{ network: true }, { status: 201, body: DONE }]);
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    const button = await openPanel(user);

    await user.click(button);
    // §3 : l'écran dit que réessayer est sans risque — sinon on n'ose pas.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Connexion impossible\. Vous pouvez réessayer sans risque : un même encaissement n’est jamais enregistré deux fois\.$/,
    );
    expect(screen.queryByText(/Vérifiez votre réseau/)).toBeNull();
    // Le trésorier retouche le même bouton.
    await user.click(screen.getByRole('button', { name: 'Encaisser 150 000 FCFA' }));
    await screen.findByText('Reçu REC-2026-AAAA0001 émis');

    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('une saisie modifiée entre deux essais garde la clé (le serveur tranche)', async () => {
    const { keys } = server([{ network: true }, { status: 201, body: DONE }]);
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    await user.click(await openPanel(user));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('radio', { name: 'Wave' }));
    await user.click(screen.getByRole('button', { name: 'Encaisser 150 000 FCFA' }));
    await screen.findByText('Reçu REC-2026-AAAA0001 émis');
    expect(keys[1]).toBe(keys[0]);
  });

  it('une NOUVELLE clé après un succès', async () => {
    const { keys } = server([
      { status: 201, body: DONE },
      { status: 201, body: { ...DONE, id: 'p-2', receipt: { id: 'r-10', reference: 'REC-2026-AAAA0002' } } },
    ]);
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    await user.click(await openPanel(user));
    await screen.findByText('Reçu REC-2026-AAAA0001 émis');
    await user.click(screen.getByRole('button', { name: 'Encaisser un autre paiement' }));
    await user.click(await openPanel(user));
    await screen.findByText('Reçu REC-2026-AAAA0002 émis');

    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('une NOUVELLE clé à la réouverture du panneau', async () => {
    const { keys } = server([{ network: true }, { network: true }]);
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    await user.click(await openPanel(user));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Changer de membre' }));
    await user.click(await openPanel(user));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('409 duplicate_payment : « Ce versement vient d’être enregistré. », un lien vers la fiche, et AUCUN bouton pour recommencer', async () => {
    server([
      {
        status: 409,
        body: {
          message: 'Ce versement vient d’être enregistré. Vérifiez la liste avant de recommencer.',
          code: 'duplicate_payment',
          payment_id: '01937c5e-aaaa',
        },
      },
    ]);
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    await user.click(await openPanel(user));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Ce versement vient d’être enregistré.');
    expect(screen.getByRole('link', { name: 'Voir le versement sur la fiche du membre' })).toHaveAttribute(
      'href',
      `/bureau/membres/${MOUSSA.id}#versement-01937c5e-aaaa`,
    );
    expect(screen.queryByRole('button', { name: /^Encaisser/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Réessayer|Recommencer/ })).toBeNull();
  });

  it('422 idempotency_key_reused : nouvelle clé, et « vérifiez puis confirmez à nouveau »', async () => {
    const { keys } = server([
      { status: 422, body: { message: 'x', code: 'idempotency_key_reused' } },
      { status: 201, body: DONE },
    ]);
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    await user.click(await openPanel(user));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Le formulaire a changé : vérifiez puis confirmez à nouveau.',
    );
    await user.click(screen.getByRole('button', { name: 'Encaisser 150 000 FCFA' }));
    await screen.findByText('Reçu REC-2026-AAAA0001 émis');
    expect(keys[1]).not.toBe(keys[0]);
  });
});
