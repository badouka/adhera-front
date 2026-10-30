/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/m/aaaa" }
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberPage } from '@/app/m/[token]/MemberPage';
import { methodsFor } from '@/components/PaymentSheet';
import { formatTypedAmount } from '@/lib/typedAmount';
import type { Organisation } from '@/lib/types';
import { DUE, fakeResponse, payload, TOKEN } from './fixtures';

const fetchMock = vi.fn();

const ORGANISATION: Organisation = {
  name: 'Association Démo',
  logo_url: null,
  om_merchant_number: '771234567',
  wave_merchant_number: '761234567',
  payment_instructions: null,
};

const DUE_PAYLOAD = payload({
  organisation: ORGANISATION,
  standing: { is_up_to_date: false, covered_until: null },
  due: DUE,
});

const PENDING_PAYLOAD = payload({
  organisation: ORGANISATION,
  standing: { is_up_to_date: false, covered_until: null },
  due: DUE,
  pending_declaration: {
    amount: 250000,
    amount_formatted: '250 000 FCFA',
    method_label: 'Wave',
    reference: null,
    declared_at: '2026-11-12T10:30:00Z',
  },
});

const CREATED = {
  declared: true,
  amount: 250000,
  amount_formatted: '250 000 FCFA',
  declared_at: '2026-11-12T10:30:00Z',
  message: 'Déclaration enregistrée.',
};

beforeEach(() => {
  fetchMock.mockReset();
  // Le GET initial, puis tout ce que chaque test empile ensuite.
  fetchMock.mockResolvedValue(fakeResponse(200, DUE_PAYLOAD));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Ouvre la feuille : le PREMIER toucher. */
async function openSheet() {
  const user = userEvent.setup();
  render(<MemberPage token={TOKEN} />);
  await user.click(await screen.findByRole('button', { name: 'J’ai payé' }));
  await screen.findByRole('dialog', { name: 'Signaler mon paiement' });
  return user;
}

function confirmButton() {
  return screen.getByRole('button', { name: 'Confirmer' });
}

function posts() {
  return fetchMock.mock.calls.filter(
    (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
  );
}

function lastPostBody(): FormData {
  const call = posts().at(-1);
  return (call?.[1] as RequestInit).body as FormData;
}

function setFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', {
    value: [file],
    configurable: true,
  });
  fireEvent.change(input);
}

function sizedFile(name: string, type: string, bytes: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: bytes, configurable: true });
  return file;
}

describe('le chemin normal : deux touchers', () => {
  it('« J’ai payé » puis « Confirmer » envoie le solde et Wave, sans référence', async () => {
    const user = await openSheet();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(201, CREATED))
      .mockResolvedValueOnce(fakeResponse(200, PENDING_PAYLOAD));

    await user.click(confirmButton());

    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = lastPostBody();
    expect(body.get('amount')).toBe('250000');
    expect(body.get('method')).toBe('wave');
    expect(body.has('reference')).toBe(false);
    expect(body.has('proof')).toBe(false);
  });

  it('après l’envoi : l’écran E4, son texte, et le focus dessus', async () => {
    const user = await openSheet();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(201, CREATED))
      .mockResolvedValueOnce(fakeResponse(200, PENDING_PAYLOAD));

    await user.click(confirmButton());

    const thanks = await screen.findByText(
      'Merci. Le bureau confirmera votre paiement, et vous recevrez votre reçu ici.',
    );
    await waitFor(() => expect(document.activeElement).toBe(thanks));
    // Le message du serveur (« Déclaration… ») n'est jamais recopié.
    expect(screen.queryByText(/Déclaration/)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('les champs facultatifs sont repliés à l’ouverture', async () => {
    await openSheet();
    expect(screen.queryByLabelText(/Montant payé/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Référence du transfert/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Capture d’écran du paiement/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payer un autre montant ?' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ajouter la référence du transfert (facultatif)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ajouter une capture d’écran (facultatif)' }),
    ).toBeInTheDocument();
  });

  it('le montant affiché est celui du serveur (R1)', async () => {
    await openSheet();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('250 000 FCFA').length).toBeGreaterThan(0);
  });

  it('la feuille prend le focus sur son titre, sans ouvrir le clavier', async () => {
    await openSheet();
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Signaler mon paiement' }),
    );
  });

  it('« Annuler » ferme la feuille sans rien envoyer', async () => {
    const user = await openSheet();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });
});

