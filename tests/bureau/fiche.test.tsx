/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/membres/x" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FicheMembrePage from '@/app/bureau/membres/[id]/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import {
  CATEGORIES,
  calls,
  fakeServer,
  memberDetail,
  ORGANISATION,
  payment,
  renderInBureau,
  SESSION,
} from './fixtures';

const nav = vi.hoisted(() => ({ params: { id: '' } }));

vi.mock('next/navigation', () => ({
  useParams: () => nav.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/bureau/membres/x',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const MOUSSA = memberDetail();
const AGENCE = memberDetail({
  ...ORGANISATION,
  contacts: [
    {
      id: '01a18944-72ce-72e0-859e-95122be0fa30',
      member_id: ORGANISATION.id,
      name: 'Awa Diouf',
      role_title: 'Directrice administrative',
      phone: '771112233',
      email: 'awa@example.sn',
      role: 'principal',
    },
  ],
  dues: [],
});

const VALIDATED = payment({
  status: 'validated',
  decided_at: '2026-10-29T20:01:26+00:00',
  decided_by_name: 'Trésorier Démo',
  receipt: { id: '01a18940-c9a5-71ec-970d-9d7510492173', reference: 'REC-2026-CB4A73AE' },
});

const NBSP_MESSAGE =
  'Bonjour Moussa Ndiaye (test),\nVotre cotisation Association Démo de 250 000 FCFA est attendue depuis le 01/10/2026.\nConfirmez votre paiement ici :\nhttps://demo-asso.adhera.africa/m/6yuExNKOD1Pj';

function server(member = MOUSSA, extra: Parameters<typeof fakeServer>[0] = []) {
  nav.params = { id: member.id };
  return fakeServer([
    ...extra,
    { match: 'membership/categories', body: CATEGORIES },
    { match: /payments\?member_id=/, body: [VALIDATED] },
    { match: /\/whatsapp$/, body: { message: NBSP_MESSAGE, wa_url: 'https://wa.me/221775695563?text=Bonjour' } },
    { match: /\/link$/, body: { url: 'https://demo-asso.adhera.africa/m/6yuExNKOD1Pj', rotated_at: null } },
    { match: `membership/members/${member.id}`, body: member },
  ]);
}

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

describe('B7 — la fiche', () => {
  it('une personne : identité, cotisations et leurs reçus, versements — pas de contacts', async () => {
    const fetchMock = server();
    renderInBureau(<FicheMembrePage />);

    await screen.findByRole('heading', { name: 'Moussa Ndiaye (test)' });
    expect(screen.getByText('Du 1er octobre 2026 au 30 septembre 2027')).toBeInTheDocument();
    expect(screen.getAllByText('250 000 FCFA').length).toBeGreaterThan(0);
    // Le reçu de la période (et, plus bas, celui du versement qui l'a produit).
    expect(
      screen.getAllByRole('button', { name: 'Télécharger le reçu REC-2026-CB4A73AE' }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Contacts' })).not.toBeInTheDocument();

    // L'historique du membre : status=all, sinon on n'aurait que les déclarations.
    await screen.findByText('Validé le 29 octobre 2026 par Trésorier Démo');
    expect(calls(fetchMock).some((c) => c.url.endsWith(`payments?member_id=${MOUSSA.id}&status=all`))).toBe(true);
  });

  it('une organisation : le bloc contacts', async () => {
    server(AGENCE);
    renderInBureau(<FicheMembrePage />);
    await screen.findByRole('heading', { name: 'Contacts' });
    expect(screen.getByText('Awa Diouf')).toBeInTheDocument();
    expect(screen.getByText('Contact principal · Directrice administrative')).toBeInTheDocument();
    // balance_due null → « — », jamais « 0 FCFA ».
    expect(screen.queryByText('0 FCFA')).not.toBeInTheDocument();
  });

  it('404 → « Membre introuvable. », jamais le message brut de Laravel', async () => {
    nav.params = { id: '01a00000-0000' };
    fakeServer([
      { match: /payments\?member_id=/, status: 422, body: { message: 'Membre inconnu', code: 'unknown_member' } },
      {
        match: 'membership/members/',
        status: 404,
        body: { message: 'No query results for model [App\\Membership\\Models\\Member] 01a00000-0000' },
      },
    ]);
    renderInBureau(<FicheMembrePage />);
    await screen.findByText('Membre introuvable.');
    expect(document.body.textContent).not.toMatch(/App\\|Models|No query results/);
  });
});

describe('B8 — le lien du membre', () => {
  it('ouvre WhatsApp dans un nouvel onglet et copie le message TEL QUEL', async () => {
    server();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Envoyer le lien' }));

    const wa = await screen.findByRole('link', { name: 'Ouvrir WhatsApp' });
    expect(wa).toHaveAttribute('href', 'https://wa.me/221775695563?text=Bonjour');
    expect(wa).toHaveAttribute('target', '_blank');
    expect(wa).toHaveAttribute('rel', 'noopener noreferrer');

    // userEvent remplace le presse-papiers : on réinstalle l'espion.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copier le message' }));
    // Les espaces insécables du montant sont intacts.
    expect(writeText).toHaveBeenCalledWith(NBSP_MESSAGE);
    expect((writeText.mock.calls[0]?.[0] as string).includes('250 000 FCFA')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Copier le lien' }));
    expect(writeText).toHaveBeenLastCalledWith('https://demo-asso.adhera.africa/m/6yuExNKOD1Pj');
  });

  it('régénérer passe par une confirmation qui dit ce qu’elle casse (R9)', async () => {
    const fetchMock = server(MOUSSA, [
      { method: 'POST', match: /link\/rotate$/, body: { url: 'https://demo-asso.adhera.africa/m/NOUVEAU', rotated_at: '2026-10-29T21:00:00+00:00' } },
    ]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Envoyer le lien' }));
    await user.click(await screen.findByRole('button', { name: 'Régénérer le lien' }));

    const dialog = screen.getByRole('dialog', { name: 'Régénérer le lien ?' });
    expect(
      within(dialog).getByText('L’ancien lien ne fonctionnera plus. Le membre devra recevoir le nouveau.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Moussa Ndiaye (test)')).toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Régénérer le lien' }));
    await screen.findByText('https://demo-asso.adhera.africa/m/NOUVEAU');
    expect(calls(fetchMock, 'POST')).toHaveLength(1);
  });
});

describe('B9 — la saisie directe (R9)', () => {
  async function openPanel() {
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Enregistrer un versement' }));
    return user;
  }

  it('affiche la période visée avant toute saisie', async () => {
    server();
    await openPanel();
    expect(
      screen.getByText(
        'Cotisation du 1er octobre 2026 au 30 septembre 2027 — reste à payer 150 000 FCFA',
      ),
    ).toBeInTheDocument();
  });

  it('refuse un montant au-delà du reste à payer, et une référence Wave absente', async () => {
    const fetchMock = server();
    const user = await openPanel();
    const amount = screen.getByLabelText(/Montant reçu/);
    await user.clear(amount);
    await user.type(amount, '200000');
    await user.click(screen.getByRole('radio', { name: 'Wave' }));
    await user.click(screen.getByRole('button', { name: 'Vérifier le versement' }));

    expect(screen.getByText(/ne peut pas dépasser ce qui reste à payer \(150 000 FCFA\)/)).toBeInTheDocument();
    expect(screen.getByText('La référence est obligatoire pour Orange Money et Wave.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);
  });

  it('récapitule, prévient, puis enregistre et propose le reçu', async () => {
    const fetchMock = server(MOUSSA, [
      {
        method: 'POST',
        match: /members\/[^/]+\/payments$/,
        status: 201,
        body: payment({
          status: 'validated',
          method: 'especes',
          method_label: 'Espèces',
          amount: 150000,
          amount_formatted: '150 000 FCFA',
          reference: null,
          receipt: { id: 'r-9', reference: 'REC-2026-AAAA0001' },
        }),
      },
    ]);
    const user = await openPanel();
    // Préremplie avec le solde, la saisie est la valeur brute du champ (R1).
    expect((screen.getByLabelText(/Montant reçu/) as HTMLInputElement).value).toBe('150000');
    await user.click(screen.getByRole('button', { name: 'Vérifier le versement' }));

    const dialog = screen.getByRole('dialog', { name: 'Enregistrer ce versement ?' });
    expect(within(dialog).getByText('Moussa Ndiaye (test)')).toBeInTheDocument();
    expect(within(dialog).getByText('le solde de la période, 150 000 FCFA')).toBeInTheDocument();
    expect(within(dialog).getByText('Espèces')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Ce versement sera enregistré et validé immédiatement, et un reçu sera émis.',
      ),
    ).toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer et émettre le reçu' }));

    await screen.findByText(/Versement de 150 000 FCFA enregistré et validé\. Reçu émis\./);
    const post = calls(fetchMock, 'POST')[0];
    expect(JSON.parse(post?.init.body as string)).toEqual({
      amount: 150000,
      method: 'especes',
      paid_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(screen.getByRole('button', { name: 'Télécharger le reçu' })).toBeInTheDocument();
  });

  it('n’est pas proposée quand le mode de cotisation n’est pas pris en charge', async () => {
    server();
    renderInBureau(<FicheMembrePage />, { modeSupported: false });
    await screen.findByRole('heading', { name: 'Moussa Ndiaye (test)' });
    expect(screen.queryByRole('button', { name: 'Enregistrer un versement' })).not.toBeInTheDocument();
  });
});

describe('B10 — la sortie (R9)', () => {
  it('exige un motif, récapitule, puis envoie left_reason', async () => {
    const fetchMock = server(MOUSSA, [
      {
        method: 'POST',
        match: /\/leave$/,
        body: { ...MOUSSA, status: 'former', left_at: '2026-10-29', left_reason: 'resigned' },
      },
    ]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Déclarer une sortie' }));

    await user.click(screen.getByRole('button', { name: 'Vérifier la sortie' }));
    expect(screen.getByText('Choisissez le motif de la sortie.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Motif/), 'resigned');
    await user.click(screen.getByRole('button', { name: 'Vérifier la sortie' }));

    const dialog = screen.getByRole('dialog', { name: 'Déclarer la sortie de ce membre ?' });
    expect(within(dialog).getByText('Démission')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Le membre passera dans les anciens membres. Son historique est conservé.'),
    ).toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Déclarer la sortie' }));
    await waitFor(() => expect(calls(fetchMock, 'POST')).toHaveLength(1));
    const body = JSON.parse(calls(fetchMock, 'POST')[0]?.init.body as string);
    expect(body.left_reason).toBe('resigned');
    expect(body.reason).toBeUndefined();
  });

  it('l’interface ne propose aucune suppression de membre', async () => {
    server();
    renderInBureau(<FicheMembrePage />);
    await screen.findByRole('heading', { name: 'Moussa Ndiaye (test)' });
    expect(screen.queryByRole('button', { name: /supprimer/i })).not.toBeInTheDocument();
  });
});
