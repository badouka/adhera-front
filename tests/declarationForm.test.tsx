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
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberPage } from '@/app/m/[token]/MemberPage';
import { DUE, fakeResponse, payload, TOKEN } from './fixtures';

const fetchMock = vi.fn();

const DUE_PAYLOAD = payload({
  standing: { is_up_to_date: false, covered_until: null },
  due: DUE,
});

const CREATED = {
  declared: true,
  amount: 250000,
  amount_formatted: '250 000 FCFA',
  declared_at: '2026-11-12T10:30:00Z',
  message: 'Votre confirmation de 250 000 FCFA est enregistrée.',
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

/** Ouvre le formulaire, qui vit sur la MÊME page (pas de route séparée). */
async function openForm() {
  const user = userEvent.setup();
  render(<MemberPage token={TOKEN} />);
  const cta = await screen.findByRole('button', {
    name: 'J’ai payé, je confirme',
  });
  await user.click(cta);
  await screen.findByRole('button', { name: 'Envoyer ma confirmation' });
  return user;
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

describe('ouverture du formulaire', () => {
  it('s’ouvre sur la même page, montant prérempli à la balance', async () => {
    await openForm();

    const amount = screen.getByLabelText('Montant payé') as HTMLInputElement;
    // R1 : le seul nombre brut manipulé côté client, non mis en forme.
    expect(amount.value).toBe('250000');
    expect(
      screen.getByText('Vous pouvez payer en plusieurs fois.'),
    ).toBeInTheDocument();
  });

  it('propose les cinq modes, avec leurs libellés exacts', async () => {
    await openForm();

    for (const label of [
      'Orange Money',
      'Wave',
      'Virement bancaire',
      'Chèque',
      'Espèces',
    ]) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });
});

describe('la référence', () => {
  it('est exigée pour Orange Money', async () => {
    const user = await openForm();

    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    expect(
      await screen.findByText(
        'Recopiez la référence de la transaction : elle figure dans le SMS.',
      ),
    ).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('est exigée pour Wave', async () => {
    const user = await openForm();

    await user.click(screen.getByRole('radio', { name: 'Wave' }));
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    expect(
      await screen.findByText(
        'Recopiez la référence de la transaction : elle figure dans le SMS.',
      ),
    ).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('n’est pas exigée pour Espèces', async () => {
    const user = await openForm();
    fetchMock.mockResolvedValueOnce(fakeResponse(201, CREATED));

    await user.click(screen.getByRole('radio', { name: 'Espèces' }));
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = lastPostBody();
    expect(body.get('method')).toBe('especes');
    expect(body.get('amount')).toBe('250000');
    expect(body.has('reference')).toBe(false);
  });

  it('n’est pas exigée pour Virement bancaire ni Chèque', async () => {
    const user = await openForm();
    fetchMock.mockResolvedValueOnce(fakeResponse(201, CREATED));

    await user.click(screen.getByRole('radio', { name: 'Virement bancaire' }));
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastPostBody().get('method')).toBe('virement');
  });

  it('part bien dans le multipart quand elle est fournie', async () => {
    const user = await openForm();
    fetchMock.mockResolvedValueOnce(fakeResponse(201, CREATED));

    await user.type(
      screen.getByLabelText(/Référence de la transaction/),
      'TEST-F1',
    );
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    const init = posts()[0]?.[1] as RequestInit;
    expect(lastPostBody().get('reference')).toBe('TEST-F1');
    // Le navigateur doit poser lui-même la frontière du multipart.
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((init.headers as Record<string, string>)['X-Tenant-Slug']).toBe('demo-asso');
  });
});

describe('le montant', () => {
  it('refuse un montant supérieur à la balance', async () => {
    const user = await openForm();

    const amount = screen.getByLabelText('Montant payé');
    await user.clear(amount);
    await user.type(amount, '250001');
    await user.type(screen.getByLabelText(/Référence/), 'TEST-F1');
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    expect(
      await screen.findByText(
        'Le montant ne peut pas dépasser ce qui reste à payer.',
      ),
    ).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('accepte un paiement partiel, puisqu’on peut payer en plusieurs fois', async () => {
    const user = await openForm();
    fetchMock.mockResolvedValueOnce(fakeResponse(201, CREATED));

    const amount = screen.getByLabelText('Montant payé');
    await user.clear(amount);
    await user.type(amount, '100000');
    await user.type(screen.getByLabelText(/Référence/), 'TEST-F1');
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastPostBody().get('amount')).toBe('100000');
  });

  it('refuse zéro et le vide', async () => {
    const user = await openForm();

    const amount = screen.getByLabelText('Montant payé');
    await user.clear(amount);
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));
    expect(
      await screen.findByText('Indiquez le montant que vous avez payé, en chiffres.'),
    ).toBeInTheDocument();

    await user.type(amount, '0');
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));
    expect(
      await screen.findByText('Le montant doit être supérieur à zéro.'),
    ).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('n’accepte que des chiffres dans le champ', async () => {
    const user = await openForm();

    const amount = screen.getByLabelText('Montant payé') as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, '12a 3,45');
    expect(amount.value).toBe('12345');
  });
});

describe('le justificatif', () => {
  it('refuse un .docx', async () => {
    await openForm();

    const input = screen.getByLabelText(/Justificatif/) as HTMLInputElement;
    setFile(
      input,
      sizedFile(
        'cotisation.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        2048,
      ),
    );
    fireEvent.submit(screen.getByRole('button', { name: 'Envoyer ma confirmation' }).closest('form')!);

    expect(
      await screen.findByText(
        'Le justificatif doit être une image JPG, PNG ou WebP, ou un PDF.',
      ),
    ).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('refuse un fichier de 11 Mo', async () => {
    await openForm();

    const input = screen.getByLabelText(/Justificatif/) as HTMLInputElement;
    setFile(input, sizedFile('sms.png', 'image/png', 11 * 1024 * 1024));
    fireEvent.submit(screen.getByRole('button', { name: 'Envoyer ma confirmation' }).closest('form')!);

    expect(
      await screen.findByText('Le justificatif ne doit pas dépasser 10 Mo.'),
    ).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('accepte un PNG de 2 Mo et le joint au multipart', async () => {
    const user = await openForm();
    fetchMock.mockResolvedValueOnce(fakeResponse(201, CREATED));

    const input = screen.getByLabelText(/Justificatif/) as HTMLInputElement;
    setFile(input, sizedFile('sms.png', 'image/png', 2 * 1024 * 1024));
    await user.type(screen.getByLabelText(/Référence/), 'TEST-F1');
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((lastPostBody().get('proof') as File).name).toBe('sms.png');
  });

  it('accepte un PDF', async () => {
    const user = await openForm();
    fetchMock.mockResolvedValueOnce(fakeResponse(201, CREATED));

    const input = screen.getByLabelText(/Justificatif/) as HTMLInputElement;
    setFile(input, sizedFile('recu.pdf', 'application/pdf', 1024));
    await user.type(screen.getByLabelText(/Référence/), 'TEST-F1');
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    await waitFor(() => expect(posts()).toHaveLength(1));
  });
});

describe('les réponses du serveur', () => {
  async function submitWith(response: Response) {
    const user = await openForm();
    fetchMock.mockResolvedValueOnce(response);
    await user.type(screen.getByLabelText(/Référence/), 'TEST-F1');
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));
    return user;
  }

  it('201 : recharge l’état et annonce le succès', async () => {
    await submitWith(fakeResponse(201, CREATED));

    await screen.findByText('Votre confirmation de 250 000 FCFA est enregistrée.');
    // Un GET de rechargement suit le POST.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));
  });

  it('422 avec errors.{champ} : l’erreur se range sous le champ', async () => {
    await submitWith(
      fakeResponse(422, {
        errors: { reference: ['Cette référence est déjà utilisée.'] },
      }),
    );

    expect(
      await screen.findByText('Cette référence est déjà utilisée.'),
    ).toBeInTheDocument();
    // Le formulaire reste ouvert : le membre corrige.
    expect(
      screen.getByRole('button', { name: 'Envoyer ma confirmation' }),
    ).toBeInTheDocument();
  });

  it('422 amount_exceeds_balance : message sous le formulaire, puis rechargement', async () => {
    await submitWith(fakeResponse(422, { code: 'amount_exceeds_balance' }));

    await screen.findByText(
      /Le montant dépasse ce qui reste à payer\. Votre page vient d’être actualisée\./,
    );
    expect(
      screen.queryByRole('button', { name: 'Envoyer ma confirmation' }),
    ).not.toBeInTheDocument();
  });

  it('422 nothing_due : message, puis rechargement', async () => {
    await submitWith(fakeResponse(422, { code: 'nothing_due' }));

    await screen.findByText('Aucune cotisation n’est réclamée pour le moment.');
  });

  it('422 amount_due_unknown : message, puis rechargement', async () => {
    await submitWith(fakeResponse(422, { code: 'amount_due_unknown' }));

    await screen.findByText(
      /Le montant de votre cotisation n’est pas encore fixé\./,
    );
  });

  it('422 mime_not_allowed : l’erreur se range sous le justificatif', async () => {
    await submitWith(fakeResponse(422, { code: 'mime_not_allowed' }));

    const message = await screen.findByText(
      /Ce type de fichier n’est pas accepté/,
    );
    const input = screen.getByLabelText(/Justificatif/);
    expect(input.getAttribute('aria-describedby')).toContain(message.id);
  });

  it('422 file_too_large : sous le justificatif', async () => {
    await submitWith(fakeResponse(422, { code: 'file_too_large' }));

    await screen.findByText('Le justificatif dépasse 10 Mo.');
  });

  it('422 upload_invalid : sous le justificatif', async () => {
    await submitWith(fakeResponse(422, { code: 'upload_invalid' }));

    await screen.findByText(/Le justificatif n’a pas pu être lu\./);
  });

  it('409 declaration_pending : recharge, et E4 s’affiche', async () => {
    const pendingPayload = payload({
      standing: { is_up_to_date: false, covered_until: null },
      due: DUE,
      pending_declaration: {
        amount: 250000,
        amount_formatted: '250 000 FCFA',
        declared_at: '2026-11-12T10:30:00Z',
      },
    });

    const user = await openForm();
    fetchMock
      .mockResolvedValueOnce(fakeResponse(409, { code: 'declaration_pending' }))
      .mockResolvedValueOnce(fakeResponse(200, pendingPayload));

    await user.type(screen.getByLabelText(/Référence/), 'TEST-F1');
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    await screen.findByText('En attente de validation');
    expect(
      screen.queryByRole('button', { name: 'Envoyer ma confirmation' }),
    ).not.toBeInTheDocument();
  });

  it('429 : parle de tentatives sans fermer le formulaire', async () => {
    await submitWith(fakeResponse(429, {}));

    await screen.findByText('Trop de tentatives, réessayez dans une minute.');
    expect(
      screen.getByRole('button', { name: 'Envoyer ma confirmation' }),
    ).toBeInTheDocument();
  });

  it('500 : message générique, le formulaire reste ouvert', async () => {
    await submitWith(fakeResponse(500, {}));

    await screen.findByText(
      /Votre confirmation n’a pas pu être envoyée\. Réessayez dans un instant\./,
    );
    expect(
      screen.getByRole('button', { name: 'Envoyer ma confirmation' }),
    ).toBeInTheDocument();
  });
});

describe('accessibilité du formulaire', () => {
  it('relie chaque erreur à son champ par aria-describedby', async () => {
    const user = await openForm();

    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    const reference = screen.getByLabelText(/Référence de la transaction/);
    const error = await screen.findByText(
      'Recopiez la référence de la transaction : elle figure dans le SMS.',
    );
    expect(reference.getAttribute('aria-describedby')).toContain(error.id);
    expect(reference).toHaveAttribute('aria-invalid', 'true');
  });

  it('déplace le focus sur le premier champ en erreur', async () => {
    const user = await openForm();

    const amount = screen.getByLabelText('Montant payé');
    await user.clear(amount);
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    await waitFor(() => expect(document.activeElement).toBe(amount));
  });

  it('porte une région aria-live pour le résultat de l’envoi', async () => {
    await openForm();

    const live = document.querySelector('[role="alert"][aria-live="polite"]');
    expect(live).not.toBeNull();
  });

  it('déplace le focus sur le message de succès', async () => {
    const user = await openForm();
    fetchMock.mockResolvedValueOnce(fakeResponse(201, CREATED));

    await user.type(screen.getByLabelText(/Référence/), 'TEST-F1');
    await user.click(screen.getByRole('button', { name: 'Envoyer ma confirmation' }));

    const success = await screen.findByText(
      'Votre confirmation de 250 000 FCFA est enregistrée.',
    );
    await waitFor(() => expect(document.activeElement).toBe(success));
  });

  it('le formulaire prend le focus à l’ouverture, sans ouvrir le clavier', async () => {
    await openForm();

    const heading = screen.getByRole('heading', { name: 'Confirmer mon paiement' });
    expect(document.activeElement).toBe(heading);
  });
});