describe('le mode : des puces, Wave d’abord', () => {
  it('Wave s’il est configuré, puis Orange Money, puis les autres', () => {
    expect(methodsFor(ORGANISATION)).toEqual(['wave', 'om', 'virement', 'cheque', 'especes']);
  });

  it('sans Wave : le premier moyen disponible, Orange Money', () => {
    expect(methodsFor({ ...ORGANISATION, wave_merchant_number: null })[0]).toBe('om');
  });

  it('sans aucun numéro : l’ordre par défaut', () => {
    expect(
      methodsFor({ ...ORGANISATION, wave_merchant_number: null, om_merchant_number: null }),
    ).toEqual(['om', 'wave', 'virement', 'cheque', 'especes']);
  });

  it('des boutons radio, pas une liste déroulante, et Wave coché', async () => {
    await openSheet();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Wave' })).toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });

  it('changer de puce change le mode envoyé', async () => {
    const user = await openSheet();
    fetchMock.mockResolvedValueOnce(fakeResponse(201, CREATED));
    await user.click(screen.getByRole('radio', { name: 'Orange Money' }));
    await user.click(confirmButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastPostBody().get('method')).toBe('om');
  });
});

describe('les champs repliés', () => {
  it('la référence, une fois saisie, part dans le multipart', async () => {
    const user = await openSheet();
    fetchMock.mockResolvedValueOnce(fakeResponse(201, CREATED));
    await user.click(
      screen.getByRole('button', { name: 'Ajouter la référence du transfert (facultatif)' }),
    );
    await user.type(screen.getByLabelText(/Référence du transfert/), 'TX-42');
    await user.click(confirmButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastPostBody().get('reference')).toBe('TX-42');
  });

  it('un autre montant : la saisie est réaffichée formatée, et envoyée brute', async () => {
    const user = await openSheet();
    fetchMock.mockResolvedValueOnce(fakeResponse(201, CREATED));
    await user.click(screen.getByRole('button', { name: 'Payer un autre montant ?' }));
    const amount = screen.getByLabelText(/Montant payé/);
    await user.clear(amount);
    await user.type(amount, '100000');

    // § D : la saisie relue, pour qu'un zéro de trop saute aux yeux.
    expect(screen.getAllByText('100 000 FCFA').length).toBeGreaterThan(0);

    await user.click(confirmButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastPostBody().get('amount')).toBe('100000');
  });

  it('refuse un montant supérieur au solde, et le champ se déplie', async () => {
    const user = await openSheet();
    await user.click(screen.getByRole('button', { name: 'Payer un autre montant ?' }));
    const amount = screen.getByLabelText(/Montant payé/);
    await user.clear(amount);
    await user.type(amount, '2500000');
    await user.click(confirmButton());

    await screen.findByText('Le montant ne peut pas dépasser ce qui reste à payer.');
    expect(posts()).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(amount));
  });

  it('n’accepte que des chiffres dans le champ montant', async () => {
    const user = await openSheet();
    await user.click(screen.getByRole('button', { name: 'Payer un autre montant ?' }));
    const amount = screen.getByLabelText(/Montant payé/) as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, '12a 3,5');
    expect(amount.value).toBe('1235');
  });

  it('une capture PNG est jointe au multipart', async () => {
    const user = await openSheet();
    fetchMock.mockResolvedValueOnce(fakeResponse(201, CREATED));
    await user.click(
      screen.getByRole('button', { name: 'Ajouter une capture d’écran (facultatif)' }),
    );
    const png = sizedFile('capture.png', 'image/png', 2 * 1024 * 1024);
    setFile(screen.getByLabelText('Capture d’écran du paiement') as HTMLInputElement, png);
    await user.click(confirmButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastPostBody().get('proof')).toBe(png);
  });

  it('refuse un .docx, en parlant de capture', async () => {
    const user = await openSheet();
    await user.click(
      screen.getByRole('button', { name: 'Ajouter une capture d’écran (facultatif)' }),
    );
    setFile(
      screen.getByLabelText('Capture d’écran du paiement') as HTMLInputElement,
      sizedFile('releve.docx', 'application/msword', 1000),
    );
    await user.click(confirmButton());
    await screen.findByText('La capture doit être une image JPG, PNG ou WebP, ou un PDF.');
    expect(posts()).toHaveLength(0);
  });

  it('refuse un fichier de 11 Mo', async () => {
    const user = await openSheet();
    await user.click(
      screen.getByRole('button', { name: 'Ajouter une capture d’écran (facultatif)' }),
    );
    setFile(
      screen.getByLabelText('Capture d’écran du paiement') as HTMLInputElement,
      sizedFile('capture.png', 'image/png', 11 * 1024 * 1024),
    );
    await user.click(confirmButton());
    await screen.findByText('La capture ne doit pas dépasser 10 Mo.');
  });
});

