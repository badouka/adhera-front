/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau" }
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnexionPage from '@/app/bureau/connexion/page';
import ChiffresPage from '@/app/bureau/chiffres/page';
import DemandesPage from '@/app/bureau/demandes/page';
import EnregistrerPage from '@/app/bureau/enregistrer/page';
import FicheMembrePage, { dueSentence } from '@/app/bureau/membres/[id]/page';
import MembresPage from '@/app/bureau/membres/page';
import AccueilPage from '@/app/bureau/page';
import ReglagesPage from '@/app/bureau/reglages/page';
import TypesDeMembresPage from '@/app/bureau/types-de-membres/page';
import { AnswersList } from '@/components/bureau/Answers';
import { standingDetail } from '@/components/bureau/Standing';
import { BureauFrame } from '@/components/bureau/BureauFrame';
import { listCategories } from '@/lib/bureau/api/categories';
import { navigation, resetSessionCache, saveSession } from '@/lib/bureau/session';
import type { Category, MemberAnswer } from '@/lib/bureau/types';
import {
  calls,
  CATEGORIES,
  dashboard,
  fakeServer,
  memberDetail,
  memberItem,
  ME,
  payment,
  simple,
  TOO_MANY_ATTEMPTS,
  renderInBureau,
  SESSION,
  settings,
} from './fixtures';

