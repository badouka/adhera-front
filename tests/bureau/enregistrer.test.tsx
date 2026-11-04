/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/enregistrer" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EnregistrerPage, { METHOD_CHOICES, recap } from '@/app/bureau/enregistrer/page';
import { takeFlash } from '@/lib/bureau/flash';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import { formatDate, todayInDakar } from '@/lib/dates';
import { newIdempotencyKey } from '@/lib/idempotency';
import {
  fakeResponse,
  memberDetail,
  memberItem,
  payment,
  POSSIBLE_DUPLICATE,
  renderInBureau,
  SESSION,
  share,
} from './fixtures';

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));

vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/bureau/enregistrer',
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const CHEIKH = memberDetail({
  id: 'm-cheikh',
  name: 'Cheikh Diouf',
  first_name: 'Cheikh',
  last_name: 'Diouf',
  phone: '77 000 00 07',
  balance_due: 25000,
  balance_due_formatted: '25 000 FCFA',
  dues: [
    {
      ...memberDetail().dues[0]!,
      id: 'd-2026',
      status: 'due',
      amount_due: 25000,
      amount_due_formatted: '25 000 FCFA',
      amount_paid: 0,
      amount_paid_formatted: '0 FCFA',
      balance_due: 25000,
      balance_due_formatted: '25 000 FCFA',
      receipts: [],
      receipt_available: false,
    },
  ],
});

const DONE = {
  ...payment({
    member_id: 'm-cheikh',
    member_name: 'Cheikh Diouf',
    status: 'validated',
    method: 'om',
    method_label: 'Orange Money',
    amount: 10000,
    amount_formatted: '10 000 FCFA',
    reference: null,
    receipt: { id: 'r-9', reference: 'REC-2026-AAAA0001' },
  }),
  share: share(),
};

type PostReply = { network: true } | { status: number; body: unknown };