describe('les réponses du serveur', () => {
  async function submitWith(response: Response) {
    const user = await openSheet();
    fetchMock.mockResolvedValueOnce(response);
    await user.click(confirmButton());
    return user;
  }

  it('422 errors.reference : le champ se déplie, message en français', async () => {
    await submitWith(
      fakeResponse(422, {
        message: 'The reference field must not be greater than 255 characters.',
        errors: { reference: ['The reference field must not be greater than 255 characters.'] },
      }),
    );

    const message = await screen.findByText(
      'Vérifiez la référence du transfert (255 caractères au plus).',
    );
    const input = screen.getByLabelText(/Référence du transfert/);
    expect(input.getAttribute('aria-describedby')).toContain(message.id);
    expect(screen.queryByText(/The reference field/)).not.toBeInTheDocument();
    expect(confirmButton()).toBeInTheDocument();
  });

  it('422 sans code ni champ connu : message générique, jamais le texte brut', async () => {
    await submitWith(
      fakeResponse(422, {
        message: 'The given data was invalid.',
        errors: { foo: ['The foo field is required.'] },
      }),
    );
    await screen.findByText(/Votre paiement n’a pas pu être signalé\./);
    expect(screen.queryByText(/given data|foo field/)).not.toBeInTheDocument();
  });

  it('422 amount_exceeds_balance : message, puis rechargement', async () => {
    await submitWith(fakeResponse(422, { code: 'amount_exceeds_balance' }));
    await screen.findByText(
      /Le montant dépasse ce qui reste à payer\. Votre page vient d’être actualisée\./,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('422 nothing_due et amount_due_unknown : message, puis rechargement', async () => {
    await submitWith(fakeResponse(422, { code: 'nothing_due' }));
    await screen.findByText('Aucune cotisation n’est réclamée pour le moment.');
  });

  it('422 mime_not_allowed : sous la capture, dépliée', async () => {
    await submitWith(fakeResponse(422, { code: 'mime_not_allowed' }));
    const message = await screen.findByText(/Ce type de fichier n’est pas accepté/);
    const input = screen.getByLabelText('Capture d’écran du paiement');
    expect(input.getAttribute('aria-describedby')).toContain(message.id);
  });

  it('422 file_too_large et upload_invalid : en parlant de capture', async () => {
    await submitWith(fakeResponse(422, { code: 'file_too_large' }));
    await screen.findByText('La capture dépasse 10 Mo.');
  });

  it('409 declaration_pending : recharge, et E4 s’affiche', async () => {
    const user = await openSheet();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(409, { code: 'declaration_pending' }))
      .mockResolvedValueOnce(fakeResponse(200, PENDING_PAYLOAD));
    await user.click(confirmButton());

    await screen.findByText('Un paiement est déjà en attente de confirmation par le bureau.');
    await screen.findByText('En attente de confirmation');
    expect(screen.queryByRole('button', { name: 'J’ai payé' })).not.toBeInTheDocument();
  });

  it('429 : parle de tentatives sans fermer la feuille', async () => {
    await submitWith(fakeResponse(429, {}));
    await screen.findByText('Trop de tentatives, réessayez dans une minute.');
    expect(confirmButton()).toBeInTheDocument();
  });

  it('500 : message générique, focus dessus, la feuille reste ouverte', async () => {
    await submitWith(fakeResponse(500, {}));
    const error = await screen.findByText(
      'Votre paiement n’a pas pu être signalé. Réessayez dans un instant.',
    );
    await waitFor(() => expect(document.activeElement).toBe(error));
    expect(confirmButton()).toBeInTheDocument();
  });
});

describe('§ D — formatTypedAmount', () => {
  it('écrit la saisie comme le serveur écrit ses montants', () => {
    // Même graphie que `amount_formatted` : espace ORDINAIRE (piège 3).
    expect(formatTypedAmount(250000)).toBe('250 000 FCFA');
    expect(formatTypedAmount(2500000)).toBe('2 500 000 FCFA');
    expect(formatTypedAmount(500)).toBe('500 FCFA');
  });
});
