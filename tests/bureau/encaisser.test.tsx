/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/encaisser" }
 */

import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EncaisserPage from '@/app/bureau/encaisser/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import {
  calls,
  fakeServer,
  fullText,
  memberDetail,
  memberItem,
  ORGANISATION,
  payment,
  renderInBureau,
  SESSION,
} from './fixtures';

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
const CANDIDAT = memberItem({
  id: 'p-1',
  name: 'Moussa Diop',
  first_name: 'Moussa',
  last_name: 'Diop',
  status: 'pending',
  category_label: 'Membre actif',
  balance_due: null,
  balance_due_formatted: null,
});
const DONE = payment({
  status: 'validated',
  method: 'especes',
  method_label: 'Espèces',
  amount: 150000,
  amount_formatted: '150 000 FCFA',
  reference: null,
  receipt: { id: 'r-9', reference: 'REC-2026-AAAA0001' },
});

function server(extra: Parameters<typeof fakeServer>[0] = []) {
  return fakeServer([
    ...extra,
    { match: /members\?status=active/, body: [memberItem(), ORGANISATION] },
    { match: /members\?status=pending/, body: [CANDIDAT] },
    { match: `membership/members/${MOUSSA.id}`, body: MOUSSA },
  ]);
}

function searchUrls(fetchMock: ReturnType<typeof server>) {
  return calls(fetchMock)
    .map((c) => c.url)
    .filter((u) => u.includes('/membership/members?'));
}

/** Les touchers du parcours : la saisie compte pour un. */
async function searchAndPick(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Nom, prénom ou téléphone'), 'Mou');
  await user.click(await screen.findByRole('button', { name: /Moussa Ndiaye \(test\)/ }, { timeout: 1500 }));
  return screen.findByRole('button', { name: 'Encaisser 150 000 FCFA' });
}

describe('« Encaisser » — chercher, toucher, encaisser', () => {
  it('le champ est libellé « Nom, prénom ou téléphone » et attend la frappe', async () => {
    server();
    renderInBureau(<EncaisserPage />);
    const input = screen.getByLabelText('Nom, prénom ou téléphone');
    expect(document.activeElement).toBe(input);
  });

  it('cherche après 300 ms, sur les actifs ET les candidats', async () => {
    const fetchMock = server();
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    await user.type(screen.getByLabelText('Nom, prénom ou téléphone'), 'Mou');
    expect(searchUrls(fetchMock)).toHaveLength(0);

    await waitFor(() => expect(searchUrls(fetchMock)).toHaveLength(2), { timeout: 1500 });
    expect(searchUrls(fetchMock).sort()).toEqual([
      'https://api.eventflow.africa/api/v1/admin/membership/members?status=active&search=Mou',
      'https://api.eventflow.africa/api/v1/admin/membership/members?status=pending&search=Mou',
    ]);
  });

  it('chaque résultat : prénom et nom, catégorie, reste dû (ou « — »)', async () => {
    server();
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    await user.type(screen.getByLabelText('Nom, prénom ou téléphone'), 'Mou');

    const moussa = await screen.findByRole('button', { name: /Moussa Ndiaye \(test\)/ }, { timeout: 1500 });
    expect(moussa.textContent).toContain('Membre actif');
    expect(moussa.textContent).toContain('150 000 FCFA');
    // null = inconnu : « — », jamais « 0 FCFA ».
    const candidat = screen.getByRole('button', { name: /Moussa Diop/ });
    expect(candidat.textContent).toContain('Candidature');
    expect(candidat.textContent).toContain('—');
    expect(candidat.textContent).not.toContain('0 FCFA');
    // L'ordre du serveur, actifs puis candidats : aucun retri.
    const names = screen.getAllByRole('listitem').map((li) => li.querySelector('.font-semibold')?.textContent);
    expect(names).toEqual(['Moussa Ndiaye (test)', 'Agence Test Conseil (test)', 'Moussa Diop']);
  });

  it('toucher un membre ouvre le panneau prérempli : période, solde, Espèces, aujourd’hui', async () => {
    server();
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    await searchAndPick(user);

    expect(
      screen.getByText(fullText('Cotisation du 1er octobre 2026 au 30 septembre 2027 — reste 150 000 FCFA')),
    ).toBeInTheDocument();
    expect((screen.getByLabelText(/Montant reçu/) as HTMLInputElement).value).toBe('150000');
    expect(screen.getByRole('radio', { name: 'Espèces' })).toBeChecked();
    expect((screen.getByLabelText('Date du paiement') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // La référence est facultative et repliée.
    expect(screen.queryByLabelText(/Référence/)).not.toBeInTheDocument();
    expect(screen.getByTestId('recap').textContent).toBe(
      'Moussa Ndiaye (test) — 150 000 FCFA — Espèces — un reçu sera émis',
    );
  });

  it('« Encaisser 150 000 FCFA » envoie, puis le reçu et « Encaisser un autre paiement »', async () => {
    const fetchMock = server([
      { method: 'POST', match: /members\/[^/]+\/payments$/, status: 201, body: DONE },
    ]);
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    await user.click(await searchAndPick(user));

    await screen.findByText('Reçu REC-2026-AAAA0001 émis');
    const posts = calls(fetchMock, 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(
      `https://api.eventflow.africa/api/v1/admin/membership/members/${MOUSSA.id}/payments`,
    );
    expect(JSON.parse(posts[0]?.init.body as string)).toEqual({
      amount: 150000,
      method: 'especes',
      paid_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(screen.getByRole('button', { name: 'Télécharger le reçu' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Encaisser un autre paiement' }));
    const input = screen.getByLabelText('Nom, prénom ou téléphone') as HTMLInputElement;
    expect(input.value).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('un 422 affiche le message en français, et le panneau reste ouvert', async () => {
    server([
      {
        method: 'POST',
        match: /members\/[^/]+\/payments$/,
        status: 422,
        body: { message: 'Aucune cotisation réclamée.', code: 'nothing_due' },
      },
    ]);
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    await user.click(await searchAndPick(user));

    await screen.findByText('Aucune cotisation n’est réclamée à ce membre pour le moment.');
    expect(screen.getByRole('button', { name: 'Encaisser 150 000 FCFA' })).toBeInTheDocument();
  });

  it('un 422 de validation : le champ désigné, libellé en français', async () => {
    server([
      {
        method: 'POST',
        match: /members\/[^/]+\/payments$/,
        status: 422,
        body: { message: 'The amount field must be at least 1.', errors: { amount: ['The amount field must be at least 1.'] } },
      },
    ]);
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    await user.click(await searchAndPick(user));
    await screen.findByText('Vérifiez le montant.');
    expect(document.body.textContent).not.toMatch(/must be at least/);
  });

  it('« Changer de membre » revient à la recherche', async () => {
    server();
    const user = userEvent.setup();
    renderInBureau(<EncaisserPage />);
    await searchAndPick(user);
    await user.click(screen.getByRole('button', { name: 'Changer de membre' }));
    expect(screen.getByLabelText('Nom, prénom ou téléphone')).toBeInTheDocument();
  });

  it('mode de cotisation non pris en charge : rien à encaisser, et ça se dit', () => {
    server();
    renderInBureau(<EncaisserPage />, { modeSupported: false });
    expect(screen.queryByLabelText('Nom, prénom ou téléphone')).not.toBeInTheDocument();
    expect(screen.getByText(/sera disponible quand le mode de cotisation/)).toBeInTheDocument();
  });
});
