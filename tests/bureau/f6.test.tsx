/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdhesionEnLignePage, { joinShareText } from '@/app/bureau/adhesion-en-ligne/page';
import DemandesPage, { refusalPreview } from '@/app/bureau/demandes/page';
import { joinLines } from '@/app/bureau/membres/[id]/page';
import AccueilPage from '@/app/bureau/page';
import QuestionPage, { questionBody } from '@/app/bureau/questions/[id]/page';
import QuestionsPage, { moved } from '@/app/bureau/questions/page';
import { changedAnswers } from '@/components/bureau/MemberForm';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import type { MemberAnswer, Question, QuestionLimits } from '@/lib/bureau/types';
import {
  calls,
  CATEGORIES,
  dashboard,
  fakeServer,
  memberDetail,
  memberItem,
  renderInBureau,
  SESSION,
  settings,
  share,
  simple,
} from './fixtures';

const nav = vi.hoisted(() => ({ params: { id: 'nouvelle' } as Record<string, string>, push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => nav.params,
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  usePathname: () => '/bureau/questions',
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
  saveSession(SESSION);
  nav.push.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const body = (fetchMock: ReturnType<typeof vi.fn>, method: string, index = 0) =>
  JSON.parse(calls(fetchMock, method)[index]?.init.body as string) as Record<string, unknown>;

/* ─────────────────────────────── L'accueil ─────────────────────────────── */

describe('F6 § 4 — l’accueil et les demandes (§17.9)', () => {
  it('aucun paiement à vérifier : les demandes prennent l’encadré principal', async () => {
    fakeServer([
      { match: 'membership/dashboard', body: dashboard({ simple: simple({ to_verify_count: 0, applications_to_review_count: 1 }) }) },
    ]);
    renderInBureau(<AccueilPage />);
    const box = await screen.findByTestId('to-review');
    expect(box).toHaveTextContent('1 personne demande à adhérer');
    expect(within(box).getByRole('link', { name: 'Examiner la demande' })).toHaveAttribute('href', '/bureau/demandes');
    expect(screen.queryByTestId('nothing-to-verify')).not.toBeInTheDocument();
  });

  it('des paiements ET des demandes : les paiements d’abord, une ligne pour les demandes', async () => {
    fakeServer([
      { match: 'membership/dashboard', body: dashboard({ simple: simple({ to_verify_count: 2, applications_to_review_count: 2 }) }) },
    ]);
    renderInBureau(<AccueilPage />);
    expect(await screen.findByTestId('to-verify')).toBeInTheDocument();
    expect(screen.queryByTestId('to-review')).not.toBeInTheDocument();
    expect(screen.getByTestId('row-applications')).toHaveTextContent('2 demandes d’adhésion à examiner');
  });

  it('sous « premier paiement » (0 à examiner) : rien', async () => {
    fakeServer([
      { match: 'membership/dashboard', body: dashboard({ simple: simple({ to_verify_count: 0, applications_to_review_count: 0 }) }) },
    ]);
    renderInBureau(<AccueilPage />);
    expect(await screen.findByTestId('nothing-to-verify')).toBeInTheDocument();
    expect(screen.queryByTestId('row-applications')).not.toBeInTheDocument();
  });
});

/* ─────────────────────────── L'examen des demandes ─────────────────────────── */

const ANSWERS: MemberAnswer[] = [
  { question_id: 1, label: 'Spécialité', type: 'choice', value: 'Imagerie médicale', value_label: 'Imagerie médicale', archived: false },
  { question_id: 2, label: 'Structure où vous exercez', type: 'text', value: null, value_label: null, archived: false },
];

const BABACAR = memberItem({
  id: 'm-babacar',
  name: 'Babacar Kane',
  first_name: 'Babacar',
  last_name: 'Kane',
  phone: '77 000 00 22',
  email: 'b.kane@example.test',
  region: 'Thiès',
  status: 'pending',
  category_id: 1,
  category_label: 'Membre actif',
  member_number: null,
  referred_by: { id: 'm-aminata', display_name: 'Aminata D.' },
  possible_duplicate_of: null,
  answers: ANSWERS,
});

const FATOU = memberItem({
  id: 'm-fatou-candidate',
  name: 'Fatou Sarr',
  first_name: 'Fatou',
  last_name: 'Sarr',
  phone: '77 000 00 03',
  status: 'pending',
  category_label: 'Membre actif',
  possible_duplicate_of: 'm-fatou',
  answers: [],
});

const AMINATA = memberDetail({ id: 'm-aminata', name: 'Aminata Diop', member_number: '0001' });
const FATOU_MEMBER = memberDetail({ id: 'm-fatou', name: 'Fatou Sarr', member_number: '0003', phone: '770000003', category_label: 'Membre actif' });

function demandes(extra: Parameters<typeof fakeServer>[0] = [], pending = [BABACAR, FATOU], rejected = [] as ReturnType<typeof memberItem>[]) {
  return fakeServer([
    ...extra,
    { match: /^membership\/members\?status=pending/, body: pending },
    { match: /^membership\/members\?status=rejected/, body: rejected },
    { match: 'membership/categories', body: CATEGORIES },
    { match: 'membership/members/m-aminata', body: AMINATA },
    { match: 'membership/members/m-fatou', body: FATOU_MEMBER },
  ]);
}

describe('F6 § 4 — « Demandes d’adhésion », une à la fois', () => {
  it('la carte : nom, type et tarif, téléphone espacé, région, e-mail, les réponses, l’invitation', async () => {
    demandes();
    renderInBureau(<DemandesPage />);
    const card = await screen.findByTestId('application');
    expect(screen.getByTestId('counter')).toHaveTextContent('Demande 1 sur 2');
    expect(within(card).getByRole('heading', { name: 'Babacar Kane' })).toBeInTheDocument();
    expect(card).toHaveTextContent('demande à adhérer comme Membre actif · 250 000 FCFA par an');
    expect(card).toHaveTextContent('77 000 00 22');
    expect(card).toHaveTextContent('Thiès');
    expect(card).toHaveTextContent('b.kane@example.test');
    // Les réponses : value_label affiché, une question sans réponse reste visible.
    expect(card).toHaveTextContent('Imagerie médicale');
    expect(card).toHaveTextContent('Structure où vous exercezPas de réponse');
    await waitFor(() => expect(card).toHaveTextContent('Invitation deAminata Diop, membre n° 0001'));
    expect(within(card).getByRole('link', { name: 'Appeler' })).toHaveAttribute('href', 'tel:770000022');
    expect(within(card).getByRole('link', { name: /WhatsApp/ }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/221770000022\?text=/);
    expect(screen.getByRole('button', { name: 'Admettre Babacar comme membre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refuser la demande' })).toBeInTheDocument();
  });

  it('le doublon possible : l’alerte, et le lien vers la fiche du membre existant', async () => {
    const user = userEvent.setup();
    demandes();
    renderInBureau(<DemandesPage />);
    await screen.findByTestId('application');
    await user.click(screen.getByRole('button', { name: 'Passer à la demande suivante' }));
    const warn = await screen.findByTestId('duplicate');
    await waitFor(() => expect(warn).toHaveTextContent('Ce numéro est déjà celui de Fatou Sarr, membre n° 0003 (Membre actif). C’est peut-être la même personne.'));
    expect(within(warn).getByRole('link', { name: 'Voir la fiche de Fatou Sarr' })).toHaveAttribute('href', '/bureau/membres/m-fatou');
  });

  it('admettre : « Babacar Kane est membre », puis « Lui souhaiter la bienvenue par WhatsApp » sur le share servi', async () => {
    const user = userEvent.setup();
    const admitted = {
      ...memberDetail({ ...BABACAR, status: 'active', member_number: '0017', balance_due_formatted: '25 000 FCFA' }),
      share: share({ whatsapp_url: 'https://wa.me/221770000022?text=Bienvenue' }),
    };
    const fetchMock = demandes([{ method: 'POST', match: 'membership/members/m-babacar/admit', body: admitted }]);
    renderInBureau(<DemandesPage />);
    await user.click(await screen.findByRole('button', { name: 'Admettre Babacar comme membre' }));
    const done = await screen.findByTestId('admitted');
    expect(within(done).getByRole('heading', { name: 'Babacar Kane est membre' })).toBeInTheDocument();
    expect(done).toHaveTextContent('n° 0017 · Membre actif');
    expect(done).toHaveTextContent('Première cotisation : 25 000 FCFA');
    expect(screen.getByTestId('wa-welcome')).toHaveAttribute('href', 'https://wa.me/221770000022?text=Bienvenue');
    // Aucun corps : l'admission ne porte rien.
    expect(calls(fetchMock, 'POST')[0]?.init.body).toBeUndefined();
  });

  it('admis sans numéro utilisable (share: null) : pas de bouton, une phrase qui le dit', async () => {
    const user = userEvent.setup();
    const admitted = { ...memberDetail({ ...BABACAR, status: 'active' }), share: null };
    demandes([{ method: 'POST', match: 'membership/members/m-babacar/admit', body: admitted }]);
    renderInBureau(<DemandesPage />);
    await user.click(await screen.findByRole('button', { name: 'Admettre Babacar comme membre' }));
    expect(await screen.findByTestId('no-phone')).toHaveTextContent('Babacar n’a pas de numéro WhatsApp utilisable');
    expect(screen.queryByTestId('wa-welcome')).not.toBeInTheDocument();
  });

  it('refuser : 10 caractères au moins, l’aperçu, l’appel conseillé, puis « Refuser sans envoyer de message »', async () => {
    const user = userEvent.setup();
    const refused = { ...memberDetail({ ...BABACAR, status: 'rejected' }), share: share() };
    const fetchMock = demandes([{ method: 'POST', match: 'membership/members/m-babacar/reject-application', body: refused }]);
    renderInBureau(<DemandesPage />);
    await user.click(await screen.findByRole('button', { name: 'Refuser la demande' }));
    expect(screen.getByRole('heading', { name: 'Pourquoi refuser cette demande ?' })).toBeInTheDocument();
    expect(screen.getByText(/C’est un sujet délicat\./).closest('section')).toHaveTextContent('Un appel vaut souvent mieux qu’un message.');
    expect(screen.getByRole('link', { name: 'Appeler Babacar' })).toHaveAttribute('href', 'tel:770000022');
    // Pas de raisons toutes prêtes pour une demande.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('La raison'), 'Non merci');
    await user.click(screen.getByRole('button', { name: 'Refuser sans envoyer de message' }));
    expect(screen.getByText(/en 10 caractères au moins/)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST')).toHaveLength(0);

    await user.clear(screen.getByLabelText('La raison'));
    await user.type(screen.getByLabelText('La raison'), 'Cette association n’accepte que les techniciens en exercice.');
    expect(screen.getByTestId('refusal-preview')).toHaveTextContent(
      'Bonjour Babacar, Cette association n’accepte que les techniciens en exercice.',
    );
    await user.click(screen.getByRole('button', { name: 'Refuser sans envoyer de message' }));
    await waitFor(() => expect(calls(fetchMock, 'POST')).toHaveLength(1));
    expect(body(fetchMock, 'POST')).toEqual({ reason: 'Cette association n’accepte que les techniciens en exercice.' });
    expect(await screen.findByText('Demande refusée. Babacar lira la raison sur sa page.')).toBeInTheDocument();
  });

  it('« Refuser et prévenir par WhatsApp » : l’onglet s’ouvre au clic, puis va sur le share de la réponse', async () => {
    const user = userEvent.setup();
    const tab = { closed: false, opener: {}, location: { replace: vi.fn() }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const refused = { ...memberDetail({ ...BABACAR, status: 'rejected' }), share: share({ whatsapp_url: 'https://wa.me/221770000022?text=refus' }) };
    demandes([{ method: 'POST', match: 'membership/members/m-babacar/reject-application', body: refused }]);
    renderInBureau(<DemandesPage />);
    await user.click(await screen.findByRole('button', { name: 'Refuser la demande' }));
    await user.type(screen.getByLabelText('La raison'), 'Cette association n’accepte que les techniciens.');
    await user.click(screen.getByRole('button', { name: 'Refuser et prévenir par WhatsApp' }));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith('https://wa.me/221770000022?text=refus'));
  });

  it('les demandes refusées : un repli en lecture seule, avec le motif', async () => {
    demandes([], [BABACAR], [
      memberItem({ id: 'm-r', name: 'Ousmane Fall', status: 'rejected', application_rejection_reason: 'Réservé aux techniciens.' }),
    ]);
    renderInBureau(<DemandesPage />);
    const fold = await screen.findByTestId('rejected');
    expect(fold).toHaveTextContent('Demandes refusées (1)');
    expect(fold).toHaveTextContent('Motif : Réservé aux techniciens.');
    expect(within(fold).queryByRole('button')).not.toBeInTheDocument();
  });

  it('sous « premier paiement » : rien à examiner, et le lien vers les candidats qui n’ont pas payé', async () => {
    demandes();
    renderInBureau(<DemandesPage />, { settings: settings({ admission_mode: 'premier_paiement' }) });
    const none = await screen.findByTestId('no-application');
    expect(none).toHaveTextContent('Toute personne qui paie sa première cotisation devient membre');
    expect(within(none).getByRole('link')).toHaveAttribute('href', '/bureau/demandes/en-attente');
  });

  it('l’aperçu du refus suit le share du serveur : « Bonjour », le motif mot pour mot, le lien', () => {
    expect(refusalPreview(BABACAR, '  Réservé aux techniciens.  ')).toBe(
      'Bonjour Babacar,\nRéservé aux techniciens.\nVotre page : (le lien de sa page)',
    );
  });
});

/* ───────────────────────────── La fiche (§20.8) ───────────────────────────── */

describe('F6 § 4 — la fiche : qui a décidé, l’invitation', () => {
  it('« Admis le … par … », la date seule sans auteur, jamais « inconnu »', () => {
    const at = '2026-11-04T09:12:33+00:00';
    expect(joinLines(memberDetail({ application_decision: { decision: 'admitted', by_name: 'Aïssatou Ndiaye', at } }))).toEqual([
      'Admis le 4 novembre 2026 par Aïssatou Ndiaye',
    ]);
    expect(joinLines(memberDetail({ application_decision: { decision: 'admitted', by_name: null, at } }))).toEqual([
      'Admis le 4 novembre 2026',
    ]);
    // `decision: null` : la trace reste, l'étiquette ne prétend rien.
    expect(joinLines(memberDetail({ application_decision: { decision: null, by_name: 'X', at } }))).toEqual([]);
    expect(
      joinLines(
        memberDetail({
          referred_by: { id: 'm-a', display_name: 'Aminata D.' },
          referrals_count: { joined: 3, pending: 1 },
        }),
      ),
    ).toEqual(['Invitation de Aminata D. · A fait venir 3 personnes']);
  });
});

/* ─────────────────────────── L'adhésion en ligne ─────────────────────────── */

describe('F6 § 5 — « L’adhésion en ligne »', () => {
  const OPEN = settings({ features: { membership_card: true, membership_join: true }, admission_mode: 'bureau', short_name: 'ATSARS' });

  it('le lien à partager, « Qui devient membre ? » et ses deux choix, le conseil', async () => {
    renderInBureau(<AdhesionEnLignePage />, { settings: OPEN });
    const link = await screen.findByTestId('join-link');
    const share = within(link).getByRole('link', { name: 'Partager le lien sur WhatsApp' });
    expect(new URL(share.getAttribute('href') as string).searchParams.get('text')).toContain(
      'https://demo-asso.adhera.africa/adherer',
    );
    expect(within(link).getByRole('link', { name: 'Voir la page, comme un visiteur la voit' })).toHaveAttribute('href', '/adherer');
    expect(screen.getByRole('radio', { name: /Le bureau examine chaque demande/ })).toBeChecked();
    expect(screen.getByText(/C’est le réglage conseillé\./)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Toute personne qui paie sa première cotisation/ })).not.toBeChecked();
  });

  it('fonctionnalité éteinte : une phrase, et AUCUN lien à partager', () => {
    renderInBureau(<AdhesionEnLignePage />, { settings: settings({ features: { membership_join: false } }) });
    expect(screen.getByTestId('join-closed')).toHaveTextContent('L’adhésion en ligne n’est pas ouverte');
    expect(screen.queryByRole('link', { name: /Partager le lien/ })).not.toBeInTheDocument();
  });

  it('le mode s’enregistre au choix, sans bouton ; la réponse du serveur fait foi', async () => {
    const user = userEvent.setup();
    const next = { ...OPEN, admission_mode: 'premier_paiement' as const };
    const fetchMock = fakeServer([{ method: 'PUT', match: 'membership/settings', body: next }]);
    const { value } = renderInBureau(<AdhesionEnLignePage />, { settings: OPEN });
    await user.click(screen.getByRole('radio', { name: /Toute personne qui paie/ }));
    await waitFor(() => expect(value.setSettings).toHaveBeenCalledWith(next));
    expect(body(fetchMock, 'PUT')).toEqual({ admission_mode: 'premier_paiement' });
  });

  it('le formulaire : l’e-mail en trois choix, la région, le mot d’accueil (vide → null)', async () => {
    const user = userEvent.setup();
    const fetchMock = fakeServer([{ method: 'PUT', match: 'membership/settings', body: OPEN }]);
    renderInBureau(<AdhesionEnLignePage />, { settings: { ...OPEN, join_intro: 'Bienvenue.' } });
    await user.click(screen.getByRole('radio', { name: 'Obligatoire' }));
    await waitFor(() => expect(body(fetchMock, 'PUT', 0)).toEqual({ join_email_mode: 'required' }));
    await user.click(screen.getByRole('checkbox', { name: 'Demander la région' }));
    await waitFor(() => expect(body(fetchMock, 'PUT', 1)).toEqual({ join_ask_region: false }));
    expect(screen.getByText(/10 \/ 300/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Le mot d’accueil/));
    await user.click(screen.getByRole('button', { name: 'Enregistrer le mot d’accueil' }));
    await waitFor(() => expect(body(fetchMock, 'PUT', 2)).toEqual({ join_intro: null }));
  });

  it('le message du bureau : le sigle et le nom, puis le lien', () => {
    expect(joinShareText(OPEN, 'https://demo-asso.adhera.africa/adherer')).toBe(
      'Vous voulez adhérer à ATSARS (Association Démo) ? Remplissez votre demande ici, en deux minutes :\nhttps://demo-asso.adhera.africa/adherer',
    );
  });
});

/* ───────────────────────── Les questions (§20.1 à §20.3) ───────────────────────── */

const LIMITS: QuestionLimits = {
  max_active: 6,
  max_on_card: 2,
  card_types: ['text', 'choice'],
  types: ['text', 'choice', 'yes_no', 'date'],
  options_min: 2,
  options_max: 20,
};

function question(overrides: Partial<Question> & { id: number }): Question {
  return {
    label: `Question ${overrides.id}`,
    type: 'text',
    options: [],
    required: false,
    on_card: false,
    position: overrides.id,
    archived: false,
    has_answers: false,
    ...overrides,
  };
}

const SPECIALITE = question({ id: 1, label: 'Spécialité', type: 'choice', options: ['Anesthésie-réanimation', 'Imagerie médicale'], required: true, on_card: true, position: 0, has_answers: true });
const STRUCTURE = question({ id: 2, label: 'Structure où vous exercez', on_card: true, position: 1, has_answers: true });
const RETIREE = question({ id: 3, label: 'Ancienne question', archived: true, has_answers: true, position: 2 });

describe('F6 § 5 — « Les questions de l’association »', () => {
  it('la liste dans l’ordre, avec sa sorte, « obligatoire », « figure sur la carte » ; les retirées dans un repli', async () => {
    fakeServer([{ match: 'membership/questions', body: { questions: [SPECIALITE, STRUCTURE, RETIREE], limits: LIMITS } }]);
    renderInBureau(<QuestionsPage />);
    const list = await screen.findByTestId('questions');
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('SpécialitéListe de choix · obligatoire · figure sur la carte'),
      expect.stringContaining('Structure où vous exercezTexte · figure sur la carte'),
    ]);
    expect(screen.getByTestId('archived')).toHaveTextContent('Questions retirées (1)');
    expect(screen.getByRole('button', { name: 'Monter « Spécialité »' })).toBeDisabled();
    expect(screen.getByTestId('import-sentence')).toHaveTextContent('un import ne les relit pas');
  });

  it('monter / descendre : `PUT questions/order` avec les identifiants, la réponse fait foi', async () => {
    const user = userEvent.setup();
    const fetchMock = fakeServer([
      { method: 'PUT', match: 'membership/questions/order', body: { questions: [{ ...STRUCTURE, position: 0 }, { ...SPECIALITE, position: 1 }] } },
      { match: 'membership/questions', body: { questions: [SPECIALITE, STRUCTURE], limits: LIMITS } },
    ]);
    renderInBureau(<QuestionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Descendre « Spécialité »' }));
    await waitFor(() => expect(body(fetchMock, 'PUT')).toEqual({ ids: [2, 1] }));
    const rows = within(screen.getByTestId('questions')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Structure où vous exercez');
    expect(moved([1, 2, 3], 0, -1)).toBeNull();
    expect(moved([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
  });

  it('« Ajouter une question » grisé à `limits.max_active`, avec la phrase qui dit pourquoi', async () => {
    const six = Array.from({ length: 6 }, (_, i) => question({ id: i + 1, position: i }));
    fakeServer([{ match: 'membership/questions', body: { questions: six, limits: LIMITS } }]);
    renderInBureau(<QuestionsPage />);
    const add = await screen.findByRole('button', { name: 'Ajouter une question' });
    expect(add).toBeDisabled();
    expect(screen.getByText(/porte déjà 6 questions, et c’est le maximum/)).toBeInTheDocument();
    cleanup();
    // La borne est SERVIE : à 4, quatre questions suffisent à griser.
    fakeServer([{ match: 'membership/questions', body: { questions: six.slice(0, 4), limits: { ...LIMITS, max_active: 4 } } }]);
    renderInBureau(<QuestionsPage />);
    expect(await screen.findByRole('button', { name: 'Ajouter une question' })).toBeDisabled();
  });
});

describe('F6 § 5 — l’écran d’une question', () => {
  it('une nouvelle question : quatre sortes, les réponses possibles pour une liste, POST', async () => {
    const user = userEvent.setup();
    nav.params = { id: 'nouvelle' };
    const fetchMock = fakeServer([
      { method: 'POST', match: 'membership/questions', status: 201, body: question({ id: 9, label: 'Genre' }) },
      { match: 'membership/questions', body: { questions: [SPECIALITE], limits: LIMITS } },
    ]);
    renderInBureau(<QuestionPage />);
    await user.type(await screen.findByLabelText('La question'), 'Genre');
    for (const sort of ['Texte', 'Liste de choix', 'Oui / Non', 'Date']) {
      expect(screen.getByRole('radio', { name: new RegExp(sort.replace('/', '\\/')) })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('radio', { name: /Liste de choix/ }));
    // Deux réponses possibles au départ (`options_min`), et on ne peut pas descendre sous la borne.
    expect(screen.getAllByLabelText(/^Réponse possible n°/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Retirer la réponse possible n° 1' })).toBeDisabled();
    await user.type(screen.getByLabelText('Réponse possible n° 1'), 'Femme');
    await user.type(screen.getByLabelText('Réponse possible n° 2'), 'Homme');
    await user.click(screen.getByRole('checkbox', { name: /Obligatoire/ }));
    await user.click(screen.getByRole('button', { name: 'Ajouter la question' }));
    await waitFor(() =>
      expect(body(fetchMock, 'POST')).toEqual({ label: 'Genre', type: 'choice', options: ['Femme', 'Homme'], required: true, on_card: false }),
    );
    expect(nav.push).toHaveBeenCalledWith('/bureau/questions');
  });

  it('une question répondue : la sorte est verrouillée, le bouton dit « Retirer du formulaire »', async () => {
    const user = userEvent.setup();
    nav.params = { id: '1' };
    const fetchMock = fakeServer([
      { method: 'POST', match: 'membership/questions/1/archive', body: { ...SPECIALITE, archived: true } },
      { match: 'membership/questions', body: { questions: [SPECIALITE, STRUCTURE], limits: LIMITS } },
    ]);
    renderInBureau(<QuestionPage />);
    expect(await screen.findByRole('radio', { name: /Liste de choix/ })).toBeDisabled();
    expect(screen.getByText(/la sorte de cette question ne peut plus changer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retirer du formulaire' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('les réponses déjà données restent sur les fiches');
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Retirer du formulaire' }));
    await waitFor(() => expect(calls(fetchMock, 'POST')[0]?.url).toContain('membership/questions/1/archive'));
  });

  it('une question sans réponse : « Supprimer » (DELETE)', async () => {
    const user = userEvent.setup();
    nav.params = { id: '7' };
    const fresh = question({ id: 7, label: 'Promotion' });
    const fetchMock = fakeServer([
      { method: 'DELETE', match: 'membership/questions/7', body: { deleted: true } },
      { match: 'membership/questions', body: { questions: [fresh], limits: LIMITS } },
    ]);
    renderInBureau(<QuestionPage />);
    await user.click(await screen.findByRole('button', { name: 'Supprimer' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(calls(fetchMock, 'DELETE')).toHaveLength(1));
  });

  it('« Figure sur la carte » : proposé pour `card_types` seulement, grisé à `max_on_card`', async () => {
    const user = userEvent.setup();
    nav.params = { id: 'nouvelle' };
    fakeServer([{ match: 'membership/questions', body: { questions: [SPECIALITE, STRUCTURE], limits: LIMITS } }]);
    renderInBureau(<QuestionPage />);
    const onCard = await screen.findByRole('checkbox', { name: /Figure sur la carte/ });
    expect(onCard).toBeDisabled();
    expect(screen.getByText(/2 questions figurent déjà sur la carte/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Oui \/ Non/ }));
    expect(screen.queryByRole('checkbox', { name: /Figure sur la carte/ })).not.toBeInTheDocument();
  });

  it('le corps : `options` pour une liste seulement, la sorte d’une question répondue ne part pas', () => {
    const draft = { label: ' Spécialité ', type: 'choice' as const, options: [' A ', 'B'], required: true, onCard: true };
    expect(questionBody(draft, SPECIALITE, LIMITS.card_types)).toEqual({ label: 'Spécialité', required: true, on_card: true, options: ['A', 'B'] });
    expect(questionBody({ ...draft, type: 'date' }, null, LIMITS.card_types)).toEqual({ label: 'Spécialité', required: true, on_card: false, type: 'date' });
  });
});

/* ───────────────────── Les réponses dans la saisie du bureau ───────────────────── */

describe('F6 § 5 — les réponses dans « Modifier ses informations » (§20.6)', () => {
  const questions = [SPECIALITE, STRUCTURE, question({ id: 4, label: 'Retraite', type: 'yes_no' })];

  it('le PUT remplace PAR QUESTION : seulement ce qui a changé, `""` pour effacer', () => {
    const initial = { '1': 'Imagerie médicale', '2': 'Hôpital Principal', '4': '' };
    expect(changedAnswers(questions, { '1': 'Imagerie médicale', '2': '', '4': true }, initial, false)).toEqual({ '2': '', '4': true });
    expect(changedAnswers(questions, initial, initial, false)).toEqual({});
  });

  it('à la création : seulement les réponses données, aucune obligatoire', () => {
    expect(changedAnswers(questions, { '1': 'Laboratoire', '2': '  ' }, {}, true)).toEqual({ '1': 'Laboratoire' });
    expect(changedAnswers(questions, {}, {}, true)).toEqual({});
  });
});
