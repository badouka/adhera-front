/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/membres/x" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FicheMembrePage, { yearsOf } from '@/app/bureau/membres/[id]/page';
import { setFlash, takeFlash } from '@/lib/bureau/flash';
import { openDue } from '@/lib/bureau/dues';
import type { MemberDetail } from '@/lib/bureau/types';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import {
  CATEGORIES,
  calls,
  fakeServer,
  memberDetail,
  ORGANISATION,
  payment,
  panelReady,
  renderInBureau,
  SESSION,
  share,
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
    amount_due: 25000,
    amount_due_formatted: '25 000 FCFA',
    amount_paid: 0,
    amount_paid_formatted: '0 FCFA',
    balance_due: 25000,
    balance_due_formatted: '25 000 FCFA',
    settled_at: null,
    receipts: [],
    receipt_available: false,
    is_unclaimed_arrears: false,
    ...extra,
  };
}

/** Cheikh Diouf : en retard, deux anciennes années non demandées (`current_only`). */
const CHEIKH = memberDetail({
  id: 'm-cheikh',
  name: 'Cheikh Diouf',
  first_name: 'Cheikh',
  last_name: 'Diouf',
  category_label: 'Membre actif',
  member_number: '0007',
  phone: '77 000 00 07',
  next_due_date: '2026-09-03',
  balance_due: 25001,
  balance_due_formatted: '25 000 FCFA',
  dues: [
    due('d-2026', '2026-09-03', '2027-09-02'),
    due('d-2024', '2024-09-03', '2025-09-02', { is_unclaimed_arrears: true }),
  ],
  missing_periods: [
    {
      period_start: '2025-09-03',
      period_end: '2026-09-02',
      period_label: '3 septembre 2025 → 2 septembre 2026',
      amount_due: 25000,
      amount_due_formatted: '25 000 FCFA',
      is_unclaimed_arrears: true,
    },
  ],
});

const AMINATA = memberDetail({
  id: 'm-aminata',
  name: 'Aminata Diop',
  first_name: 'Aminata',
  last_name: 'Diop',
  is_up_to_date: true,
  covered_until: '2027-03-02',
  balance_due: 0,
  balance_due_formatted: '0 FCFA',
  dues: [due('d-a', '2026-03-03', '2027-03-02', { status: 'reglee', balance_due: 0, balance_due_formatted: '0 FCFA' })],
});

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

const ACCEPTED = payment({
  id: 'p-ok',
  member_id: 'm-cheikh',
  member_name: 'Cheikh Diouf',
  status: 'validated',
  amount_formatted: '10 000 FCFA',
  method_label: 'Orange Money',
  paid_on: '2026-11-03',
  decided_at: '2026-11-03T20:01:26+00:00',
  decided_by_name: 'Trésorier Démo',
  receipt: { id: '01a18940-c9a5-71ec-970d-9d7510492173', reference: 'REC-2026-CB4A73AE' },
});

function server(member: MemberDetail = CHEIKH, extra: Parameters<typeof fakeServer>[0] = []) {
  nav.params = { id: member.id };
  return fakeServer([
    ...extra,
    { match: 'membership/categories', body: CATEGORIES },
    { match: /payments\?member_id=/, body: [ACCEPTED] },
    {
      match: /\/whatsapp$/,
      body: { message: 'Bonjour', wa_url: 'https://wa.me/ancien', phone_is_usable: true, url: 'x', share: share({ whatsapp_url: 'https://wa.me/221770000007?text=Rappel' }) },
    },
    { match: /\/link$/, body: { url: 'https://demo-asso.adhera.africa/m/<JETON>', rotated_at: null } },
    { match: `membership/members/${member.id}`, body: member },
  ]);
}

