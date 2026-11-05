/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/adherer" }
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryPrice, JoinPage, MAX_CHOICE_BUTTONS, validateJoin } from '@/app/adherer/JoinPage';
import type { JoinForm } from '@/lib/join';
import { fakeResponse } from './fixtures';

/** La charge de `GET membership/join` (§17.3, §20.4), comme `demo-asso` la sert. */
function form(overrides: Partial<JoinForm> = {}): JoinForm {
  return {
    organisation: { name: 'Association Démo', logo_url: null, icon_url: null },
    admission_mode: 'bureau',
    categories: [
      { id: 25, label: 'Membre actif', amount_formatted: '25 000 FCFA', mode: 'forfait' },
      { id: 26, label: 'Membre associé', amount_formatted: '50 000 FCFA', mode: 'forfait' },
    ],
    referrer: null,
    consent_text:
      'J’accepte que Association Démo utilise ces informations pour gérer mon adhésion et me contacter à ce sujet.',
    intro: null,
    ask_region: true,
    email_mode: 'optional',
    questions: [],
    ...overrides,
  };
}

const SPECIALITE = {
  id: 1,
  label: 'Spécialité',
  type: 'choice',
  options: ['Anesthésie-réanimation', 'Imagerie médicale', 'Laboratoire'],
  required: true,
};
const FONCTION = {
  id: 2,
  label: 'Fonction',
  type: 'choice',
  options: ['Président', 'Secrétaire général', 'Trésorier', 'Membre', 'Délégué', 'Chargé de communication'],
  required: false,
};
const STRUCTURE = { id: 3, label: 'Structure où vous exercez', type: 'text', options: [], required: false };
const RETRAITE = { id: 4, label: 'Êtes-vous à la retraite ?', type: 'yes_no', options: [], required: false };
const PRISE = { id: 5, label: 'Prise de service', type: 'date', options: [], required: false };

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(get: Response, ...posts: Response[]) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET') return get;
    const next = posts.shift();
    if (!next) throw new Error('POST non simulé');
    return next;
  });
}

function posts() {
  return fetchMock.mock.calls
    .filter((c) => (c[1] as RequestInit).method === 'POST')
    .map((c) => ({
      body: JSON.parse((c[1] as RequestInit).body as string) as Record<string, unknown>,
      headers: (c[1] as RequestInit).headers as Record<string, string>,
    }));
}

async function fillIdentity(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /Membre actif/ }));
  await user.type(screen.getByLabelText('2. Votre prénom'), 'Babacar');
  await user.type(screen.getByLabelText('3. Votre nom'), 'Kane');
  await user.type(screen.getByLabelText('4. Votre numéro WhatsApp'), '77 000 00 22');
}

