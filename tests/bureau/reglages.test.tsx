/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/reglages" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReglagesPage from '@/app/bureau/reglages/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import { CATEGORIES, calls, fakeServer, fullText, renderInBureau, SESSION, settings } from './fixtures';

beforeEach(() => {
  window.sessionStorage.clear();
  resetSessionCache();
  saveSession(SESSION);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const IN_USE = {
  message: 'Cette catégorie est utilisée : la désactiver plutôt que la supprimer.',
  code: 'category_in_use',
  members: 6,
  dues: 7,
};

describe('B11 — les catégories', () => {
  it('une suppression refusée propose aussitôt « Désactiver à la place », chiffres à l’appui', async () => {
    const fetchMock = fakeServer([
      { method: 'DELETE', match: 'membership/categories/1', status: 422, body: IN_USE },
      { method: 'PUT', match: 'membership/categories/1', body: { ...CATEGORIES[2], is_active: false } },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    const user = userEvent.setup();
    renderInBureau(<ReglagesPage />);

    const row = (await screen.findByText('Membre actif')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Supprimer' }));
    const dialog = screen.getByRole('dialog', { name: 'Supprimer cette catégorie ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer la catégorie' }));

    await screen.findByText(/utilisée par 6 membres et 7 cotisations/);
    await user.click(screen.getByRole('button', { name: 'Désactiver à la place' }));

    await waitFor(() => expect(calls(fetchMock, 'PUT')).toHaveLength(1));
    expect(JSON.parse(calls(fetchMock, 'PUT')[0]?.init.body as string)).toEqual({ is_active: false });
    await screen.findByText(/est désactivée/);
    expect(within(screen.getByText('Membre actif').closest('li') as HTMLElement).getByText('Désactivée')).toBeInTheDocument();
  });

  it('le barème n’est pas proposé à la création', async () => {
    fakeServer([{ match: 'membership/categories', body: CATEGORIES }]);
    const user = userEvent.setup();
    renderInBureau(<ReglagesPage />);
    await user.click(await screen.findByRole('button', { name: 'Ajouter une catégorie' }));
    const mode = screen.getByLabelText(/Mode de calcul/) as HTMLSelectElement;
    const values = Array.from(mode.options).map((o) => o.value);
    expect(values).toEqual(['forfait', 'minimum', 'exonere']);
  });

  it('crée une catégorie avec un montant brut, affiché ensuite tel que servi', async () => {
    const created = { id: 9, label: 'Jeune', mode: 'forfait', amount: 10000, amount_formatted: '10 000 FCFA', sort_order: 0, is_active: true, is_calculable: true };
    const fetchMock = fakeServer([
      { method: 'POST', match: 'membership/categories', status: 201, body: created },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    const user = userEvent.setup();
    renderInBureau(<ReglagesPage />);
    await user.click(await screen.findByRole('button', { name: 'Ajouter une catégorie' }));
    await user.type(screen.getByLabelText(/^Nom \*$/), 'Jeune');
    await user.type(screen.getByLabelText(/^Montant/), '10000');
    await user.click(screen.getByRole('button', { name: 'Ajouter la catégorie' }));

    await screen.findByText(fullText('Forfait — 10 000 FCFA'));
    expect(JSON.parse(calls(fetchMock, 'POST')[0]?.init.body as string)).toEqual({
      label: 'Jeune', mode: 'forfait', amount: 10000, sort_order: 0,
    });
  });
});

describe('B11 — l’association', () => {
  it('mode et types de membres en lecture seule', async () => {
    fakeServer([{ match: 'membership/categories', body: [] }]);
    renderInBureau(<ReglagesPage />);
    expect(screen.getByText('À la date anniversaire d’adhésion')).toBeInTheDocument();
    expect(screen.getByText('Personnes et organisations')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Mode de cotisation/ })).not.toBeInTheDocument();
  });

  it('enregistre les instructions, et elles seules parmi les champs modifiables', async () => {
    const fetchMock = fakeServer([
      { method: 'PUT', match: 'membership/settings', body: settings({ payment_instructions: 'Nouveau texte' }) },
      { match: 'membership/categories', body: [] },
    ]);
    const user = userEvent.setup();
    const { value } = renderInBureau(<ReglagesPage />);
    const field = screen.getByLabelText(/Instructions de paiement/);
    await user.clear(field);
    await user.type(field, 'Nouveau texte');
    await user.click(screen.getByRole('button', { name: 'Enregistrer les réglages' }));

    await screen.findByText('Réglages enregistrés.');
    const body = JSON.parse(calls(fetchMock, 'PUT')[0]?.init.body as string);
    expect(Object.keys(body).sort()).toEqual(
      ['issuer_name', 'om_merchant_number', 'payment_instructions', 'wave_merchant_number'],
    );
    expect(body.payment_instructions).toBe('Nouveau texte');
    expect(value.setSettings).toHaveBeenCalled();
  });

  it('refuse un logo GIF avant tout envoi', async () => {
    const fetchMock = fakeServer([{ match: 'membership/categories', body: [] }]);
    const user = userEvent.setup({ applyAccept: false });
    const { container } = renderInBureau(<ReglagesPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['GIF89a'], 'logo.gif', { type: 'image/gif' }));
    await screen.findByText('Le logo doit être une image JPEG ou PNG.');
    expect(calls(fetchMock, 'POST')).toHaveLength(0);
  });

  it('envoie un PNG en multipart sous la clé `logo`', async () => {
    const fetchMock = fakeServer([
      { method: 'POST', match: 'membership/settings/logo', body: settings({ logo_url: 'https://api.eventflow.africa/storage-tenantdemo-asso/membership/logo-11111111.png' }) },
      { match: 'membership/categories', body: [] },
    ]);
    const user = userEvent.setup();
    const { container, value } = renderInBureau(<ReglagesPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['png'], 'logo.png', { type: 'image/png' });
    await user.upload(input, file);

    await screen.findByText('Logo enregistré.');
    const body = calls(fetchMock, 'POST')[0]?.init.body as FormData;
    expect(body.get('logo')).toBe(file);
    expect(value.setSettings).toHaveBeenCalled();
  });
});

describe('F3 — le rapport du lundi', () => {
  it('coché par défaut (absent = true) ; décocher envoie weekly_report_enabled: false, seul', async () => {
    const fetchMock = fakeServer([
      { method: 'PUT', match: 'membership/settings', body: settings({ weekly_report_enabled: false }) },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    const user = userEvent.setup();
    const { value } = renderInBureau(<ReglagesPage />);
    const box = screen.getByRole('checkbox', {
      name: 'Recevoir chaque lundi le rapport par e-mail (président et trésorier)',
    });
    expect(box).toBeChecked();
    await user.click(box);
    await screen.findByText('Enregistré.');
    const [put] = calls(fetchMock, 'PUT');
    expect(JSON.parse(put?.init.body as string)).toEqual({ weekly_report_enabled: false });
    expect(value.setSettings).toHaveBeenCalledWith(expect.objectContaining({ weekly_report_enabled: false }));
  });

  it('suit la valeur servie', () => {
    fakeServer([{ match: 'membership/categories', body: CATEGORIES }]);
    renderInBureau(<ReglagesPage />, { settings: settings({ weekly_report_enabled: false }) });
    expect(screen.getByRole('checkbox', { name: /rapport par e-mail/ })).not.toBeChecked();
  });
});

describe('§12.1 — années de cotisation manquées', () => {
  const RECAP =
    'Les montants à encaisser et les relances vont changer. Rien n’est effacé ; vous pourrez revenir en arrière à tout moment.';

  function panel() {
    return screen.getByRole('heading', { name: 'Années de cotisation manquées' }).closest('section') as HTMLElement;
  }

  it('deux choix, chacun expliqué ; le réglage servi est coché (le défaut si absent)', async () => {
    fakeServer([{ match: 'membership/categories', body: CATEGORIES }]);
    renderInBureau(<ReglagesPage />, { settings: settings() });
    await screen.findByText('Membre actif');
    const recommended = within(panel()).getByRole('radio', { name: 'Repartir de l’année en cours (recommandé)' });
    const all = within(panel()).getByRole('radio', { name: 'Réclamer toutes les années manquées' });
    expect(recommended).toBeChecked();
    expect(all).not.toBeChecked();
    expect(recommended).toHaveAccessibleDescription(
      'Un membre se remet à jour en un paiement. Les années manquées restent visibles dans son historique, sans être réclamées.',
    );
    expect(all).toHaveAccessibleDescription('Le membre règle chaque année, de la plus ancienne à la plus récente.');
    // Rien à enregistrer tant que le choix est celui du serveur.
    expect(within(panel()).queryByRole('button', { name: 'Enregistrer ce choix' })).toBeNull();
  });

  it('aller : récapitulatif R9 AVANT le PUT, puis `{ arrears_policy: "all" }` seul', async () => {
    const fetchMock = fakeServer([
      { method: 'PUT', match: 'membership/settings', body: settings({ arrears_policy: 'all' }) },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    const user = userEvent.setup();
    const { value } = renderInBureau(<ReglagesPage />, { settings: settings({ arrears_policy: 'current_only' }) });
    await screen.findByText('Membre actif');
    await user.click(within(panel()).getByRole('radio', { name: 'Réclamer toutes les années manquées' }));
    await user.click(within(panel()).getByRole('button', { name: 'Enregistrer ce choix' }));

    const dialog = screen.getByRole('dialog', { name: 'Changer ce que l’association réclame ?' });
    expect(within(dialog).getByText('Réclamer toutes les années manquées')).toBeInTheDocument();
    expect(within(dialog).getByTestId('arrears-recap').textContent?.replace(/\s+/g, ' ').trim()).toBe(RECAP);
    expect(calls(fetchMock, 'PUT')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer ce choix' }));
    await waitFor(() => expect(calls(fetchMock, 'PUT')).toHaveLength(1));
    expect(JSON.parse(calls(fetchMock, 'PUT')[0]?.init.body as string)).toEqual({ arrears_policy: 'all' });
    expect(value.setSettings).toHaveBeenCalledWith(expect.objectContaining({ arrears_policy: 'all' }));
    await screen.findByText('Enregistré. Les fiches et les relances suivent ce choix.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('retour : de `all` à l’année en cours, même récapitulatif ; « Ne pas changer » n’envoie rien', async () => {
    const fetchMock = fakeServer([
      { method: 'PUT', match: 'membership/settings', body: settings({ arrears_policy: 'current_only' }) },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    const user = userEvent.setup();
    renderInBureau(<ReglagesPage />, { settings: settings({ arrears_policy: 'all' }) });
    await screen.findByText('Membre actif');
    expect(within(panel()).getByRole('radio', { name: 'Réclamer toutes les années manquées' })).toBeChecked();
    await user.click(within(panel()).getByRole('radio', { name: 'Repartir de l’année en cours (recommandé)' }));
    await user.click(within(panel()).getByRole('button', { name: 'Enregistrer ce choix' }));
    await user.click(screen.getByRole('button', { name: 'Ne pas changer' }));
    expect(calls(fetchMock, 'PUT')).toHaveLength(0);

    await user.click(within(panel()).getByRole('button', { name: 'Enregistrer ce choix' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('arrears-recap').textContent?.replace(/\s+/g, ' ').trim()).toBe(RECAP);
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer ce choix' }));
    await waitFor(() => expect(calls(fetchMock, 'PUT')).toHaveLength(1));
    expect(JSON.parse(calls(fetchMock, 'PUT')[0]?.init.body as string)).toEqual({ arrears_policy: 'current_only' });
  });

  it('422 : le message du serveur, en français, dans la confirmation', async () => {
    fakeServer([
      {
        method: 'PUT',
        match: 'membership/settings',
        status: 422,
        body: {
          message: 'Certains réglages sont invalides.',
          errors: { arrears_policy: ['La politique d’arriérés doit valoir « current_only » ou « all ».'] },
        },
      },
      { match: 'membership/categories', body: CATEGORIES },
    ]);
    const user = userEvent.setup();
    renderInBureau(<ReglagesPage />, { settings: settings({ arrears_policy: 'current_only' }) });
    await screen.findByText('Membre actif');
    await user.click(within(panel()).getByRole('radio', { name: 'Réclamer toutes les années manquées' }));
    await user.click(within(panel()).getByRole('button', { name: 'Enregistrer ce choix' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enregistrer ce choix' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'La politique d’arriérés doit valoir « current_only » ou « all ».',
    );
  });
});
