/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/membres/x" }
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FicheMembrePage from '@/app/bureau/membres/[id]/page';
import { openDue } from '@/components/bureau/DirectPaymentPanel';
import {
  dueDateLine,
  StandingPastille,
  standingDetail,
  upToDateWithArrears,
} from '@/components/bureau/Standing';
import type { MemberDetail } from '@/lib/bureau/types';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import {
  CATEGORIES,
  calls,
  fakeServer,
  fullText,
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

  it('sans numéro WhatsApp utilisable (wa_url null) : pas de bouton mort, et ça se dit', async () => {
    // Réponse réelle de demo-asso pour un membre sans téléphone mobile.
    server(MOUSSA, [
      {
        match: /\/whatsapp$/,
        body: { message: NBSP_MESSAGE, wa_url: null, phone_is_usable: false, url: 'https://demo-asso.adhera.africa/m/6yuExNKOD1Pj' },
      },
    ]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Envoyer le lien' }));

    await screen.findByText(/Aucun numéro WhatsApp utilisable/);
    expect(screen.queryByText('Ouvrir WhatsApp')).not.toBeInTheDocument();
    // Le message reste copiable, pour l'envoyer par un autre moyen.
    expect(screen.getByRole('button', { name: 'Copier le message' })).toBeInTheDocument();
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

describe('B9 — « Encaisser » depuis la fiche (R9 dans le panneau)', () => {
  async function openPanel() {
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Encaisser' }));
    return user;
  }

  const DONE = payment({
    status: 'validated',
    method: 'especes',
    method_label: 'Espèces',
    amount: 150000,
    amount_formatted: '150 000 FCFA',
    reference: null,
    receipt: { id: 'r-9', reference: 'REC-2026-AAAA0001' },
  });

  it('affiche la période visée avant toute saisie', async () => {
    server();
    await openPanel();
    expect(
      screen.getByText(fullText('Cotisation du 1er octobre 2026 au 30 septembre 2027 — reste 150 000 FCFA')),
    ).toBeInTheDocument();
  });

  it('préremplit le solde et Espèces ; le récapitulatif tient sur une ligne', async () => {
    server();
    await openPanel();
    expect((screen.getByLabelText(/Montant reçu/) as HTMLInputElement).value).toBe('150000');
    expect(screen.getByRole('radio', { name: 'Espèces' })).toBeChecked();
    expect(screen.getByTestId('recap').textContent).toBe(
      'Moussa Ndiaye (test) — 150 000 FCFA — Espèces — un reçu sera émis',
    );
    // Pas de seconde fenêtre : le bouton dit le montant, et c'est tout.
    expect(screen.getByRole('button', { name: 'Encaisser 150 000 FCFA' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuse un montant au-delà du reste à payer ; Wave n’exige plus de référence', async () => {
    const fetchMock = server();
    const user = await openPanel();
    const amount = screen.getByLabelText(/Montant reçu/);
    await user.clear(amount);
    await user.type(amount, '200000');
    await user.click(screen.getByRole('radio', { name: 'Wave' }));
    await user.click(screen.getByRole('button', { name: /^Encaisser 200 000 FCFA$/ }));

    expect(screen.getByText(/ne peut pas dépasser ce qui reste à payer \(150 000 FCFA\)/)).toBeInTheDocument();
    expect(screen.queryByText(/référence est obligatoire/)).not.toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);
  });

  it('un autre montant : la saisie est réaffichée formatée (§ D)', async () => {
    server();
    const user = await openPanel();
    const amount = screen.getByLabelText(/Montant reçu/);
    await user.clear(amount);
    await user.type(amount, '50000');
    expect(screen.getByText(fullText('Soit 50 000 FCFA'))).toBeInTheDocument();
    expect(screen.getByTestId('recap').textContent).toBe(
      'Moussa Ndiaye (test) — 50 000 FCFA — Espèces — un reçu sera émis',
    );
    expect(screen.getByRole('button', { name: 'Encaisser 50 000 FCFA' })).toBeInTheDocument();
  });

  it('un toucher envoie, et le reçu est proposé', async () => {
    const fetchMock = server(MOUSSA, [
      { method: 'POST', match: /members\/[^/]+\/payments$/, status: 201, body: DONE },
    ]);
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Encaisser 150 000 FCFA' }));

    await screen.findByText(
      fullText('Reçu REC-2026-AAAA0001 émis — 150 000 FCFA. Cotisation du 1er octobre 2026 au 30 septembre 2027.'),
    );
    // Le montant tient sur une ligne.
    expect(screen.getAllByText('150 000 FCFA', { selector: '.money' }).length).toBeGreaterThan(0);
    const post = calls(fetchMock, 'POST')[0];
    expect(JSON.parse(post?.init.body as string)).toEqual({
      amount: 150000,
      method: 'especes',
      paid_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(screen.getByRole('button', { name: 'Télécharger le reçu' })).toBeInTheDocument();
  });

  it('un 422 s’affiche en français, jamais brut', async () => {
    server(MOUSSA, [
      {
        method: 'POST',
        match: /members\/[^/]+\/payments$/,
        status: 422,
        body: { message: 'The amount exceeds the balance.', code: 'amount_exceeds_balance' },
      },
    ]);
    const user = await openPanel();
    await user.click(screen.getByRole('button', { name: 'Encaisser 150 000 FCFA' }));
    await screen.findByText('Le montant dépasse ce qui reste à payer.');
    expect(document.body.textContent).not.toMatch(/exceeds/);
  });

  it('n’est pas proposé quand le mode de cotisation n’est pas pris en charge', async () => {
    server();
    renderInBureau(<FicheMembrePage />, { modeSupported: false });
    await screen.findByRole('heading', { name: 'Moussa Ndiaye (test)' });
    expect(screen.queryByRole('button', { name: 'Encaisser' })).not.toBeInTheDocument();
  });
});

describe('B7 — prénom et nom à l’édition', () => {
  async function edit(member = MOUSSA, extra: Parameters<typeof fakeServer>[0] = []) {
    const fetchMock = server(member, extra);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Modifier' }));
    return { user, fetchMock };
  }

  it('une personne : « Prénom » et « Nom », préremplis ; le PUT n’envoie pas `name`', async () => {
    const { user, fetchMock } = await edit(MOUSSA, [
      { method: 'PUT', match: `membership/members/${MOUSSA.id}`, body: MOUSSA },
    ]);
    expect((screen.getByLabelText(/^Prénom/) as HTMLInputElement).value).toBe('Moussa');
    expect((screen.getByLabelText(/^Nom/) as HTMLInputElement).value).toBe('Ndiaye (test)');
    expect(screen.queryByLabelText(/Raison sociale/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    await waitFor(() => expect(calls(fetchMock, 'PUT')).toHaveLength(1));
    const body = JSON.parse(calls(fetchMock, 'PUT')[0]?.init.body as string);
    expect(body).toMatchObject({ type: 'personne', first_name: 'Moussa', last_name: 'Ndiaye (test)' });
    expect(body).not.toHaveProperty('name');
  });

  it('une fiche ancienne au prénom null : champ vide, et exigé', async () => {
    const { user, fetchMock } = await edit(memberDetail({ first_name: null, last_name: 'Ndiaye' }));
    expect((screen.getByLabelText(/^Prénom/) as HTMLInputElement).value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    expect(screen.getByText('Indiquez le prénom.')).toBeInTheDocument();
    expect(calls(fetchMock, 'PUT')).toHaveLength(0);
  });

  it('une organisation : « Raison sociale » seule ; le PUT n’envoie ni prénom ni nom', async () => {
    const { user, fetchMock } = await edit(AGENCE, [
      { method: 'PUT', match: `membership/members/${AGENCE.id}`, body: AGENCE },
    ]);
    expect((screen.getByLabelText(/Raison sociale/) as HTMLInputElement).value).toBe('Agence Test Conseil (test)');
    expect(screen.queryByLabelText(/^Prénom/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    await waitFor(() => expect(calls(fetchMock, 'PUT')).toHaveLength(1));
    const body = JSON.parse(calls(fetchMock, 'PUT')[0]?.init.body as string);
    expect(body).toMatchObject({ type: 'organisation', name: 'Agence Test Conseil (test)' });
    expect(body).not.toHaveProperty('first_name');
    expect(body).not.toHaveProperty('last_name');
  });

  it('un 422 sur `first_name` se range sous « Prénom », en français', async () => {
    const { user } = await edit(MOUSSA, [
      {
        method: 'PUT',
        match: `membership/members/${MOUSSA.id}`,
        status: 422,
        body: { message: 'Membre invalide.', errors: { first_name: ['The prénom field is required.'] } },
      },
    ]);
    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    await screen.findByText('Indiquez le prénom (255 caractères au plus).');
    expect(document.body.textContent).not.toMatch(/field is required/);
  });
});

describe('contacts d’une organisation : prénom et nom', () => {
  it('exige les deux, puis les envoie sans `name`', async () => {
    const created = {
      id: 'c-2', member_id: AGENCE.id, name: 'Khady Ndiaye', first_name: 'Khady', last_name: 'Ndiaye',
      role_title: null, phone: null, email: null, role: 'principal',
    };
    const fetchMock = server(AGENCE, [
      { method: 'POST', match: /contacts$/, status: 201, body: created },
    ]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Ajouter un contact' }));

    await user.type(screen.getByLabelText(/^Nom/), 'Ndiaye');
    await user.click(screen.getByRole('button', { name: 'Ajouter le contact' }));
    expect(screen.getByText('Indiquez le prénom du contact.')).toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);

    await user.type(screen.getByLabelText(/^Prénom/), 'Khady');
    await user.click(screen.getByRole('button', { name: 'Ajouter le contact' }));
    await screen.findByText('Khady Ndiaye');
    const body = JSON.parse(calls(fetchMock, 'POST')[0]?.init.body as string);
    expect(body).toMatchObject({ first_name: 'Khady', last_name: 'Ndiaye', role: 'principal' });
    expect(body).not.toHaveProperty('name');
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
    await user.click(await screen.findByRole('button', { name: 'Enregistrer une sortie' }));

    await user.click(screen.getByRole('button', { name: 'Vérifier la sortie' }));
    expect(screen.getByText('Choisissez le motif de la sortie.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Motif/), 'resigned');
    await user.click(screen.getByRole('button', { name: 'Vérifier la sortie' }));

    const dialog = screen.getByRole('dialog', { name: 'Enregistrer la sortie de ce membre ?' });
    expect(within(dialog).getByText('Démission')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Le membre passera dans les anciens membres. Son historique est conservé.'),
    ).toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer la sortie' }));
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

describe('§11 — annuler un encaissement, sans rien perdre', () => {
  const WITH_CANCELLED_RECEIPT = memberDetail({
    dues: MOUSSA.dues.map((due) => ({
      ...due,
      receipts: due.receipts.map((r) => ({ ...r, cancelled_at: '2026-11-01T14:32:11+00:00' })),
    })),
  });
  const CANCELLED = {
    ...VALIDATED,
    status: 'cancelled' as const,
    cancelled_at: '2026-11-01T14:32:11+00:00',
    cancelled_by_user_id: 7,
    cancelled_by_name: 'Fatou Sow',
    cancel_reason: 'Chèque revenu impayé par la banque',
  };

  it('seulement sur un versement validé ; un signalé n’a pas ce bouton', async () => {
    nav.params = { id: MOUSSA.id };
    fakeServer([
      { match: /payments\?member_id=/, body: [VALIDATED, payment({ id: 'p-declared' })] },
      { match: `membership/members/${MOUSSA.id}`, body: MOUSSA },
    ]);
    renderInBureau(<FicheMembrePage />);
    expect(await screen.findAllByRole('button', { name: 'Annuler cet encaissement' })).toHaveLength(1);
  });

  it('motif obligatoire (10 caractères), récapitulatif complet, puis l’affichage après annulation', async () => {
    // Après l'annulation, la relecture sert le versement annulé, comme le serveur.
    let cancelled = false;
    const fetchMock = server(MOUSSA, [
      {
        method: 'POST',
        match: /payments\/[^/]+\/cancel$/,
        get body() {
          cancelled = true;
          return CANCELLED;
        },
      },
      {
        match: /payments\?member_id=/,
        get body() {
          return [cancelled ? CANCELLED : VALIDATED];
        },
      },
      {
        match: `membership/members/${MOUSSA.id}`,
        get body() {
          return cancelled ? WITH_CANCELLED_RECEIPT : MOUSSA;
        },
      },
    ]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Annuler cet encaissement' }));

    expect(screen.getByTestId('cancel-recap').textContent).toBe(
      'Annuler 100 000 FCFA (Wave, 29/10/2026) de Moussa Ndiaye (test) ? Sa cotisation redeviendra à régler et le reçu REC-2026-CB4A73AE sera marqué annulé. Rien n’est supprimé.',
    );

    const reason = screen.getByLabelText(/Motif de l’annulation/);
    await user.type(reason, '   court  ');
    await user.click(screen.getByRole('button', { name: 'Oui, annuler cet encaissement' }));
    expect(screen.getByText('Expliquez le motif en 10 caractères au moins.')).toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);

    await user.clear(reason);
    await user.type(reason, '  Chèque revenu impayé par la banque ');
    await user.click(screen.getByRole('button', { name: 'Oui, annuler cet encaissement' }));

    const line = await screen.findByTestId('cancelled-line');
    expect(line.textContent).toMatch(/^Annulé le 1er novembre 2026 par Fatou Sow — motif : Chèque revenu impayé par la banque$/);
    const [post] = calls(fetchMock, 'POST');
    expect(post?.url).toBe(`https://api.eventflow.africa/api/v1/admin/membership/payments/${VALIDATED.id}/cancel`);
    expect(JSON.parse(post?.init.body as string)).toEqual({ reason: 'Chèque revenu impayé par la banque' });
    // Le reçu reste téléchargeable, marqué annulé.
    expect(screen.getAllByRole('button', { name: /REC-2026-CB4A73AE/ }).length).toBeGreaterThan(0);
    expect(screen.getByText('Reçu annulé')).toBeInTheDocument();
    // La cotisation marque aussi le reçu : `cancelled_at` servi par la fiche (§12.4).
    const dues = screen.getByRole('heading', { name: 'Cotisations' }).closest('section') as HTMLElement;
    await waitFor(() => expect(within(dues).getByText('Annulé')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Annuler cet encaissement' })).toBeNull();
  });

  it('§3 — les boutons disent ce qu’ils font : « Oui, annuler cet encaissement » / « Garder l’encaissement »', async () => {
    server(MOUSSA);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Annuler cet encaissement' }));
    expect(screen.getByRole('button', { name: 'Oui, annuler cet encaissement' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Annuler l’encaissement' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ne rien changer' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Garder l’encaissement' }));
    expect(screen.queryByTestId('cancel-recap')).toBeNull();
  });

  it('§3 — le récapitulatif dit « à régler », vrai aussi quand la cotisation redevient partielle', async () => {
    server(MOUSSA);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Annuler cet encaissement' }));
    const recap = screen.getByTestId('cancel-recap').textContent ?? '';
    expect(recap).toContain('Sa cotisation redeviendra à régler');
    expect(recap).not.toMatch(/redeviendra due/);
  });

  it('§12.4 — le reçu d’une cotisation est marqué depuis `cancelled_at` servi, jamais déduit', async () => {
    // Servi annulé, sans aucun versement annulé dans la liste : marqué.
    server(WITH_CANCELLED_RECEIPT, [{ match: /payments\?member_id=/, body: [] }]);
    const { unmount } = renderInBureau(<FicheMembrePage />);
    let dues = (await screen.findByRole('heading', { name: 'Cotisations' })).closest('section') as HTMLElement;
    expect(within(dues).getByText('Annulé')).toBeInTheDocument();
    unmount();

    // Versement annulé, mais reçu servi `cancelled_at: null` : la fiche ne
    // devine plus rien — c'est le serveur qui fait foi.
    server(MOUSSA, [{ match: /payments\?member_id=/, body: [CANCELLED] }]);
    renderInBureau(<FicheMembrePage />);
    await screen.findByText('Reçu annulé');
    dues = screen.getByRole('heading', { name: 'Cotisations' }).closest('section') as HTMLElement;
    expect(within(dues).queryByText('Annulé')).toBeNull();
  });

  it('422 payment_not_cancellable : la fiche le dit et se recharge', async () => {
    const fetchMock = server(MOUSSA, [
      { method: 'POST', match: /payments\/[^/]+\/cancel$/, status: 422, body: { code: 'payment_not_cancellable', message: 'x' } },
    ]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Annuler cet encaissement' }));
    await user.type(screen.getByLabelText(/Motif de l’annulation/), 'Erreur de saisie du montant');
    await user.click(screen.getByRole('button', { name: 'Oui, annuler cet encaissement' }));
    expect(await screen.findByText(/ne peut plus être annulé/)).toBeInTheDocument();
    await waitFor(() =>
      expect(calls(fetchMock).filter((c) => c.url.includes(`members/${MOUSSA.id}`)).length).toBeGreaterThan(1),
    );
  });
});

/* ───────────────────── F3.1 — arriérés et échéance (§12) ───────────────────── */

function due(
  id: string,
  start: string,
  end: string,
  extra: Partial<MemberDetail['dues'][number]> = {},
): MemberDetail['dues'][number] {
  return {
    id,
    period_start: start,
    period_end: end,
    due_date: start,
    status: 'due',
    origin: 'platform',
    amount_due: 250000,
    amount_due_formatted: '250 000 FCFA',
    amount_paid: 0,
    amount_paid_formatted: '0 FCFA',
    balance_due: 250000,
    balance_due_formatted: '250 000 FCFA',
    settled_at: null,
    receipts: [],
    receipt_available: false,
    is_unclaimed_arrears: false,
    ...extra,
  };
}

/** Absente depuis deux ans, sous `current_only` : seule l'année en cours est réclamée. */
const AWA_CURRENT_ONLY = memberDetail({
  id: 'm-awa',
  name: 'Awa Diouf',
  balance_due: 250000,
  balance_due_formatted: '250 000 FCFA',
  next_due_date: '2026-10-01',
  dues: [
    due('d-2026', '2026-10-01', '2027-09-30'),
    due('d-2025', '2025-10-01', '2026-09-30', { is_unclaimed_arrears: true }),
    due('d-2024', '2024-10-01', '2025-09-30', { is_unclaimed_arrears: true }),
  ],
});

/** La même membre sous `all`, l'année en cours réglée : à jour ET deux arriérés. */
const AWA_ALL = memberDetail({
  id: 'm-awa',
  name: 'Awa Diouf',
  is_up_to_date: true,
  covered_until: '2027-09-30',
  next_due_date: '2027-10-01',
  balance_due: 500000,
  balance_due_formatted: '500 000 FCFA',
  dues: [
    due('d-2026', '2026-10-01', '2027-09-30', {
      status: 'reglee',
      amount_paid: 250000,
      amount_paid_formatted: '250 000 FCFA',
      balance_due: 0,
      balance_due_formatted: '0 FCFA',
    }),
    due('d-2025', '2025-10-01', '2026-09-30'),
    due('d-2024', '2024-10-01', '2025-09-30'),
  ],
});

function duesSection() {
  return screen.getByRole('heading', { name: 'Cotisations' }).closest('section') as HTMLElement;
}

function situation() {
  return screen.getByRole('heading', { name: 'Situation' }).closest('section') as HTMLElement;
}

describe('§1 — l’historique et le reste à payer', () => {
  it('une cotisation non réclamée : listée, grisée, pastille « Non réclamée », hors du reste à payer', async () => {
    server(AWA_CURRENT_ONLY, [{ match: /payments\?member_id=/, body: [] }]);
    renderInBureau(<FicheMembrePage />);
    await screen.findByRole('heading', { name: 'Awa Diouf' });

    const cards = within(duesSection()).getAllByRole('listitem').filter((li) => li.querySelector('dl'));
    expect(cards).toHaveLength(3);
    const [current, y2025, y2024] = cards as [HTMLElement, HTMLElement, HTMLElement];
    expect(current).not.toHaveAttribute('data-unclaimed');
    expect(within(current).getByText('À régler')).toBeInTheDocument();
    for (const card of [y2025, y2024]) {
      expect(card).toHaveAttribute('data-unclaimed', 'true');
      expect(card.className).toContain('text-ink-muted');
      expect(within(card).getByText('Non réclamée')).toBeInTheDocument();
      expect(within(card).queryByText('À régler')).toBeNull();
      // Rien n'est caché : le montant reste là.
      expect(within(card).getAllByText('250 000 FCFA').length).toBeGreaterThan(0);
    }
    // Le reste à payer est celui du serveur : l'année en cours, pas 3 × 250 000.
    expect(within(situation()).getByText(fullText('250 000 FCFA'))).toBeInTheDocument();
    expect(situation().textContent).not.toMatch(/750 000/);
  });

  it('la ligne d’explication n’apparaît qu’une fois, sous la première non réclamée, avec le lien vers le réglage', async () => {
    server(AWA_CURRENT_ONLY, [{ match: /payments\?member_id=/, body: [] }]);
    renderInBureau(<FicheMembrePage />);
    await screen.findByRole('heading', { name: 'Awa Diouf' });
    const notes = screen.getAllByTestId('unclaimed-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent?.replace(/\s+/g, ' ')).toBe(
      'L’association repart de l’année en cours. Les années précédentes ne sont pas réclamées. (Réglages)',
    );
    expect(within(notes[0] as HTMLElement).getByRole('link', { name: 'Réglages' })).toHaveAttribute(
      'href',
      '/bureau/reglages#arrieres',
    );
    expect((notes[0] as HTMLElement).closest('li')).toHaveAttribute('data-unclaimed', 'true');
    expect((notes[0] as HTMLElement).closest('li')).toHaveTextContent('Du 1er octobre 2025 au 30 septembre 2026');
  });

  it('sans arriéré non réclamé : aucune ligne d’explication', async () => {
    server();
    renderInBureau(<FicheMembrePage />);
    await screen.findByRole('heading', { name: 'Cotisations' });
    expect(screen.queryByTestId('unclaimed-note')).toBeNull();
  });

  it('« Encaisser » vise l’année réclamée, jamais un arriéré non réclamé', async () => {
    server(AWA_CURRENT_ONLY, [{ match: /payments\?member_id=/, body: [] }]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Encaisser' }));
    expect(
      screen.getByText(fullText('Cotisation du 1er octobre 2026 au 30 septembre 2027 — reste 250 000 FCFA')),
    ).toBeInTheDocument();
    expect(openDue(AWA_CURRENT_ONLY)?.id).toBe('d-2026');
  });

  it('sous `all` : jamais « À jour » seul à côté d’un dû — « À jour pour l’année en cours — arriérés : 500 000 FCFA »', async () => {
    server(AWA_ALL, [{ match: /payments\?member_id=/, body: [] }]);
    renderInBureau(<FicheMembrePage />);
    await screen.findByRole('heading', { name: 'Awa Diouf' });

    expect(
      within(situation()).getByText(fullText('À jour pour l’année en cours — arriérés : 500 000 FCFA')),
    ).toBeInTheDocument();
    // Ni dans la Situation, ni dans la pastille du titre.
    expect(screen.queryByText(/^À jour$/)).toBeNull();
    expect(screen.getByText('Arriérés à régler')).toBeInTheDocument();
    // Sous `all`, rien n'est marqué non réclamé.
    expect(screen.queryByText('Non réclamée')).toBeNull();
    expect(screen.queryByTestId('unclaimed-note')).toBeNull();
  });

  it('le registre aussi : pastille et détail, jamais « À jour » seul', () => {
    const { container } = render(
      <>
        <StandingPastille member={AWA_ALL} />
        <span>{standingDetail(AWA_ALL)}</span>
      </>,
    );
    expect(container.textContent).toBe('Arriérés à régler' + 'À jour pour l’année en cours — arriérés : 500 000 FCFA');
    // Un membre à jour sans dû reste « À jour ».
    const clean = memberDetail({ is_up_to_date: true, balance_due: 0, balance_due_formatted: '0 FCFA' });
    expect(upToDateWithArrears(clean)).toBe(false);
    // Montant inconnu : ce n'est pas un arriéré qu'on sait dire.
    expect(upToDateWithArrears({ ...AWA_ALL, balance_due: null, balance_due_formatted: null })).toBe(false);
  });
});

describe('§1 — l’échéance : lue, comparée à aujourd’hui, jamais calculée', () => {
  const TODAY = '2026-11-01';

  it('passée et pas à jour → « En retard depuis le … »', () => {
    expect(dueDateLine(memberDetail({ next_due_date: '2026-10-01' }), TODAY)).toEqual({
      late: true,
      label: 'Échéance',
      value: 'En retard depuis le 1er octobre 2026',
    });
  });

  it('sinon → « Prochaine échéance » : à venir, aujourd’hui, ou passée mais à jour', () => {
    expect(dueDateLine(memberDetail({ next_due_date: '2027-10-01' }), TODAY)).toEqual({
      late: false,
      label: 'Prochaine échéance',
      value: '1er octobre 2027',
    });
    expect(dueDateLine(memberDetail({ next_due_date: TODAY }), TODAY)?.late).toBe(false);
    expect(dueDateLine(memberDetail({ next_due_date: '2026-10-01', is_up_to_date: true }), TODAY)?.late).toBe(false);
    expect(dueDateLine(memberDetail({ next_due_date: null }), TODAY)).toBeNull();
  });

  it('un ancien membre : aucune échéance, ni dans la fonction ni à l’écran', async () => {
    const cheikh = memberDetail({
      status: 'former',
      left_at: '2026-10-20',
      left_reason: 'resigned',
      is_up_to_date: false,
      next_due_date: '2026-03-01',
      balance_due: 0,
      balance_due_formatted: '0 FCFA',
      dues: [],
    });
    expect(dueDateLine(cheikh, TODAY)).toBeNull();
    server(cheikh, [{ match: /payments\?member_id=/, body: [] }]);
    renderInBureau(<FicheMembrePage />);
    await screen.findByText(/Ancien membre depuis le 20 octobre 2026/);
    expect(screen.queryByTestId('echeance')).toBeNull();
    expect(within(situation()).queryByText(/échéance/i)).toBeNull();
    expect(situation().textContent).not.toMatch(/1er mars 2026|En retard/);
  });

  it('à l’écran : la date servie, telle quelle', async () => {
    server(memberDetail({ next_due_date: '2020-10-01' }));
    const { unmount } = renderInBureau(<FicheMembrePage />);
    expect(await screen.findByTestId('echeance')).toHaveTextContent(/^En retard depuis le 1er octobre 2020$/);
    expect(within(situation()).getByText('Échéance')).toBeInTheDocument();
    unmount();

    server(memberDetail({ next_due_date: '2099-10-01', is_up_to_date: true, balance_due: 0, balance_due_formatted: '0 FCFA' }));
    renderInBureau(<FicheMembrePage />);
    expect(await screen.findByTestId('echeance')).toHaveTextContent(/^1er octobre 2099$/);
    expect(within(situation()).getByText('Prochaine échéance')).toBeInTheDocument();
  });
});