describe('/adherer — la page publique (§17.3, §20.4)', () => {
  it('demande le formulaire au tenant du sous-domaine, sans authentification, avec le parrain', async () => {
    serve(fakeResponse(200, form()));
    render(<JoinPage parrain="K7PQ4RMT" />);
    await screen.findByRole('heading', { name: 'Adhérer à l’association' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.eventflow.africa/api/v1/membership/join?parrain=K7PQ4RMT');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Tenant-Slug']).toBe('demo-asso');
    expect(headers.Authorization).toBeUndefined();
    expect(init.cache).toBe('no-store');
  });

  it('une association fermée (404) et un slug inconnu montrent la MÊME page, sans nom', async () => {
    serve(fakeResponse(404, { message: 'Tenant not found.' }));
    const { container } = render(<JoinPage parrain={null} />);
    await screen.findByRole('heading', { name: 'Cette page n’existe pas' });
    const closed = container.innerHTML;
    cleanup();
    // Un hôte qui n'est pas une association : aucun appel, la même page à l'octet.
    vi.stubGlobal('location', { ...window.location, hostname: 'adhera.africa', search: '' });
    // S'il appelait l'API, il recevrait un formulaire : il ne l'appelle pas.
    fetchMock.mockReset();
    serve(fakeResponse(200, form()));
    const other = render(<JoinPage parrain={null} />);
    await screen.findByRole('heading', { name: 'Cette page n’existe pas' });
    expect(other.container.innerHTML).toBe(closed);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Association Démo')).not.toBeInTheDocument();
  });

  it('le bandeau d’invitation ne s’affiche que si l’API sert un parrain', async () => {
    serve(fakeResponse(200, form({ referrer: { display_name: 'Aminata D.' } })));
    render(<JoinPage parrain="K7PQ4RMT" />);
    expect(await screen.findByTestId('referrer')).toHaveTextContent(
      'Aminata D. vous invite à rejoindre l’association.',
    );
    cleanup();
    // Un code invalide : l'API rend `referrer: null`, EN SILENCE — la page s'affiche normalement.
    serve(fakeResponse(200, form()));
    render(<JoinPage parrain="CODEFAUX" />);
    await screen.findByRole('heading', { name: 'Adhérer à l’association' });
    expect(screen.queryByTestId('referrer')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('le mot d’accueil s’affiche sous le titre s’il existe, rien sinon', async () => {
    serve(fakeResponse(200, form({ intro: 'Bienvenue. Le bureau examine chaque demande sous une semaine.' })));
    render(<JoinPage parrain={null} />);
    expect(await screen.findByTestId('intro')).toHaveTextContent('Bienvenue.');
    cleanup();
    serve(fakeResponse(200, form({ intro: null })));
    render(<JoinPage parrain={null} />);
    await screen.findByRole('heading', { name: 'Adhérer à l’association' });
    expect(screen.queryByTestId('intro')).not.toBeInTheDocument();
  });

  it('l’ordre : type de membre, prénom, nom, WhatsApp, région, puis les questions numérotées à la suite', async () => {
    serve(fakeResponse(200, form({ questions: [SPECIALITE, STRUCTURE], email_mode: 'required' })));
    render(<JoinPage parrain={null} />);
    await screen.findByText('1. Vous adhérez comme');
    expect(screen.getByLabelText('2. Votre prénom')).toBeInTheDocument();
    expect(screen.getByLabelText('3. Votre nom')).toBeInTheDocument();
    expect(screen.getByLabelText('4. Votre numéro WhatsApp')).toBeInTheDocument();
    expect(screen.getByLabelText('5. Votre région')).toBeInTheDocument();
    expect(screen.getByText('6. Spécialité')).toBeInTheDocument();
    expect(screen.getByLabelText(/^7\. Structure où vous exercez/)).toBeInTheDocument();
    // `required` : un champ e-mail visible, numéroté comme les autres.
    expect(screen.getByLabelText('8. Votre adresse e-mail')).toBeInTheDocument();
    // Trois blocs titrés, pas d'étapes.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Vous',
      'Vos réponses à l’association',
      'Pour finir',
    ]);
    expect(screen.queryByRole('button', { name: /Suivant/ })).not.toBeInTheDocument();
  });

  it('sans région ni question : le bloc des réponses disparaît, la numérotation se resserre', async () => {
    serve(fakeResponse(200, form({ ask_region: false, email_mode: 'hidden' })));
    render(<JoinPage parrain={null} />);
    await screen.findByLabelText('4. Votre numéro WhatsApp');
    expect(screen.queryByLabelText(/Votre région/)).not.toBeInTheDocument();
    expect(screen.queryByText('Vos réponses à l’association')).not.toBeInTheDocument();
    // `hidden` : aucun champ e-mail, aucun lien.
    expect(screen.queryByLabelText(/e-mail/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /adresse e-mail/ })).not.toBeInTheDocument();
  });

  it('e-mail facultatif : un lien « Ajouter une adresse e-mail (facultatif) » qui ouvre le champ', async () => {
    const user = userEvent.setup();
    serve(fakeResponse(200, form({ email_mode: 'optional' })));
    render(<JoinPage parrain={null} />);
    await user.click(await screen.findByRole('button', { name: 'Ajouter une adresse e-mail (facultatif)' }));
    expect(screen.getByLabelText(/Votre adresse e-mail/)).toBeInTheDocument();
  });

  it('les sortes de question : cases jusqu’à 5 réponses possibles, liste déroulante au-delà, Oui / Non, date relue en lettres', async () => {
    const user = userEvent.setup();
    serve(fakeResponse(200, form({ questions: [SPECIALITE, FONCTION, RETRAITE, PRISE] })));
    render(<JoinPage parrain={null} />);
    await screen.findByText('6. Spécialité');
    expect(SPECIALITE.options.length).toBeLessThanOrEqual(MAX_CHOICE_BUTTONS);
    expect(screen.getByRole('radio', { name: 'Imagerie médicale' })).toBeInTheDocument();
    expect(FONCTION.options.length).toBeGreaterThan(MAX_CHOICE_BUTTONS);
    const fonction = screen.getByLabelText(/^7\. Fonction/);
    expect(fonction.tagName).toBe('SELECT');
    expect(screen.getByRole('radio', { name: 'Oui' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Non' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^9\. Prise de service/), '1998-03-03');
    expect(screen.getByTestId('date-en-lettres')).toHaveTextContent('3 mars 1998');
  });

  it('le consentement est le texte du serveur, et le pot de miel est caché', async () => {
    serve(fakeResponse(200, form()));
    render(<JoinPage parrain={null} />);
    expect(
      await screen.findByLabelText(/J’accepte que Association Démo utilise ces informations/),
    ).toHaveAttribute('type', 'checkbox');
    const honeypot = screen.getByTestId('pot-de-miel');
    expect(honeypot).toHaveAttribute('aria-hidden', 'true');
    expect(within(honeypot).getByRole('textbox', { hidden: true })).toHaveAttribute('tabindex', '-1');
  });

  it('« montant libre » plutôt qu’un blanc ou « 0 FCFA »', () => {
    expect(categoryPrice({ id: 1, label: 'Bienfaiteur', amount_formatted: null, mode: 'bareme' })).toBe('montant libre');
    expect(categoryPrice({ id: 2, label: 'Actif', amount_formatted: '25 000 FCFA', mode: 'forfait' })).toBe('25 000 FCFA par an');
  });
});

describe('/adherer — les erreurs, sous le bon champ', () => {
  it('la validation locale ne dit que les champs vides et le téléphone trop court', () => {
    const errors = validateJoin(form({ questions: [SPECIALITE] }), {
      categoryId: null,
      firstName: ' ',
      lastName: '',
      phone: '77 12',
      email: '',
      consent: false,
      answers: {},
    });
    expect(Object.keys(errors)).toEqual(['category_id', 'first_name', 'last_name', 'phone', 'answers.1', 'consent']);
    expect(errors.phone).toContain('trop court');
    expect(errors['answers.1']).toBe('Répondez à la question « Spécialité ».');
  });

  it('un envoi incomplet ne part pas : le curseur va au PREMIER champ en erreur', async () => {
    const user = userEvent.setup();
    serve(fakeResponse(200, form()));
    render(<JoinPage parrain={null} />);
    await user.click(await screen.findByRole('radio', { name: /Membre actif/ }));
    await user.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));
    expect(posts()).toHaveLength(0);
    await waitFor(() => expect(screen.getByLabelText('2. Votre prénom')).toHaveFocus());
    expect(screen.getByText('Écrivez votre prénom.')).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('un 422 de l’API : chaque message sous son champ, `answers.{id}` sous la bonne question, le curseur sur la première', async () => {
    const user = userEvent.setup();
    serve(
      fakeResponse(200, form({ questions: [SPECIALITE, STRUCTURE] })),
      fakeResponse(422, {
        message: 'Votre demande d’adhésion est incomplète.',
        errors: {
          'answers.3': ['Votre réponse à « Structure où vous exercez » n’est pas valide.'],
          phone: ['Ce numéro de téléphone n’est pas valide.'],
        },
      }),
    );
    render(<JoinPage parrain={null} />);
    await screen.findByText('6. Spécialité');
    await fillIdentity(user);
    await user.click(screen.getByRole('radio', { name: 'Laboratoire' }));
    await user.type(screen.getByLabelText(/^7\. Structure/), 'x'.repeat(5));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));

    const phone = screen.getByLabelText('4. Votre numéro WhatsApp');
    await waitFor(() => expect(phone).toHaveFocus());
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Ce numéro de téléphone n’est pas valide.')).toBeInTheDocument();
    const structure = screen.getByLabelText(/^7\. Structure/);
    expect(structure).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Votre réponse à « Structure où vous exercez » n’est pas valide.')).toBeInTheDocument();
  });
});

describe('/adherer — l’envoi, et « Votre demande est envoyée »', () => {
  const MEMBER_URL = `https://demo-asso.adhera.africa/m/${'X'.repeat(64)}`;

  it('envoie `type: personne`, les réponses par identifiant, le parrain, le pot de miel vide, et une Idempotency-Key', async () => {
    const user = userEvent.setup();
    serve(
      fakeResponse(200, form({ questions: [SPECIALITE, RETRAITE, STRUCTURE] })),
      fakeResponse(201, { message: 'Votre demande d’adhésion a bien été enregistrée.', member_url: MEMBER_URL }),
    );
    render(<JoinPage parrain="K7PQ4RMT" />);
    await screen.findByText('6. Spécialité');
    await fillIdentity(user);
    await user.selectOptions(screen.getByLabelText('5. Votre région'), 'Thiès');
    await user.click(screen.getByRole('radio', { name: 'Imagerie médicale' }));
    await user.click(screen.getByRole('radio', { name: 'Non' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));

    await screen.findByRole('heading', { name: 'Votre demande est envoyée' });
    const [sent] = posts();
    expect(sent?.body).toEqual({
      type: 'personne',
      first_name: 'Babacar',
      last_name: 'Kane',
      phone: '77 000 00 22',
      category_id: 25,
      consent: true,
      website: '',
      region: 'Thiès',
      referral_code: 'K7PQ4RMT',
      // Une question sans réponse ne part pas.
      answers: { '1': 'Imagerie médicale', '4': false },
    });
    expect(sent?.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent?.headers.Authorization).toBeUndefined();
  });

  it('la même clé est rejouée après une coupure : un double envoi ne crée pas de seconde demande', async () => {
    const user = userEvent.setup();
    serve(
      fakeResponse(200, form()),
      fakeResponse(503, {}),
      fakeResponse(201, { message: 'ok', member_url: MEMBER_URL }),
    );
    render(<JoinPage parrain={null} />);
    await screen.findByText('1. Vous adhérez comme');
    await fillIdentity(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));
    await screen.findByText(/n’a pas pu être envoyée/);
    await user.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));
    await screen.findByRole('heading', { name: 'Votre demande est envoyée' });
    const [first, second] = posts();
    expect(first?.headers['Idempotency-Key']).toBe(second?.headers['Idempotency-Key']);
  });

  it('« M’envoyer ce lien sur WhatsApp » en principal, vers le numéro du visiteur, puis « Ouvrir ma page »', async () => {
    const user = userEvent.setup();
    serve(fakeResponse(200, form()), fakeResponse(201, { message: 'ok', member_url: MEMBER_URL }));
    render(<JoinPage parrain={null} />);
    await screen.findByText('1. Vous adhérez comme');
    await fillIdentity(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));

    await screen.findByRole('heading', { name: 'Votre demande est envoyée' });
    expect(screen.getByText(/vous répondra sur WhatsApp, au/)).toHaveTextContent('77 000 00 22');
    const wa = screen.getByRole('link', { name: 'M’envoyer ce lien sur WhatsApp' });
    const href = new URL(wa.getAttribute('href') as string);
    expect(href.origin + href.pathname).toBe('https://wa.me/221770000022');
    expect(href.searchParams.get('text')).toContain(MEMBER_URL);
    expect(wa).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Ouvrir ma page' })).toHaveAttribute('href', MEMBER_URL);
  });

  it('AUCUN ORACLE : la confirmation est la même, mot pour mot, quel que soit le numéro', async () => {
    const screens: string[] = [];
    for (const phone of ['77 000 00 22', '77 000 00 01']) {
      const user = userEvent.setup();
      serve(fakeResponse(200, form()), fakeResponse(201, { message: 'ok', member_url: MEMBER_URL }));
      render(<JoinPage parrain={null} />);
      await user.click(await screen.findByRole('radio', { name: /Membre actif/ }));
      await user.type(screen.getByLabelText('2. Votre prénom'), 'Babacar');
      await user.type(screen.getByLabelText('3. Votre nom'), 'Kane');
      await user.type(screen.getByLabelText('4. Votre numéro WhatsApp'), phone);
      await user.click(screen.getByRole('checkbox'));
      await user.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));
      const heading = await screen.findByRole('heading', { name: 'Votre demande est envoyée' });
      screens.push((heading.closest('main')?.textContent ?? '').replace(phone, '{numéro}'));
      cleanup();
    }
    expect(screens[0]).toBe(screens[1]);
  });

  it('sous « premier paiement », la confirmation annonce la première cotisation à payer', async () => {
    const user = userEvent.setup();
    serve(
      fakeResponse(200, form({ admission_mode: 'premier_paiement' })),
      fakeResponse(201, { message: 'ok', member_url: MEMBER_URL }),
    );
    render(<JoinPage parrain={null} />);
    await screen.findByText('1. Vous adhérez comme');
    await fillIdentity(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));
    await screen.findByRole('heading', { name: 'Votre demande est envoyée' });
    expect(screen.getByText(/Il reste à payer votre première cotisation/)).toHaveTextContent('25 000 FCFA');
    expect(screen.getByRole('link', { name: 'Ouvrir ma page pour payer' })).toBeInTheDocument();
  });

  it('le pot de miel (member_url: null) : la confirmation, sans lien', async () => {
    const user = userEvent.setup();
    serve(fakeResponse(200, form()), fakeResponse(201, { message: 'ok', member_url: null }));
    render(<JoinPage parrain={null} />);
    await screen.findByText('1. Vous adhérez comme');
    await fillIdentity(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Envoyer ma demande' }));
    await screen.findByRole('heading', { name: 'Votre demande est envoyée' });
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument();
  });
});