/** Le serveur de « Un membre a payé » ; chaque POST consomme la réponse suivante. */
function server(replies: PostReply[], after: typeof CHEIKH = { ...CHEIKH, balance_due: 15000, balance_due_formatted: '15 000 FCFA' }) {
  const posts: Array<{ key: string | undefined; body: Record<string, unknown> }> = [];
  let paid = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST') {
      posts.push({
        key: (init?.headers as Record<string, string>)['Idempotency-Key'],
        body: JSON.parse(init?.body as string),
      });
      const reply = replies.shift();
      if (!reply || 'network' in reply) throw new TypeError('Failed to fetch');
      if (reply.status === 201) paid = true;
      return fakeResponse(reply.status, reply.body);
    }
    if (url.includes('status=active')) return fakeResponse(200, [memberItem({ ...CHEIKH })]);
    if (url.includes('status=pending')) return fakeResponse(200, []);
    if (url.includes('members/m-cheikh')) return fakeResponse(200, paid ? after : CHEIKH);
    throw new Error(`Route non simulée : ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, posts };
}

beforeEach(() => {
  window.sessionStorage.clear();
  resetSessionCache();
  saveSession(SESSION);
  nav.router.push.mockReset();
  takeFlash();
  window.history.replaceState(null, '', '/bureau/enregistrer?membre=m-cheikh');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function chooseOrangeMoney10000(user: ReturnType<typeof userEvent.setup>) {
  const amount = await screen.findByLabelText('2. Combien ?');
  await user.clear(amount);
  await user.type(amount, '10000');
  await user.click(screen.getByRole('radio', { name: 'Orange Money' }));
}

describe('Écran 4 — quatre questions numérotées', () => {
  it('depuis la fiche : le membre choisi, « Cheikh doit encore … », et « Autre membre »', async () => {
    server([]);
    renderInBureau(<EnregistrerPage />);
    expect(await screen.findByText('1. Qui a payé ?')).toBeInTheDocument();
    expect(screen.getByText('Cheikh Diouf')).toBeInTheDocument();
    expect(screen.getByText(/Cheikh doit encore/)).toHaveTextContent('Cheikh doit encore 25 000 FCFA');
    expect(screen.getByRole('button', { name: 'Autre membre' })).toBeInTheDocument();
  });

  it('« 2. Combien ? » : le reste à payer par défaut, suivi de « FCFA »', async () => {
    server([]);
    renderInBureau(<EnregistrerPage />);
    const amount = await screen.findByLabelText('2. Combien ?');
    expect(amount).toHaveValue('25 000');
    expect(amount.parentElement).toHaveTextContent('FCFA');
  });

  it('« 3. Comment ? » : les cinq moyens, Espèces d’abord et choisi', async () => {
    server([]);
    renderInBureau(<EnregistrerPage />);
    const group = (await screen.findByText('3. Comment ?')).closest('fieldset') as HTMLElement;
    expect(within(group).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(
      METHOD_CHOICES.map((m) => m.label),
    );
    expect(METHOD_CHOICES.map((m) => m.label)).toEqual(['Espèces', 'Wave', 'Orange Money', 'Virement', 'Chèque']);
    expect(within(group).getByRole('radio', { name: 'Espèces' })).toBeChecked();
  });

  it('« 4. Quand ? » : aujourd’hui en toutes lettres ; un autre jour est TOUJOURS réécrit en toutes lettres (P7)', async () => {
    server([]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    expect(await screen.findByTestId('date-words')).toHaveTextContent(
      `Aujourd’hui, ${formatDate(todayInDakar())}`,
    );
    await user.click(screen.getByRole('button', { name: 'Un autre jour' }));
    const date = screen.getByLabelText('Date du paiement');
    await user.clear(date);
    await user.type(date, '2026-03-11');
    // « 11/03/2026 » se lit 3 novembre en anglais : la date est écrite en mots.
    expect(screen.getByTestId('date-words')).toHaveTextContent('Le 11 mars 2026');
    expect(screen.getByTestId('recap')).toHaveTextContent('le 11 mars 2026');
  });

  it('« Vous allez enregistrer » se met à jour à chaque réponse', async () => {
    server([]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    const box = await screen.findByTestId('recap');
    expect(box).toHaveTextContent(
      'Vous allez enregistrerCheikh Diouf a payé 25 000 FCFA en espèces aujourd’hui. Cheikh sera à jour.',
    );
    await chooseOrangeMoney10000(user);
    expect(box).toHaveTextContent(
      'Cheikh Diouf a payé 10 000 FCFA par Orange Money aujourd’hui. Cheikh devra encore 15 000 FCFA.',
    );
  });

  it('recap : la règle seule', () => {
    const r = recap({ member: CHEIKH, amount: 30000, method: 'virement', date: '2026-01-02', today: '2026-11-03' });
    expect(r).toEqual({
      who: 'Cheikh Diouf',
      amount: '30 000 FCFA',
      how: 'par virement',
      when: 'le 2 janvier 2026',
      after: 'Cheikh sera à jour.',
    });
  });

  describe('R2 — l’aperçu du reste : trois cas, et pas un', () => {
    const base = { method: 'om' as const, date: '2026-11-03', today: '2026-11-03' };
    const after = (balance: number | null | undefined, amount: number | null) =>
      recap({ ...base, member: { ...CHEIKH, balance_due: balance as number | null }, amount }).after;

    it('0 < S < R : « Cheikh devra encore R − S. »', () => {
      expect(after(25000, 10000)).toBe('Cheikh devra encore 15 000 FCFA.');
      expect(after(25000, 24999)).toBe('Cheikh devra encore 1 FCFA.');
    });

    it('S ≥ R, R > 0 : « Cheikh sera à jour. » — jamais « devra encore 0 FCFA », jamais négatif', () => {
      expect(after(25000, 25000)).toBe('Cheikh sera à jour.');
      expect(after(25000, 30000)).toBe('Cheikh sera à jour.');
      for (const s of [25000, 30000, 1_000_000]) {
        expect(after(25000, s)).not.toMatch(/devra encore|-|−/);
      }
    });

    it('R = 0 ou absent : aucune phrase sur le reste', () => {
      expect(after(0, 10000)).toBe('');
      expect(after(null, 10000)).toBe('');
      expect(after(undefined, 10000)).toBe('');
      // Sans saisie non plus, rien n'est promis.
      expect(after(25000, null)).toBe('');
      expect(after(25000, 0)).toBe('');
    });
  });

  it('un montant au-delà du reste à payer est arrêté avant l’envoi', async () => {
    const { posts } = server([]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    const amount = await screen.findByLabelText('2. Combien ?');
    await user.clear(amount);
    await user.type(amount, '30000');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    expect(await screen.findByText(/ne peut pas dépasser ce qui reste à payer \(25 000 FCFA\)/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it('sans membre choisi : la liste du serveur, puis la recherche', async () => {
    window.history.replaceState(null, '', '/bureau/enregistrer');
    const { fetchMock } = server([]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    const list = await screen.findByTestId('pick-list');
    expect(within(list).getByText('Cheikh Diouf')).toBeInTheDocument();
    await user.type(screen.getByLabelText('1. Qui a payé ?'), 'Che');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('search=Che'))).toBe(true),
    );
    await user.click(within(screen.getByTestId('pick-list')).getByRole('button', { name: /Cheikh Diouf/ }));
    expect(await screen.findByLabelText('2. Combien ?')).toHaveValue('25 000');
  });

  it('mode de cotisation non pris en charge : rien à enregistrer, et ça se dit', () => {
    server([]);
    renderInBureau(<EnregistrerPage />, { modeSupported: false });
    expect(screen.getByText(/sera possible quand le mode de cotisation/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enregistrer ce paiement' })).not.toBeInTheDocument();
  });
});

describe('Écran 6 — « C’est enregistré »', () => {
  it('la saisie part avec sa clé, puis le paiement servi, la situation relue, le reçu à envoyer', async () => {
    const { posts } = server([{ status: 201, body: DONE }]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    await chooseOrangeMoney10000(user);
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));

    const done = await screen.findByTestId('recorded');
    expect(done).toHaveTextContent('Cheikh Diouf a payé 10 000 FCFA par Orange Money.');
    expect(await screen.findByTestId('standing-after')).toHaveTextContent('Reste à payer : 15 000 FCFA');
    expect(done).toHaveTextContent('Reçu n° REC-2026-AAAA0001');
    expect(screen.getByTestId('wa-receipt')).toHaveAttribute('href', DONE.share.whatsapp_url);
    expect(screen.getByTestId('wa-receipt')).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Voir le reçu' })).toBeInTheDocument();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ amount: 10000, method: 'om', paid_on: todayInDakar() });
    expect(posts[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('à jour après le paiement : « À jour jusqu’au … »', async () => {
    server([{ status: 201, body: DONE }], {
      ...CHEIKH,
      is_up_to_date: true,
      covered_until: '2027-09-02',
      balance_due: 0,
      balance_due_formatted: '0 FCFA',
    });
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    await screen.findByLabelText('2. Combien ?');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    expect(await screen.findByTestId('standing-after')).toHaveTextContent('À jour jusqu’au 2 septembre 2027');
  });

  it('`share: null` : la mention « pas de téléphone », aucun bouton qui échoue', async () => {
    server([{ status: 201, body: { ...DONE, share: null } }]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    await screen.findByLabelText('2. Combien ?');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    expect(await screen.findByTestId('no-phone')).toHaveTextContent(
      'Cheikh n’a pas de téléphone : impossible d’envoyer le reçu par WhatsApp.',
    );
    expect(screen.queryByTestId('wa-receipt')).not.toBeInTheDocument();
  });

  it('« Enregistrer un autre paiement » : une NOUVELLE clé', async () => {
    const { posts } = server([{ status: 201, body: DONE }, { status: 201, body: DONE }]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    await screen.findByLabelText('2. Combien ?');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    await user.click(await screen.findByRole('button', { name: 'Enregistrer un autre paiement' }));
    await user.click(within(await screen.findByTestId('pick-list')).getByRole('button', { name: /Cheikh Diouf/ }));
    await screen.findByLabelText('2. Combien ?');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    await screen.findByTestId('recorded');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.key).not.toBe(posts[1]?.key);
  });
});

describe('Écran 5 — « Est-ce le même paiement ? » (§18.1)', () => {
  it('le 409 mène à l’écran 5 : déjà enregistré, et ce qu’on vient de saisir, côte à côte', async () => {
    server([{ status: 409, body: POSSIBLE_DUPLICATE }]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    await chooseOrangeMoney10000(user);
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    const question = await screen.findByTestId('duplicate');
    expect(question).toHaveTextContent('Ce paiement de Cheikh Diouf est déjà enregistré aujourd’hui.');
    expect(question).toHaveTextContent('Déjà enregistré10 000 FCFAOrange Moneyà 20 h 37');
    expect(question).toHaveTextContent('Vous venez de saisir10 000 FCFAOrange Moneymaintenant');
    expect(within(question).getByRole('button', { name: /Non, Cheikh a payé deux fois/ })).toBeInTheDocument();
  });

  it('« Oui, c’est le même » n’envoie RIEN, et retourne à la fiche', async () => {
    const { posts } = server([{ status: 409, body: POSSIBLE_DUPLICATE }]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    await chooseOrangeMoney10000(user);
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    await user.click(await screen.findByRole('button', { name: /Oui, c’est le même/ }));
    expect(nav.router.push).toHaveBeenCalledWith('/bureau/membres/m-cheikh');
    expect(takeFlash()).toBe('Rien n’a été enregistré.');
    expect(posts).toHaveLength(1);
  });

  it('« Non, il a payé deux fois » rejoue avec confirm_duplicate ET une clé neuve', async () => {
    const { posts } = server([{ status: 409, body: POSSIBLE_DUPLICATE }, { status: 201, body: DONE }]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    await chooseOrangeMoney10000(user);
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    await user.click(await screen.findByRole('button', { name: /Non, Cheikh a payé deux fois/ }));
    await screen.findByTestId('recorded');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.body).not.toHaveProperty('confirm_duplicate');
    expect(posts[1]?.body).toEqual({ ...posts[0]?.body, confirm_duplicate: true });
    // La même clé avec un autre corps serait refusée (§11.1).
    expect(posts[1]?.key).not.toBe(posts[0]?.key);
  });

  it('le deuxième paiement coupé par le réseau repart avec SA clé, toujours la même', async () => {
    const { posts } = server([
      { status: 409, body: POSSIBLE_DUPLICATE },
      { network: true },
      { status: 201, body: DONE },
    ]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    await chooseOrangeMoney10000(user);
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    await user.click(await screen.findByRole('button', { name: /Non, Cheikh a payé deux fois/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Non, Cheikh a payé deux fois/ }));
    await screen.findByTestId('recorded');
    expect(posts.map((p) => p.body.confirm_duplicate ?? false)).toEqual([false, true, true]);
    expect(posts[1]?.key).toBe(posts[2]?.key);
    expect(posts[1]?.key).not.toBe(posts[0]?.key);
  });
});

describe('Idempotency-Key — une clé par intention (§11.1)', () => {
  it('un UUID, différent à chaque tirage', () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newIdempotencyKey()).not.toBe(a);
  });

  it('coupure réseau puis réessai : la MÊME clé', async () => {
    const { posts } = server([{ network: true }, { status: 201, body: DONE }]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    await screen.findByLabelText('2. Combien ?');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/réessayer sans risque/);
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    await screen.findByTestId('recorded');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.key).toBe(posts[1]?.key);
  });

  it('409 duplicate_payment (le filet des deux minutes) : le message, un lien vers la fiche', async () => {
    server([
      {
        status: 409,
        body: {
          message: 'Ce versement vient d’être enregistré. Vérifiez la liste avant de recommencer.',
          code: 'duplicate_payment',
          payment_id: 'p-1',
        },
      },
    ]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    await screen.findByLabelText('2. Combien ?');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: 'Voir ses paiements sur sa fiche' })).toHaveAttribute(
      'href',
      '/bureau/membres/m-cheikh',
    );
  });

  it('422 idempotency_key_reused : une nouvelle clé au prochain envoi', async () => {
    const { posts } = server([
      { status: 422, body: { message: 'Cette clé d’idempotence a déjà servi pour un versement différent.', code: 'idempotency_key_reused' } },
      { status: 201, body: DONE },
    ]);
    const user = userEvent.setup();
    renderInBureau(<EnregistrerPage />);
    await screen.findByLabelText('2. Combien ?');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce paiement' }));
    await screen.findByTestId('recorded');
    expect(posts[0]?.key).not.toBe(posts[1]?.key);
  });
});