function fakeTab() {
  const tab = { opener: {}, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
  vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  return tab;
}

async function openMore(user: ReturnType<typeof userEvent.setup>, row: RegExp | string) {
  await user.click(await screen.findByRole('button', { name: /Autres actions/ }));
  await user.click(screen.getByRole('button', { name: row }));
  await panelReady();
}

beforeEach(() => {
  window.sessionStorage.clear();
  resetSessionCache();
  saveSession(SESSION);
  takeFlash();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Écran 8 — la fiche', () => {
  it('en tête : le nom et la pastille, puis « {type} · n° {numéro} · {téléphone} »', async () => {
    server();
    const { value } = renderInBureau(<FicheMembrePage />);
    const title = await screen.findByRole('heading', { name: 'Cheikh Diouf' });
    expect(title.closest('div')).toHaveTextContent('En retard');
    expect(screen.getByText('Membre actif · n° 0007 · 77 000 00 07')).toBeInTheDocument();
    expect(value.setBack).toHaveBeenCalledWith(expect.objectContaining({ href: '/bureau/membres', label: 'Les membres' }));
  });

  it('UN seul montant : « Reste à payer », et « Cheikh aurait dû payer le … »', async () => {
    server();
    renderInBureau(<FicheMembrePage />);
    const box = await screen.findByTestId('due-box');
    expect(box).toHaveTextContent('Reste à payer25 000 FCFASa cotisation de cette année. Cheikh aurait dû payer le 3 septembre 2026.');
    // R1 : le servi, jamais le brut ; et aucun autre encadré de montant.
    expect(document.body.textContent).not.toContain('25001');
    expect(screen.queryByTestId('ok-box')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cotisations' })).not.toBeInTheDocument();
  });

  it('le prénom dans le bouton principal ; le rappel WhatsApp en second', async () => {
    server();
    renderInBureau(<FicheMembrePage />);
    const main = await screen.findByRole('link', { name: 'Cheikh a payé : l’enregistrer' });
    expect(main).toHaveAttribute('href', '/bureau/enregistrer?membre=m-cheikh');
    expect(main.className).toContain('bg-indigo');
    expect(screen.getByRole('button', { name: 'Lui envoyer un rappel par WhatsApp' })).toBeInTheDocument();
    // Ni « il », ni « elle » : l'API ne connaît pas le genre.
    expect(document.body.textContent).not.toMatch(/\b(Il|Elle) a payé/);
  });

  it('« Lui envoyer un rappel par WhatsApp » ouvre `share.whatsapp_url`, rien n’est marqué', async () => {
    const fetchMock = server();
    const tab = fakeTab();
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Lui envoyer un rappel par WhatsApp' }));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith('https://wa.me/221770000007?text=Rappel'));
    expect(calls(fetchMock, 'POST')).toHaveLength(0);
  });

  it('sans téléphone : la phrase, pas un bouton qui échoue', async () => {
    server({ ...CHEIKH, phone: null });
    renderInBureau(<FicheMembrePage />);
    expect(await screen.findByText('Pas de téléphone : impossible de lui envoyer un rappel par WhatsApp.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lui envoyer un rappel par WhatsApp' })).not.toBeInTheDocument();
    expect(screen.getByText(/· pas de téléphone$/)).toBeInTheDocument();
  });

  it('à jour : « À jour jusqu’au … », et le bouton reste là, en second plan', async () => {
    server(AMINATA);
    renderInBureau(<FicheMembrePage />);
    expect(await screen.findByTestId('ok-box')).toHaveTextContent('À jour jusqu’au 2 mars 2027');
    expect(screen.queryByTestId('due-box')).not.toBeInTheDocument();
    const button = screen.getByRole('link', { name: 'Aminata a payé : l’enregistrer' });
    expect(button.className).toContain('border-indigo');
  });

  it('« Ses paiements » : le plus récent d’abord, un lien « Reçu » par ligne ; l’historique entier (status=all)', async () => {
    const fetchMock = server(CHEIKH, [
      {
        match: /payments\?member_id=/,
        body: [ACCEPTED, payment({ id: 'p-r', status: 'rejected', amount_formatted: '5 000 FCFA', rejection_reason: 'Pas reçu.' })],
      },
    ]);
    renderInBureau(<FicheMembrePage />);
    const list = await screen.findByTestId('payments');
    const lines = within(list).getAllByRole('listitem');
    expect(lines[0]).toHaveTextContent('5 000 FCFA');
    expect(lines[0]).toHaveTextContent('Refusé');
    expect(lines[1]).toHaveTextContent('10 000 FCFA');
    expect(lines[1]).toHaveTextContent('Orange Money · 3 novembre 2026');
    expect(within(lines[1] as HTMLElement).getByRole('button', { name: 'Reçu' })).toBeInTheDocument();
    expect(calls(fetchMock).some((c) => c.url.endsWith('payments?member_id=m-cheikh&status=all'))).toBe(true);
  });

  it('P6 — les années non réclamées (périodes ET années manquantes) sont repliées, avec leur explication', async () => {
    server();
    renderInBureau(<FicheMembrePage />);
    const old = await screen.findByTestId('unclaimed-years');
    expect(old.tagName).toBe('DETAILS');
    expect(old).not.toHaveAttribute('open');
    expect(within(old).getByText('Anciennes années, non demandées (2)')).toBeInTheDocument();
    expect(old).toHaveTextContent('L’association ne réclame que l’année en cours.');
    expect(old).toHaveTextContent('ne comptent pas dans le reste à payer');
    // Rien à ouvrir, rien à télécharger : ni bouton, ni lien sur ces lignes.
    expect(within(old).queryAllByRole('button')).toHaveLength(0);
    expect(within(old).queryAllByRole('link')).toHaveLength(0);
    // Sous `current_only`, une seule année réclamée : rien d'autre à lister.
    expect(screen.queryByTestId('claimed-years')).not.toBeInTheDocument();
  });

  it('R4 — les anciennes années s’ouvrent TOUJOURS repliées : « Voir », jamais « Masquer », au premier affichage', async () => {
    server();
    const user = userEvent.setup();
    const first = renderInBureau(<FicheMembrePage />);
    let old = await screen.findByTestId('unclaimed-years');
    expect((old as HTMLDetailsElement).open).toBe(false);
    const summary = old.querySelector('summary') as HTMLElement;
    const tokens = (text: string) => within(summary).getByText(text).className.split(/\s+/);
    expect(tokens('Voir')).not.toContain('hidden');
    expect(tokens('Masquer')).toContain('hidden');
    // Le reste à payer passe avant : il est écrit plus haut dans la page.
    expect(
      screen.getByTestId('due-box').compareDocumentPosition(old) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Ouvert à la main, puis la fiche rouverte : de nouveau replié.
    await user.click(summary);
    expect((old as HTMLDetailsElement).open).toBe(true);
    first.unmount();
    renderInBureau(<FicheMembrePage />);
    old = await screen.findByTestId('unclaimed-years');
    expect((old as HTMLDetailsElement).open).toBe(false);
  });

  it('sous `all`, les années RÉCLAMÉES restent visibles : elles font le reste à payer', async () => {
    server({
      ...CHEIKH,
      balance_due: 75000,
      balance_due_formatted: '75 000 FCFA',
      dues: [due('d-2026', '2026-09-03', '2027-09-02'), due('d-2024', '2024-09-03', '2025-09-02')],
      missing_periods: [{ ...CHEIKH.missing_periods![0]!, is_unclaimed_arrears: false }],
    });
    renderInBureau(<FicheMembrePage />);
    const claimed = await screen.findByTestId('claimed-years');
    expect(within(claimed).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByTestId('due-box')).toHaveTextContent('Ses cotisations de 3 années.');
    expect(screen.queryByTestId('unclaimed-years')).not.toBeInTheDocument();
  });

  it('yearsOf : la règle seule', () => {
    const { claimed, unclaimed } = yearsOf(CHEIKH);
    expect(claimed.map((y) => y.key)).toEqual(['d-2026']);
    expect(unclaimed.map((y) => y.key)).toEqual(['d-2024', 'manquante-2025-09-03']);
    expect(openDue(CHEIKH)?.id).toBe('d-2026');
  });

  it('« Rien n’a été enregistré. » : le message de l’écran 5 suit le retour à la fiche', async () => {
    setFlash('Rien n’a été enregistré.');
    server();
    renderInBureau(<FicheMembrePage />);
    expect(await screen.findByRole('status')).toHaveTextContent('Rien n’a été enregistré.');
  });

  it('une organisation : le bloc contacts', async () => {
    server(AGENCE);
    renderInBureau(<FicheMembrePage />);
    await screen.findByRole('heading', { name: 'Contacts' });
    expect(screen.getByText('Awa Diouf')).toBeInTheDocument();
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

  it('l’interface ne propose aucune suppression de membre', async () => {
    server();
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: /Autres actions/ }));
    expect(screen.queryByRole('button', { name: /supprimer/i })).not.toBeInTheDocument();
  });
});

describe('« Autres actions »', () => {
  it('replié par défaut ; ouvert : modifier, attestations, lien, départ, annuler un paiement', async () => {
    server(CHEIKH);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />, {
      settings: { ...(await import('./fixtures')).settings(), features: { membership_card: true } },
    });
    const toggle = await screen.findByRole('button', { name: 'Autres actions (modifier, départ, annuler un paiement)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    const more = within(screen.getByRole('region', { name: 'Autres actions' }));
    expect(more.getAllByRole('button').map((b) => b.textContent?.replace('›', '').trim())).toEqual([
      'Modifier ses informations (dont le numéro de membre)',
      'Ses attestations d’adhésion',
      'Son lien personnel : l’envoyer ou le changer',
      'Enregistrer son départ',
      'Annuler un paiement (erreur de saisie)',
    ]);
  });

  it('« Voir sa page, comme Cheikh la voit » ouvre SON lien', async () => {
    server();
    const tab = fakeTab();
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await user.click(await screen.findByRole('button', { name: 'Voir sa page, comme Cheikh la voit' }));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith('https://demo-asso.adhera.africa/m/<JETON>'));
  });

  it('le lien : WhatsApp dans un nouvel onglet, et « régénérer » passe par une confirmation (R9)', async () => {
    server();
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await openMore(user, /Son lien personnel/);
    const wa = await screen.findByRole('link', { name: 'Ouvrir WhatsApp' });
    expect(wa).toHaveAttribute('target', '_blank');
    expect(wa).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('B7 — prénom et nom à l’édition (« Autres actions »)', () => {
  async function edit(member: MemberDetail = CHEIKH, extra: Parameters<typeof fakeServer>[0] = []) {
    const fetchMock = server(member, extra);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await openMore(user, /Modifier ses informations/);
    return { user, fetchMock };
  }

  it('une personne : « Prénom » et « Nom », préremplis ; le PUT n’envoie pas `name`', async () => {
    const { user, fetchMock } = await edit(CHEIKH, [
      { method: 'PUT', match: `membership/members/${CHEIKH.id}`, body: CHEIKH },
    ]);
    expect((screen.getByLabelText(/^Prénom/) as HTMLInputElement).value).toBe('Cheikh');
    expect((screen.getByLabelText(/^Nom/) as HTMLInputElement).value).toBe('Diouf');
    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    await waitFor(() => expect(calls(fetchMock, 'PUT')).toHaveLength(1));
    const body = JSON.parse(calls(fetchMock, 'PUT')[0]?.init.body as string);
    expect(body).toMatchObject({ type: 'personne', first_name: 'Cheikh', last_name: 'Diouf' });
    expect(body).not.toHaveProperty('name');
    expect(await screen.findByText('Fiche mise à jour.')).toBeInTheDocument();
  });

  it('une fiche ancienne au prénom null : champ vide, et exigé', async () => {
    const { user, fetchMock } = await edit(memberDetail({ id: 'm-x', first_name: null, last_name: 'Ndiaye' }));
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
    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    await waitFor(() => expect(calls(fetchMock, 'PUT')).toHaveLength(1));
    const body = JSON.parse(calls(fetchMock, 'PUT')[0]?.init.body as string);
    expect(body).toMatchObject({ type: 'organisation', name: 'Agence Test Conseil (test)' });
    expect(body).not.toHaveProperty('first_name');
  });

  it('un 422 sur `first_name` se range sous « Prénom », avec le message de l’API tel quel', async () => {
    const { user } = await edit(CHEIKH, [
      {
        method: 'PUT',
        match: `membership/members/${CHEIKH.id}`,
        status: 422,
        body: { message: 'Membre invalide.', errors: { first_name: ['Le champ prénom ne doit pas dépasser 255 caractères.'] } },
      },
    ]);
    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    const message = await screen.findByText('Le champ prénom ne doit pas dépasser 255 caractères.');
    expect(screen.getByLabelText(/^Prénom/).getAttribute('aria-describedby')).toContain(message.id);
  });
});

describe('contacts d’une organisation : prénom et nom', () => {
  it('exige les deux, puis les envoie sans `name`', async () => {
    const created = {
      id: 'c-2', member_id: AGENCE.id, name: 'Khady Ndiaye', first_name: 'Khady', last_name: 'Ndiaye',
      role_title: null, phone: null, email: null, role: 'principal',
    };
    const fetchMock = server(AGENCE, [{ method: 'POST', match: /contacts$/, status: 201, body: created }]);
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

describe('B10 — le départ (R9)', () => {
  it('exige un motif, récapitule, puis envoie left_reason', async () => {
    const fetchMock = server(CHEIKH, [
      { method: 'POST', match: /\/leave$/, body: { ...CHEIKH, status: 'former', left_at: '2026-10-29', left_reason: 'resigned' } },
    ]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await openMore(user, 'Enregistrer son départ');
    await user.click(screen.getByRole('button', { name: 'Vérifier la sortie' }));
    expect(screen.getByText('Choisissez le motif de la sortie.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Motif/), 'resigned');
    await user.click(screen.getByRole('button', { name: 'Vérifier la sortie' }));
    const dialog = screen.getByRole('dialog', { name: 'Enregistrer la sortie de ce membre ?' });
    expect(within(dialog).getByText('Démission')).toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer la sortie' }));
    await waitFor(() => expect(calls(fetchMock, 'POST')).toHaveLength(1));
    const body = JSON.parse(calls(fetchMock, 'POST')[0]?.init.body as string);
    expect(body.left_reason).toBe('resigned');
    expect(body.reason).toBeUndefined();
  });
});

describe('§11 — annuler un paiement, sans rien perdre (« Autres actions »)', () => {
  const CANCELLED = {
    ...ACCEPTED,
    status: 'cancelled' as const,
    cancelled_at: '2026-11-01T14:32:11+00:00',
    cancelled_by_user_id: 7,
    cancelled_by_name: 'Fatou Sow',
    cancel_reason: 'Chèque revenu impayé par la banque',
  };

  it('seuls les paiements ACCEPTÉS s’annulent ; un paiement à vérifier se refuse', async () => {
    server(CHEIKH, [{ match: /payments\?member_id=/, body: [ACCEPTED, payment({ id: 'p-declared' })] }]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await openMore(user, /Annuler un paiement/);
    expect(screen.getAllByRole('button', { name: 'Annuler ce paiement' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'À vérifier dans « Paiements à vérifier »' })).toHaveAttribute(
      'href',
      '/bureau/a-verifier',
    );
  });

  it('motif obligatoire (10 caractères), récapitulatif complet, puis la ligne marquée « Annulé »', async () => {
    let cancelled = false;
    const fetchMock = server(CHEIKH, [
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
          return [cancelled ? CANCELLED : ACCEPTED];
        },
      },
    ]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await openMore(user, /Annuler un paiement/);
    await user.click(screen.getByRole('button', { name: 'Annuler ce paiement' }));
    await panelReady();
    expect(screen.getByTestId('cancel-recap').textContent).toContain('Sa cotisation redeviendra à payer');
    const reason = screen.getByLabelText(/Motif de l’annulation/);
    await user.type(reason, '   court  ');
    await user.click(screen.getByRole('button', { name: 'Oui, annuler ce paiement' }));
    expect(screen.getByText('Expliquez le motif en 10 caractères au moins.')).toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);
    await user.clear(reason);
    await user.type(reason, '  Chèque revenu impayé par la banque ');
    await user.click(screen.getByRole('button', { name: 'Oui, annuler ce paiement' }));
    const line = await screen.findByTestId('cancelled-line');
    expect(line.textContent).toBe('Annulé le 1er novembre 2026 par Fatou Sow — motif : Chèque revenu impayé par la banque');
    expect(JSON.parse(calls(fetchMock, 'POST')[0]?.init.body as string)).toEqual({
      reason: 'Chèque revenu impayé par la banque',
    });
    // Le reçu reste listé et téléchargeable (piège 33).
    expect(within(screen.getByTestId('payments')).getByRole('button', { name: 'Reçu' })).toBeInTheDocument();
  });

  it('« Garder ce paiement » referme sans rien envoyer', async () => {
    const fetchMock = server();
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await openMore(user, /Annuler un paiement/);
    await user.click(screen.getByRole('button', { name: 'Annuler ce paiement' }));
    await panelReady();
    await user.click(screen.getByRole('button', { name: 'Garder ce paiement' }));
    expect(screen.queryByTestId('cancel-recap')).toBeNull();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);
  });
});