const nav = vi.hoisted(() => ({
  pathname: '/bureau',
  params: {} as Record<string, string>,
  router: { push: vi.fn(), replace: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => nav.router,
  useParams: () => nav.params,
}));

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
  nav.pathname = '/bureau';
  nav.router.replace.mockReset();
  vi.spyOn(navigation, 'replace').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const body = (fetchMock: ReturnType<typeof vi.fn>, method: string, index = 0) =>
  JSON.parse(calls(fetchMock, method)[index]?.init.body as string) as Record<string, unknown>;

/* ───────────────────────────── § 1 — la recette ───────────────────────────── */

describe('P2 — « Demandes d’adhésion » s’ouvre depuis « Plus » avec « < Plus »', () => {
  const CANDIDATE = memberItem({ id: 'm-awa', name: 'Awa Gueye', first_name: 'Awa', status: 'pending', answers: [] });

  it('la barre de retour, comme les onze autres écrans de « Plus »', async () => {
    saveSession(SESSION);
    fakeServer([
      { match: /^membership\/members\?status=pending/, body: [CANDIDATE] },
      { match: /^membership\/members\?status=rejected/, body: [] },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    const { value } = renderInBureau(<DemandesPage />);
    await screen.findByTestId('application');
    expect(value.setBack).toHaveBeenLastCalledWith({ href: '/bureau/plus', label: 'Plus', onClick: undefined });
  });

  it('pendant un refus, « Retour » revient à la demande', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    fakeServer([
      { match: /^membership\/members\?status=pending/, body: [CANDIDATE] },
      { match: /^membership\/members\?status=rejected/, body: [] },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    const { value } = renderInBureau(<DemandesPage />);
    await user.click(await screen.findByRole('button', { name: 'Refuser la demande' }));
    await screen.findByTestId('refuse-application');
    expect(value.setBack).toHaveBeenLastCalledWith(
      expect.objectContaining({ href: '/bureau/demandes', label: 'Retour' }),
    );
  });

  it('en 390 px, la barre de retour remplace la barre du bas', async () => {
    saveSession(SESSION);
    nav.pathname = '/bureau/demandes';
    fakeServer([
      { match: 'membership/settings', body: settings() },
      { match: /^me$/, body: ME },
      { match: 'membership/payments', body: [] },
      { match: /^membership\/members\?status=pending/, body: [CANDIDATE] },
      { match: /^membership\/members\?status=rejected/, body: [] },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    render(
      <BureauFrame>
        <DemandesPage />
      </BureauFrame>,
    );
    await screen.findByTestId('application');
    // Hors de la barre latérale de l'ordinateur : la barre de retour, et elle seule.
    const back = screen.getAllByRole('link', { name: 'Plus' }).filter((link) => !link.closest('aside'));
    expect(back).toHaveLength(1);
    expect(back[0]).toHaveAttribute('href', '/bureau/plus');
    expect(screen.queryByRole('navigation', { name: 'Navigation' })).not.toBeInTheDocument();
  });
});

describe('P4 — « Proposé sur la page « Adhérer » » se lit, et ne part que s’il a été touché', () => {
  const PUBLIC: Category[] = [
    { ...CATEGORIES[2]!, is_public: true },
    { ...CATEGORIES[1]!, is_public: false },
  ];

  it('dans la liste, l’état positif aussi', async () => {
    saveSession(SESSION);
    fakeServer([{ match: 'membership/categories', body: PUBLIC }]);
    renderInBureau(<TypesDeMembresPage />);
    const actif = (await screen.findByText('Membre actif')).closest('li') as HTMLElement;
    expect(within(actif).getByTestId('category-public')).toHaveTextContent('Proposé sur la page « Adhérer »');
    const honoraire = screen.getByText('Honoraire').closest('li') as HTMLElement;
    expect(honoraire).toHaveTextContent('Non proposé sur la page « Adhérer »');
  });

  it('modifier un type sans toucher la case : `is_public` ne part pas, la valeur en base reste', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    const fetchMock = fakeServer([
      { method: 'PUT', match: 'membership/categories/1', body: { ...PUBLIC[0], label: 'Membre titulaire' } },
      { match: 'membership/categories', body: PUBLIC },
    ]);
    renderInBureau(<TypesDeMembresPage />);
    const actif = (await screen.findByText('Membre actif')).closest('li') as HTMLElement;
    await user.click(within(actif).getByRole('button', { name: 'Modifier' }));
    const name = screen.getByLabelText(/^Nom \*$/);
    await user.clear(name);
    await user.type(name, 'Membre titulaire');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce type de membre' }));
    await screen.findByText('« Membre titulaire » est modifiée.');
    expect(body(fetchMock, 'PUT')).not.toHaveProperty('is_public');
  });

  it('la case touchée : `is_public` part, tel qu’affiché', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    const fetchMock = fakeServer([
      { method: 'PUT', match: 'membership/categories/1', body: { ...PUBLIC[0], is_public: false } },
      { match: 'membership/categories', body: PUBLIC },
    ]);
    renderInBureau(<TypesDeMembresPage />);
    const actif = (await screen.findByText('Membre actif')).closest('li') as HTMLElement;
    await user.click(within(actif).getByRole('button', { name: 'Modifier' }));
    await user.click(screen.getByRole('checkbox', { name: /Proposé sur la page « Adhérer »/ }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce type de membre' }));
    await waitFor(() => expect(body(fetchMock, 'PUT')).toMatchObject({ is_public: false }));
  });
});

describe('B11 — la licence échue arrête l’espace du bureau, et dit à qui écrire', () => {
  const REFUSAL = (code: string) => ({
    status: 403,
    body: { code, error_code: code, error: 'Votre licence a expiré.', message: 'Votre licence a expiré. Renouvelez pour réactiver votre espace.' },
  });

  it.each([
    ['license_expired', 'La licence de votre association a expiré. Pour la renouveler, écrivez à Adhera.'],
    ['trial_expired', 'La période d’essai de votre association est terminée. Pour continuer, écrivez à Adhera.'],
    ['tenant_inactive', 'L’espace de votre association est suspendu. Pour en savoir plus, écrivez à Adhera.'],
  ])('au chargement, %s : la phrase décidée, les contacts d’Adhera, jamais « Réessayer »', async (code, text) => {
    saveSession(SESSION);
    fakeServer([{ match: 'membership/settings', ...REFUSAL(code) }]);
    render(<BureauFrame>contenu protégé</BureauFrame>);
    const screenLicence = await screen.findByTestId('licence');
    expect(screenLicence).toHaveTextContent(text);
    // Le message servi n'est pas affiché : il ne dit pas à qui écrire.
    expect(screenLicence).not.toHaveTextContent('Renouvelez pour réactiver votre espace');
    expect(within(screenLicence).getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/221782414064');
    expect(within(screenLicence).getByRole('link', { name: 'contact@adhera.africa' })).toHaveAttribute('href', 'mailto:contact@adhera.africa');
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
    expect(screen.queryByText('contenu protégé')).not.toBeInTheDocument();
  });

  it('un refus reçu par N’IMPORTE QUEL écran, après le chargement, bascule l’espace entier', async () => {
    saveSession(SESSION);
    fakeServer([
      { match: 'membership/settings', body: settings() },
      { match: /^me$/, body: ME },
      { match: 'membership/payments', body: [] },
      { match: 'membership/categories', ...REFUSAL('license_expired') },
    ]);
    function Ecran() {
      return (
        <button type="button" onClick={() => void listCategories().catch(() => undefined)}>
          Charger
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <BureauFrame>
        <Ecran />
      </BureauFrame>,
    );
    await user.click(await screen.findByRole('button', { name: 'Charger' }));
    expect(await screen.findByTestId('licence')).toHaveTextContent('La licence de votre association a expiré.');
  });

  it('contre-épreuve : un autre 403 (role_not_allowed) ne touche pas au cadre', async () => {
    saveSession(SESSION);
    const fetchMock = fakeServer([
      { match: 'membership/settings', body: settings() },
      { match: /^me$/, body: ME },
      { match: 'membership/payments', body: [] },
      { match: 'membership/categories', status: 403, body: { code: 'role_not_allowed', message: 'Non.' } },
    ]);
    const user = userEvent.setup();
    render(
      <BureauFrame>
        <button type="button" onClick={() => void listCategories().catch(() => undefined)}>
          Charger
        </button>
      </BureauFrame>,
    );
    await user.click(await screen.findByRole('button', { name: 'Charger' }));
    await waitFor(() =>
      expect(calls(fetchMock).some((c) => c.url.includes('membership/categories'))).toBe(true),
    );
    expect(screen.queryByTestId('licence')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Charger' })).toBeInTheDocument();
  });

  it('à la connexion : la phrase du code, et les contacts d’Adhera', async () => {
    nav.pathname = '/bureau/connexion';
    const user = userEvent.setup();
    fakeServer([{ method: 'POST', match: 'login', ...REFUSAL('tenant_inactive') }]);
    render(<ConnexionPage />);
    await user.type(await screen.findByLabelText('E-mail'), 'bureau@exemple.sn');
    await user.type(screen.getByLabelText('Mot de passe'), 'ce-qui-est-tapé');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));
    const alert = await screen.findByText('L’espace de votre association est suspendu. Pour en savoir plus, écrivez à Adhera.');
    const box = alert.parentElement as HTMLElement;
    expect(within(box).getByRole('link', { name: 'contact@adhera.africa' })).toBeInTheDocument();
  });
});

describe('« Pas de réponse » ne s’écrit plus sous une question sans réponse', () => {
  it('la question reste listée, rien dessous', () => {
    const answers: MemberAnswer[] = [
      { question_id: 1, label: 'Profession', type: 'text', value: 'Enseignante', value_label: 'Enseignante', archived: false },
      { question_id: 2, label: 'Pièce d’identité', type: 'file', value: null, value_label: null, archived: false },
    ];
    render(<AnswersList answers={answers} />);
    const list = screen.getByTestId('answers');
    expect(list).toHaveTextContent('Pièce d’identité');
    expect(list).not.toHaveTextContent('Pas de réponse');
  });
});

/* ───────────────────────────── § 2 — S8 (§22) ───────────────────────────── */

describe('§22.1 — le rythme de chaque type de membre', () => {
  const MENSUEL: Category = {
    id: 5, label: 'Membre mensuel', mode: 'forfait', amount: 2000, amount_formatted: '2 000 FCFA',
    sort_order: 5, is_active: true, is_public: false, is_calculable: true, period_months: 1, period_label: 'par mois',
  };

  it('le tarif ET le rythme servis, jamais « par an » écrit ici', async () => {
    saveSession(SESSION);
    fakeServer([{ match: 'membership/categories', body: [MENSUEL, { ...CATEGORIES[1]!, period_label: 'par an' }] }]);
    renderInBureau(<TypesDeMembresPage />);
    const row = (await screen.findByText('Membre mensuel')).closest('li') as HTMLElement;
    expect(within(row).getByTestId('category-price')).toHaveTextContent('2 000 FCFA par mois');
    // Un exonéré n'a ni montant ni rythme.
    const honoraire = screen.getByText('Honoraire').closest('li') as HTMLElement;
    expect(within(honoraire).queryByTestId('category-price')).not.toBeInTheDocument();
  });

  it('les durées du serveur, et elles seules ; la création envoie celle choisie', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    const fetchMock = fakeServer([
      { method: 'POST', match: 'membership/categories', status: 201, body: MENSUEL },
      { match: 'membership/categories', body: [] },
      { match: 'membership/settings', body: settings() },
    ]);
    renderInBureau(<TypesDeMembresPage />);
    await user.click(await screen.findByRole('button', { name: 'Ajouter un type de membre' }));
    const select = screen.getByTestId('period-months') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => [o.value, o.text])).toEqual([
      ['1', 'par mois'],
      ['3', 'par trimestre'],
      ['6', 'par semestre'],
      ['12', 'par an'],
      ['24', 'tous les deux ans'],
    ]);
    expect(select.value).toBe('12');
    await user.type(screen.getByLabelText(/^Nom \*$/), 'Membre mensuel');
    await user.type(screen.getByLabelText(/^Montant/), '2000');
    await user.selectOptions(select, '1');
    await user.click(screen.getByRole('button', { name: 'Ajouter ce type de membre' }));
    await screen.findByText('« Membre mensuel » est ajoutée.');
    expect(body(fetchMock, 'POST')).toMatchObject({ period_months: 1 });
  });

  it('modifier sans changer la durée : `period_months` ne part pas', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    const fetchMock = fakeServer([
      { method: 'PUT', match: 'membership/categories/5', body: { ...MENSUEL, label: 'Mensuel' } },
      { match: 'membership/categories', body: [MENSUEL] },
      { match: 'membership/settings', body: settings() },
    ]);
    renderInBureau(<TypesDeMembresPage />);
    await user.click(await screen.findByRole('button', { name: 'Modifier' }));
    const name = screen.getByLabelText(/^Nom \*$/);
    await user.clear(name);
    await user.type(name, 'Mensuel');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce type de membre' }));
    await screen.findByText('« Mensuel » est modifiée.');
    expect(body(fetchMock, 'PUT')).not.toHaveProperty('period_months');
  });

  it('§22.3 — `409 period_months_locked` : le message du serveur, et le champ grisé', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    const LOCKED = 'La durée de ce type de membre ne peut plus changer : des cotisations sont déjà ouvertes sur la grille commune.';
    fakeServer([
      { method: 'PUT', match: 'membership/categories/5', status: 409, body: { code: 'period_months_locked', message: LOCKED } },
      { match: 'membership/categories', body: [MENSUEL] },
    ]);
    renderInBureau(<TypesDeMembresPage />);
    await user.click(await screen.findByRole('button', { name: 'Modifier' }));
    const select = screen.getByTestId('period-months') as HTMLSelectElement;
    await user.selectOptions(select, '3');
    await user.click(screen.getByRole('button', { name: 'Enregistrer ce type de membre' }));
    expect(await screen.findByText(LOCKED)).toBeInTheDocument();
    expect(select).toBeDisabled();
    // La valeur revient à celle en base : on ne laisse pas croire qu'elle a changé.
    expect(select.value).toBe('1');
  });

  it('un exonéré : ni rythme, ni `period_months` envoyé', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    const fetchMock = fakeServer([
      { method: 'POST', match: 'membership/categories', status: 201, body: { ...CATEGORIES[1]!, id: 8, label: 'Membre d’honneur' } },
      { match: 'membership/categories', body: [] },
      { match: 'membership/settings', body: settings() },
    ]);
    renderInBureau(<TypesDeMembresPage />);
    await user.click(await screen.findByRole('button', { name: 'Ajouter un type de membre' }));
    await user.type(screen.getByLabelText(/^Nom \*$/), 'Membre d’honneur');
    await user.selectOptions(screen.getByLabelText(/^Mode de calcul/), 'exonere');
    expect(screen.queryByTestId('period-months')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ajouter ce type de membre' }));
    await screen.findByText('« Membre d’honneur » est ajoutée.');
    expect(body(fetchMock, 'POST')).not.toHaveProperty('period_months');
  });
});

describe('§22.4 — les avertissements des réglages, à chaque rendu', () => {
  const WARNING = {
    code: 'current_only_with_short_periods',
    message: 'Certains de vos types de membre cotisent sur moins d’un an : avec « Repartir de l’année en cours », les périodes manquées ne seront pas réclamées.',
  };

  it('sur « Types de membres », tels que servis ; relus après un enregistrement', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    const fetchMock = fakeServer([
      { method: 'PUT', match: 'membership/categories/1', body: { ...CATEGORIES[2]!, is_active: false } },
      { match: 'membership/categories', body: [CATEGORIES[2]] },
      { match: 'membership/settings', body: settings({ warnings: [] }) },
    ]);
    const { value } = renderInBureau(<TypesDeMembresPage />, { settings: settings({ warnings: [WARNING] }) });
    expect(screen.getByTestId('settings-warnings')).toHaveTextContent(WARNING.message);
    await user.click(await screen.findByRole('button', { name: 'Désactiver' }));
    await waitFor(() => expect(calls(fetchMock).some((c) => c.url.endsWith('membership/settings'))).toBe(true));
    await waitFor(() => expect(value.setSettings).toHaveBeenCalledWith(expect.objectContaining({ warnings: [] })));
  });

  it('aucun avertissement : rien', () => {
    saveSession(SESSION);
    fakeServer([{ match: 'membership/categories', body: [] }]);
    renderInBureau(<TypesDeMembresPage />, { settings: settings({ warnings: [] }) });
    expect(screen.queryByTestId('settings-warnings')).not.toBeInTheDocument();
  });
});

describe('§22.8 — les demandes : le rythme, la date, le premier message du serveur', () => {
  const AWA = memberItem({
    id: 'm-awa',
    name: 'Awa Gueye',
    first_name: 'Awa',
    last_name: 'Gueye',
    phone: '77 000 00 40',
    status: 'pending',
    category_id: 5,
    category_label: 'Membre mensuel',
    answers: [],
    submitted_at: '2026-11-04T10:15:00+00:00',
    share: null,
  });
  const MENSUEL = { ...CATEGORIES[2]!, id: 5, label: 'Membre mensuel', amount_formatted: '2 000 FCFA', period_months: 1, period_label: 'par mois' };

  function serve(pending = [AWA], extra: Parameters<typeof fakeServer>[0] = []) {
    saveSession(SESSION);
    return fakeServer([
      ...extra,
      { match: /^membership\/members\?status=pending/, body: pending },
      { match: /^membership\/members\?status=rejected/, body: [] },
      { match: 'membership/categories', body: [MENSUEL] },
    ]);
  }

  it('« comme Membre mensuel · 2 000 FCFA par mois », et la date de la demande', async () => {
    serve();
    renderInBureau(<DemandesPage />);
    const card = await screen.findByTestId('application');
    expect(card).toHaveTextContent('demande à adhérer comme Membre mensuel · 2 000 FCFA par mois');
    expect(card).toHaveTextContent('Demande du4 novembre 2026');
  });

  it('sans `share` servi : « Appeler » seul, aucun message composé ici', async () => {
    serve();
    renderInBureau(<DemandesPage />);
    const card = await screen.findByTestId('application');
    expect(within(card).getByRole('link', { name: 'Appeler' })).toBeInTheDocument();
    expect(within(card).queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument();
  });

  it('§23.7 — le bandeau de doublon élide : « celui d’Ousmane », « la fiche d’Ousmane »', async () => {
    const OUSMANE = { ...memberItem({ id: 'm-ousmane', name: 'Ousmane Sow', phone: '770000040', member_number: '0004' }), contacts: [], dues: [] };
    serve([{ ...AWA, possible_duplicate_of: 'm-ousmane' }], [{ match: 'membership/members/m-ousmane', body: OUSMANE }]);
    renderInBureau(<DemandesPage />);
    const warn = await screen.findByTestId('duplicate');
    await waitFor(() => expect(warn).toHaveTextContent('Ce numéro est déjà celui d’Ousmane Sow, membre n° 0004'));
    expect(within(warn).getByRole('link', { name: 'Voir la fiche d’Ousmane Sow' })).toBeInTheDocument();
  });
});

describe('§22.8 — la ligne du registre des candidats porte la date de la demande', () => {
  it('« Demande du 4 novembre 2026 » ; sans date servie, « Demande en attente »', () => {
    expect(standingDetail(memberItem({ status: 'pending', submitted_at: '2026-11-04T10:15:00+00:00' }))).toBe(
      'Demande du 4 novembre 2026',
    );
    expect(standingDetail(memberItem({ status: 'pending', submitted_at: null }))).toBe('Demande en attente');
  });
});

/* ───────────────────────────── § 3 — S9 (§23) ───────────────────────────── */

const CAN_ALL = { cancel_payment: true, admit_application: true, delete_photo: true };
const PRESIDENT = { ...ME, role: 'president', role_label: 'Président', can: { ...CAN_ALL, cancel_payment: false } };
const MEMBRE_BUREAU = { ...ME, role: 'membre_bureau', role_label: 'Membre du bureau', can: { cancel_payment: false, admit_application: false, delete_photo: false } };
const TRESORIER = { ...ME, can: CAN_ALL };

describe('§23.2 — les rôles : une action interdite n’apparaît pas', () => {
  const FATOU = memberDetail({
    id: 'm-fatou', name: 'Fatou Sarr', first_name: 'Fatou', last_name: 'Sarr',
    is_up_to_date: true, standing: 'up_to_date', covered_until: '2027-03-01', next_due_date: '2027-03-02',
    balance_due: 0, balance_due_formatted: '0 FCFA', photo_url: 'https://api.eventflow.africa/api/v1/admin/membership/files/photo-signee',
    can_record_payment: true,
  });

  function fiche(me: typeof ME) {
    saveSession(SESSION);
    nav.params = { id: 'm-fatou' };
    fakeServer([
      { match: /^membership\/members\/m-fatou$/, body: FATOU },
      { match: /^membership\/payments/, body: [payment({ member_id: 'm-fatou', status: 'validated', receipt: { id: 'r1', reference: 'REC-1' } })] },
    ]);
    return renderInBureau(<FicheMembrePage />, { me });
  }

  it('le président : pas d’« Annuler un paiement » ; la photo se retire', async () => {
    const user = userEvent.setup();
    fiche(PRESIDENT);
    await user.click(await screen.findByRole('button', { name: 'Autres actions (modifier, départ)' }));
    expect(screen.queryByRole('button', { name: /Annuler un paiement/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sa photo : l’ajouter, la changer ou la retirer/ })).toBeInTheDocument();
  });

  it('le trésorier : « Annuler un paiement » est là', async () => {
    const user = userEvent.setup();
    fiche(TRESORIER);
    await user.click(await screen.findByRole('button', { name: 'Autres actions (modifier, départ, annuler un paiement)' }));
    expect(screen.getByRole('button', { name: /Annuler un paiement/ })).toBeInTheDocument();
  });

  it('un membre du bureau : la photo se DÉPOSE toujours, elle ne se retire pas', async () => {
    const user = userEvent.setup();
    fiche(MEMBRE_BUREAU);
    await user.click(await screen.findByRole('button', { name: 'Autres actions (modifier, départ)' }));
    await user.click(screen.getByRole('button', { name: 'Sa photo : l’ajouter ou la changer' }));
    const panel = await screen.findByTestId('photo-panel');
    expect(within(panel).getByRole('button', { name: 'Enregistrer cette photo' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Retirer la photo' })).not.toBeInTheDocument();
    // Ce qui n'est pas dans la matrice reste ouvert : « … a payé » est là.
    expect(screen.getByRole('link', { name: 'Fatou a payé : l’enregistrer' })).toBeInTheDocument();
  });

  it('les demandes, pour un membre du bureau : ni « Admettre » ni « Refuser », une phrase', async () => {
    saveSession(SESSION);
    fakeServer([
      { match: /^membership\/members\?status=pending/, body: [memberItem({ id: 'm-awa', name: 'Awa Gueye', first_name: 'Awa', status: 'pending', answers: [] })] },
      { match: /^membership\/members\?status=rejected/, body: [] },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    renderInBureau(<DemandesPage />, { me: MEMBRE_BUREAU });
    await screen.findByTestId('application');
    expect(screen.queryByRole('button', { name: /Admettre/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refuser la demande' })).not.toBeInTheDocument();
    expect(screen.getByTestId('cannot-decide')).toHaveTextContent('Votre rôle ne permet pas de décider d’une demande d’adhésion.');
  });

  it('le serveur refuse quand même (`403 role_not_allowed`) : SON message, tel quel', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    const REFUS = 'Seuls le président, le secrétaire et le trésorier peuvent décider d’une candidature.';
    fakeServer([
      { method: 'POST', match: 'membership/members/m-awa/admit', status: 403, body: { code: 'role_not_allowed', message: REFUS } },
      { match: /^membership\/members\?status=pending/, body: [memberItem({ id: 'm-awa', name: 'Awa Gueye', first_name: 'Awa', status: 'pending', answers: [] })] },
      { match: /^membership\/members\?status=rejected/, body: [] },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    // `admin/me` n'a pas encore répondu : rien n'est masqué, le serveur tranche.
    renderInBureau(<DemandesPage />, { me: null });
    await user.click(await screen.findByRole('button', { name: 'Admettre Awa comme membre' }));
    expect(await screen.findByText(REFUS)).toBeInTheDocument();
  });
});

describe('§23.3 — « À payer » et « En retard », partout', () => {
  const LATE = memberItem({ id: 'm-late', name: 'Moussa Ndiaye', first_name: 'Moussa', standing: 'late', is_up_to_date: false, next_due_date: '2026-10-01' });
  const TO_PAY = memberItem({ id: 'm-topay', name: 'Khadidiatou Seck', first_name: 'Khadidiatou', standing: 'to_pay', is_up_to_date: false, next_due_date: '2026-11-20', balance_due: 25000, balance_due_formatted: '25 000 FCFA' });
  const OK = memberItem({ id: 'm-ok', name: 'Fatou Sarr', first_name: 'Fatou', standing: 'up_to_date', is_up_to_date: true, balance_due: 0, balance_due_formatted: '0 FCFA' });

  it('l’accueil : « Reçu dans Adhera en … », et une ligne par population, chacune cliquable sur la sienne', async () => {
    saveSession(SESSION);
    fakeServer([{ match: 'membership/dashboard', body: dashboard({ simple: simple({ late_count: 7, to_pay_count: 1 }) }) }]);
    renderInBureau(<AccueilPage />);
    expect(await screen.findByTestId('tile-received')).toHaveTextContent('Reçu dans Adhera en 2026');
    expect(screen.getByTestId('row-late')).toHaveTextContent('7 membres en retard');
    expect(screen.getByTestId('row-late')).toHaveAttribute('href', '/bureau/membres?filtre=retard');
    expect(screen.getByTestId('row-to-pay')).toHaveTextContent('1 membre à payer');
    expect(screen.getByTestId('row-to-pay')).toHaveAttribute('href', '/bureau/membres?filtre=a-payer');
    // `late_count` a changé de sens : ceux qui doivent sont late + to_pay.
    expect(screen.getByTestId('tile-remaining')).toHaveTextContent('ce que doivent encore les 8 membres en retard ou à payer');
  });

  it('aucun « à payer » : pas de ligne vide', async () => {
    saveSession(SESSION);
    fakeServer([{ match: 'membership/dashboard', body: dashboard({ simple: simple({ late_count: 2, to_pay_count: 0 }) }) }]);
    renderInBureau(<AccueilPage />);
    await screen.findByTestId('row-late');
    expect(screen.queryByTestId('row-to-pay')).not.toBeInTheDocument();
  });

  it('le registre : quatre filtres comptés, et chaque pastille dit sa situation', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/bureau/membres?filtre=tous');
    fakeServer([{ match: /^membership\/members/, body: [LATE, TO_PAY, OK] }]);
    renderInBureau(<MembresPage />);
    const group = await screen.findByRole('group', { name: 'Afficher' });
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Tous · 3' })).toBeInTheDocument());
    expect(within(group).getByRole('button', { name: 'En retard · 1' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'À payer · 1' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'À jour · 1' })).toBeInTheDocument();
    const table = screen.getByTestId('member-table');
    const row = within(table).getByRole('link', { name: 'Khadidiatou Seck' }).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('À payer');
    expect(row).not.toHaveTextContent('En retard');
    await user.click(within(group).getByRole('button', { name: 'À payer · 1' }));
    expect(window.location.search).toBe('?filtre=a-payer');
    expect(within(screen.getByTestId('member-table')).queryByRole('link', { name: 'Moussa Ndiaye' })).not.toBeInTheDocument();
    window.history.replaceState(null, '', '/bureau');
  });

  it('depuis la tuile de l’accueil : « En retard ou à payer », les deux ensemble', async () => {
    saveSession(SESSION);
    window.history.replaceState(null, '', '/bureau/membres?filtre=pas-a-jour');
    fakeServer([{ match: /^membership\/members/, body: [LATE, TO_PAY, OK] }]);
    renderInBureau(<MembresPage />);
    const group = await screen.findByRole('group', { name: 'Afficher' });
    await waitFor(() => expect(within(group).getByRole('button', { name: 'En retard ou à payer · 2' })).toHaveAttribute('aria-pressed', 'true'));
    window.history.replaceState(null, '', '/bureau');
  });

  it('la fiche : « À payer » le jour de l’échéance, « En retard » le lendemain', () => {
    expect(dueSentence('Khadidiatou', 'to_pay', '2999-01-01', '1er janvier 2999')).toBe('Khadidiatou doit payer le 1er janvier 2999.');
    expect(dueSentence('Moussa', 'late', '2026-10-01', '1er octobre 2026')).toBe('Moussa aurait dû payer le 1er octobre 2026.');
  });

  it('la fiche d’un membre à payer : la pastille « À payer », jamais « En retard »', async () => {
    saveSession(SESSION);
    nav.params = { id: 'm-topay' };
    fakeServer([
      { match: /^membership\/members\/m-topay$/, body: { ...memberDetail(), ...TO_PAY } },
      { match: /^membership\/payments/, body: [] },
    ]);
    renderInBureau(<FicheMembrePage />);
    await screen.findByTestId('due-box');
    expect(screen.getByText('À payer')).toBeInTheDocument();
    expect(screen.queryByText('En retard')).not.toBeInTheDocument();
  });

  it('« Chiffres » : « En retard » et « À payer », deux comptes ; le même nombre « à renouveler » que l’accueil', async () => {
    saveSession(SESSION);
    fakeServer([
      {
        match: 'membership/dashboard',
        body: dashboard({ members: { active: 15, up_to_date: 7, not_up_to_date: 8, late: 7, to_pay: 1, pending: 0, former: 0 }, upcoming: { days: 30, count: 2 } }),
      },
    ]);
    renderInBureau(<ChiffresPage />);
    const late = (await screen.findByText('En retard')).parentElement as HTMLElement;
    expect(late).toHaveTextContent('7');
    expect((screen.getByText('À payer').parentElement as HTMLElement)).toHaveTextContent('1');
    expect(screen.getByTestId('upcoming')).toHaveTextContent('2 membres doivent renouveler d’ici 30 jours.');
  });
});

describe('§23.5 — un exonéré : ni échéance, ni « a payé »', () => {
  const HONNEUR = memberDetail({
    id: 'm-honneur', name: 'Mame Diarra Lo', first_name: 'Mame Diarra', last_name: 'Lo', category_label: 'Membre d’honneur',
    is_up_to_date: true, standing: 'up_to_date', covered_until: '2026-12-11', next_due_date: null,
    balance_due: 0, balance_due_formatted: '0 FCFA', dues: [], can_record_payment: false,
  });

  it('la fiche : « À jour » sans date qui expire, et aucun bouton « a payé »', async () => {
    saveSession(SESSION);
    nav.params = { id: 'm-honneur' };
    fakeServer([
      { match: /^membership\/members\/m-honneur$/, body: HONNEUR },
      { match: /^membership\/payments/, body: [] },
    ]);
    renderInBureau(<FicheMembrePage />);
    expect(await screen.findByTestId('ok-line')).toHaveTextContent(/^À jour$/);
    expect(screen.getByTestId('exempt-line')).toHaveTextContent('Son type de membre ne paie pas de cotisation.');
    expect(screen.queryByText(/a payé : l’enregistrer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/jusqu’au 11 décembre 2026/)).not.toBeInTheDocument();
  });

  it('« Un membre a payé », arrivé par son nom : pas de formulaire, une phrase', async () => {
    saveSession(SESSION);
    window.history.replaceState(null, '', '/bureau/enregistrer?membre=m-honneur');
    fakeServer([{ match: /^membership\/members\/m-honneur$/, body: HONNEUR }]);
    renderInBureau(<EnregistrerPage />);
    expect(await screen.findByTestId('cannot-record')).toHaveTextContent(
      'Mame Diarra ne paie pas de cotisation : son type de membre en est exonéré.',
    );
    expect(screen.queryByRole('button', { name: 'Enregistrer ce paiement' })).not.toBeInTheDocument();
    window.history.replaceState(null, '', '/bureau');
  });
});

describe('§23.6 — les coordonnées de l’association, dans « Paramètres »', () => {
  it('elles partent avec les réglages ; vides, elles valent `null`', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    const fetchMock = fakeServer([{ method: 'PUT', match: 'membership/settings', body: settings({ contact_phone: '77 123 45 67' }) }]);
    renderInBureau(<ReglagesPage />, { settings: settings({ contact_phone: null, contact_email: null }) });
    await user.type(screen.getByLabelText(/Téléphone de l’association/), '77 123 45 67');
    await user.click(screen.getByRole('button', { name: 'Enregistrer les réglages' }));
    await screen.findByText('Réglages enregistrés.');
    expect(body(fetchMock, 'PUT')).toMatchObject({ contact_phone: '77 123 45 67', contact_email: null });
  });

  it('un domaine réservé : le message du serveur, sous le champ', async () => {
    saveSession(SESSION);
    const user = userEvent.setup();
    const MESSAGE = 'Cette adresse e-mail utilise un domaine réservé : indiquez une adresse réelle.';
    fakeServer([{ method: 'PUT', match: 'membership/settings', status: 422, body: { message: MESSAGE, errors: { contact_email: [MESSAGE] } } }]);
    renderInBureau(<ReglagesPage />);
    await user.type(screen.getByLabelText(/E-mail de l’association/), 'bureau@amicale.test');
    await user.click(screen.getByRole('button', { name: 'Enregistrer les réglages' }));
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
  });
});

describe('v3.14-M1 — un 429 : seuls le statut et `Retry-After` comptent, jamais le texte', () => {
  it.each([TOO_MANY_ATTEMPTS, { message: 'Too Many Attempts.' }, {}])(
    'le même écran, quel que soit le corps servi (%o)',
    async (served) => {
      nav.pathname = '/bureau/connexion';
      const user = userEvent.setup();
      fakeServer([{ method: 'POST', match: 'login', status: 429, body: served, headers: { 'Retry-After': '170' } }]);
      render(<ConnexionPage />);
      await user.type(await screen.findByLabelText('E-mail'), 'bureau@exemple.sn');
      await user.type(screen.getByLabelText('Mot de passe'), 'ce-qui-est-tapé');
      await user.click(screen.getByRole('button', { name: 'Se connecter' }));
      await screen.findByText('Trop de tentatives. Réessayez dans 3 minutes.');
      expect(screen.queryByText(/Trop de requêtes|Too Many/)).not.toBeInTheDocument();
    },
  );
});
