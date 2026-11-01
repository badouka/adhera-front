/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/m/aaaa" }
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberPage } from '@/app/m/[token]/MemberPage';
import { DUE, DUE_PARTIAL, fakeResponse, payload, TOKEN } from './fixtures';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWith(response: unknown) {
  if (response instanceof Error) {
    fetchMock.mockRejectedValue(response);
  } else {
    fetchMock.mockResolvedValue(response);
  }
  return render(<MemberPage token={TOKEN} />);
}

describe('le tenant et l’en-tête', () => {
  it('résout le tenant depuis le sous-domaine et l’envoie en en-tête', async () => {
    renderWith(fakeResponse(200, payload()));

    await screen.findByText('Association Démo');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.eventflow.africa/api/v1/m/${TOKEN}`,
    );
    expect((init.headers as Record<string, string>)['X-Tenant-Slug']).toBe(
      'demo-asso',
    );
    // R5 : rien n'est mis en cache.
    expect(init.cache).toBe('no-store');
  });

  it('n’affiche pas d’en-tête vide quand le nom de l’organisation est vide', async () => {
    renderWith(
      fakeResponse(200, payload({ organisation: { name: '', logo_url: null, om_merchant_number: null, wave_merchant_number: null, payment_instructions: null } })),
    );

    await screen.findByText(/Bonjour Awa Diallo/);
    expect(screen.queryByRole('banner')?.textContent).toBe('');
  });

  it('porte toujours le pied de page Adhera', async () => {
    renderWith(fakeResponse(200, payload()));
    await screen.findByText('Propulsé par Adhera');
  });
});

describe('E1 — lien invalide', () => {
  it('sur un 404 member_not_found', async () => {
    renderWith(fakeResponse(404, { code: 'member_not_found' }));

    await screen.findByText('Ce lien n’est plus valide');
    expect(
      screen.getByText(/Demandez un nouveau lien au bureau/),
    ).toBeInTheDocument();
  });

  it('sans jamais suggérer une radiation', async () => {
    renderWith(fakeResponse(404, { code: 'member_not_found' }));

    await screen.findByText('Ce lien n’est plus valide');
    expect(document.body.textContent).not.toMatch(/radi/i);
    // On ne sait pas de quelle association il s'agit : aucun nom affiché.
    expect(document.body.textContent).not.toMatch(/Association Démo/);
  });
});

describe('E2 — à jour', () => {
  it('affiche la pastille et la date de couverture', async () => {
    renderWith(fakeResponse(200, payload()));

    await screen.findByText('À jour');
    expect(
      screen.getByText('Votre cotisation est réglée jusqu’au 13 mars 2027.'),
    ).toBeInTheDocument();
  });

  it('ne promet pas de rappel : les relances n’existent pas', async () => {
    renderWith(fakeResponse(200, payload()));

    await screen.findByText('À jour');
    expect(document.body.textContent).not.toMatch(/rappel/i);
  });

  it('se passe de date quand covered_until est null', async () => {
    renderWith(
      fakeResponse(
        200,
        payload({ standing: { is_up_to_date: true, covered_until: null } }),
      ),
    );

    await screen.findByText('Votre cotisation est à jour.');
  });

  it('liste les reçus téléchargeables', async () => {
    renderWith(
      fakeResponse(
        200,
        payload({
          receipts: [
            {
              id: 'r-1',
              reference: 'REC-2026-0012',
              amount_formatted: '250 000 FCFA',
              issued_at: '2026-11-13T09:00:00Z',
            },
          ],
        }),
      ),
    );

    await screen.findByText('Mes reçus');
    expect(
      screen.getByText((_, el) => el?.textContent === 'Cotisation de 250 000 FCFA' && el.tagName === 'SPAN' && el.classList.contains('font-semibold')),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Reçu REC-2026-0012 du 13 novembre 2026'),
    ).toBeInTheDocument();

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute(
      'href',
      `https://api.eventflow.africa/api/v1/m/${TOKEN}/receipts/r-1?tenant=demo-asso`,
    );
    // R3 : le jeton ne doit pas fuir par l'en-tête Referer.
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('un reçu annulé reste listé, téléchargeable, et marqué « Annulé » (§11.4)', async () => {
    renderWith(
      fakeResponse(
        200,
        payload({
          receipts: [
            {
              id: 'r-2',
              reference: 'REC-2026-0013',
              amount_formatted: '100 000 FCFA',
              issued_at: '2026-11-13T09:00:00Z',
              cancelled_at: '2026-11-14T10:00:00Z',
            },
            {
              id: 'r-1',
              reference: 'REC-2026-0012',
              amount_formatted: '250 000 FCFA',
              issued_at: '2026-11-13T09:00:00Z',
              cancelled_at: null,
            },
          ],
        }),
      ),
    );

    await screen.findByText('Mes reçus');
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('Annulé');
    expect(links[0]).toHaveTextContent('Reçu REC-2026-0013');
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('/receipts/r-2'));
    expect(links[1]).not.toHaveTextContent('Annulé');
  });

  it('n’affiche rien plutôt qu’un « Aucun reçu » anxiogène', async () => {
    renderWith(fakeResponse(200, payload({ receipts: [] })));

    await screen.findByText('À jour');
    expect(screen.queryByText('Mes reçus')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/aucun reçu/i);
  });
});

describe('E3 — cotisation due', () => {
  it('affiche le montant tel que servi, la période et les numéros marchands', async () => {
    renderWith(
      fakeResponse(
        200,
        payload({
          standing: { is_up_to_date: false, covered_until: null },
          due: DUE,
        }),
      ),
    );

    await screen.findByText('À PAYER');
    expect(screen.getByText('250 000 FCFA')).toBeInTheDocument();
    // `period_label` et `category_label`, tels que servis.
    expect(
      screen.getByText('Cotisation du 5 novembre 2025 au 4 novembre 2026'),
    ).toBeInTheDocument();
    expect(screen.getByText('Membre actif')).toBeInTheDocument();
    expect(screen.getByText('77 000 00 00')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copier le numéro Orange Money' }),
    ).toBeInTheDocument();
  });

  it('sans `period_label`, la période se relit depuis les dates', async () => {
    renderWith(
      fakeResponse(
        200,
        payload({
          standing: { is_up_to_date: false, covered_until: null },
          due: { ...DUE, period_label: null },
        }),
      ),
    );
    await screen.findByText('Cotisation du 5 novembre 2025 au 4 novembre 2026');
  });

  it('un seul bouton principal : « J’ai payé », jamais « Payer »', async () => {
    renderWith(
      fakeResponse(
        200,
        payload({
          standing: { is_up_to_date: false, covered_until: null },
          due: DUE,
        }),
      ),
    );

    await screen.findByRole('button', { name: 'J’ai payé' });
    expect(
      screen.queryByRole('button', { name: /^Payer$/ }),
    ).not.toBeInTheDocument();
    // Les autres boutons sont des « Copier » : un seul geste principal.
    const others = screen
      .getAllByRole('button')
      .filter((b) => b.textContent !== 'J’ai payé' && !/Copier/.test(b.textContent ?? ''));
    expect(others).toEqual([]);
  });

  it('marque « En retard » quand la fin de période est passée', async () => {
    vi.setSystemTime(new Date('2026-12-01T10:00:00Z'));
    renderWith(
      fakeResponse(
        200,
        payload({
          standing: { is_up_to_date: false, covered_until: null },
          due: DUE,
        }),
      ),
    );

    await screen.findByText('En retard');
    expect(
      screen.getByText(/Attendue depuis le 5 novembre 2025\./),
    ).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('marque « À régler » quand la période court encore', async () => {
    vi.setSystemTime(new Date('2026-06-01T10:00:00Z'));
    renderWith(
      fakeResponse(
        200,
        payload({
          standing: { is_up_to_date: false, covered_until: null },
          due: DUE,
        }),
      ),
    );

    await screen.findByText('À régler');
    expect(screen.queryByText('En retard')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('affiche les deux numéros marchands quand les deux sont servis', async () => {
    renderWith(
      fakeResponse(
        200,
        payload({
          organisation: {
            name: 'Association Démo',
            logo_url: null,
            om_merchant_number: '77 000 00 00',
            wave_merchant_number: '78 111 11 11',
            payment_instructions: 'Guichet ouvert\nle samedi matin.',
          },
          standing: { is_up_to_date: false, covered_until: null },
          due: DUE,
        }),
      ),
    );

    await screen.findByText('77 000 00 00');
    expect(screen.getByText('78 111 11 11')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copier le numéro Wave' }),
    ).toBeInTheDocument();
    // Les instructions sont du TEXTE, rendues avec leurs retours à la ligne.
    const instructions = screen.getByText(/Guichet ouvert/);
    expect(instructions.textContent).toBe('Guichet ouvert\nle samedi matin.');
    expect(instructions).toHaveClass('whitespace-pre-line');
  });

  it('rend les instructions libres en texte, jamais en HTML', async () => {
    renderWith(
      fakeResponse(
        200,
        payload({
          organisation: {
            name: 'Association Démo',
            logo_url: null,
            om_merchant_number: null,
            wave_merchant_number: null,
            payment_instructions: '<img src=x onerror=alert(1)>Payez au bureau.',
          },
          standing: { is_up_to_date: false, covered_until: null },
          due: DUE,
        }),
      ),
    );

    await screen.findByText(
      '<img src=x onerror=alert(1)>Payez au bureau.',
    );
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('E3b — partiel', () => {
  it('détaille « déjà réglé » sur le montant dû', async () => {
    renderWith(
      fakeResponse(
        200,
        payload({
          standing: { is_up_to_date: false, covered_until: null },
          due: DUE_PARTIAL,
        }),
      ),
    );

    await screen.findByText('RESTE À PAYER');
    expect(screen.getByText('150 000 FCFA')).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Déjà réglé : 100 000 FCFA sur 250 000 FCFA'),
    ).toBeInTheDocument();
  });
});

describe('E4 — paiement signalé, en attente', () => {
  const pending = payload({
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

  it('remercie, et annonce la confirmation par le bureau', async () => {
    renderWith(fakeResponse(200, pending));

    await screen.findByText('En attente de confirmation');
    expect(
      screen.getByText(
        'Merci. Le bureau confirmera votre paiement, et vous recevrez votre reçu ici.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('250 000 FCFA')).toBeInTheDocument();
  });

  it('affiche le mode, et la référence quand elle est servie', async () => {
    renderWith(fakeResponse(200, pending));
    await screen.findByText('Wave');
    cleanup();

    renderWith(
      fakeResponse(200, {
        ...pending,
        pending_declaration: { ...pending.pending_declaration, reference: 'TX-42' },
      }),
    );
    await screen.findByText('Wave · réf. TX-42');
  });

  it('n’affiche pas de bouton « J’ai payé »', async () => {
    renderWith(fakeResponse(200, pending));

    await screen.findByText('En attente de confirmation');
    expect(screen.queryByRole('button', { name: 'J’ai payé' })).not.toBeInTheDocument();
  });
});

describe('le rejet est visible (`last_rejection`)', () => {
  const REJECTION = {
    amount_formatted: '50 000 FCFA',
    method_label: 'Wave',
    reference: null,
    reason: 'Aucun transfert Wave reçu à ce montant. Merci de renvoyer la capture.',
    decided_at: '2026-10-30T12:47:11+00:00',
  };
  const rejected = payload({
    standing: { is_up_to_date: false, covered_until: null },
    due: DUE,
    last_rejection: REJECTION,
  });

  function rejectionText(): string | null | undefined {
    return screen.queryByRole('region', { name: 'Paiement non confirmé' })?.textContent;
  }

  it('l’encart s’affiche au-dessus du montant, motif tel quel', async () => {
    renderWith(fakeResponse(200, rejected));
    const region = await screen.findByRole('region', { name: 'Paiement non confirmé' });
    expect(region.textContent).toBe(
      'Votre paiement de 50 000 FCFA (Wave) n’a pas été confirmé : Aucun transfert Wave reçu à ce montant. Merci de renvoyer la capture. Vous pouvez le signaler à nouveau.',
    );
    // Au-dessus du montant.
    const amount = screen.getByText('250 000 FCFA');
    expect(region.compareDocumentPosition(amount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // « J'ai payé » reste le geste suivant.
    expect(screen.getByRole('button', { name: 'J’ai payé' })).toBeInTheDocument();
  });

  it('en partiel, le sous-titre « acompte reçu » se tait devant l’encart', async () => {
    renderWith(fakeResponse(200, { ...rejected, due: DUE_PARTIAL }));
    await screen.findByRole('region', { name: 'Paiement non confirmé' });
    expect(screen.queryByText('Votre acompte a bien été reçu.')).not.toBeInTheDocument();
  });

  it('cite la référence quand elle existe, et ajoute le point manquant', async () => {
    renderWith(
      fakeResponse(200, {
        ...rejected,
        last_rejection: { ...REJECTION, reference: 'TX-9', reason: 'Référence introuvable chez Wave' },
      }),
    );
    await screen.findByRole('region', { name: 'Paiement non confirmé' });
    expect(rejectionText()).toBe(
      'Votre paiement de 50 000 FCFA (Wave, réf. TX-9) n’a pas été confirmé : Référence introuvable chez Wave. Vous pouvez le signaler à nouveau.',
    );
  });

  it('le motif est échappé, jamais interprété (R8)', async () => {
    renderWith(
      fakeResponse(200, {
        ...rejected,
        last_rejection: { ...REJECTION, reason: '<img src=x onerror=alert(1)>' },
      }),
    );
    await screen.findByRole('region', { name: 'Paiement non confirmé' });
    expect(rejectionText()).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('se masque quand `last_rejection` vaut null', async () => {
    renderWith(fakeResponse(200, { ...rejected, last_rejection: null }));
    await screen.findByText('À PAYER');
    expect(rejectionText()).toBeUndefined();
  });

  it('disparaît après un nouveau signalement', async () => {
    const user = userEvent.setup();
    const pendingAfter = {
      ...rejected,
      last_rejection: null,
      pending_declaration: {
        amount: 250000,
        amount_formatted: '250 000 FCFA',
        method_label: 'Wave',
        reference: null,
        declared_at: '2026-11-12T10:30:00Z',
      },
    };
    fetchMock
      .mockResolvedValueOnce(fakeResponse(200, rejected))
      .mockResolvedValueOnce(fakeResponse(201, { declared: true }))
      .mockResolvedValueOnce(fakeResponse(200, pendingAfter));
    render(<MemberPage token={TOKEN} />);

    await screen.findByRole('region', { name: 'Paiement non confirmé' });
    await user.click(screen.getByRole('button', { name: 'J’ai payé' }));
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    await screen.findByText('En attente de confirmation');
    expect(rejectionText()).toBeUndefined();
  });
});

describe('vocabulaire — ce que lit le membre', () => {
  const BANNED = /d[ée]clar|justificatif/i;

  it('aucun état ne dit « déclar… » ni « justificatif », feuille dépliée comprise', async () => {
    const user = userEvent.setup();
    const states = [
      payload(),
      payload({ standing: { is_up_to_date: false, covered_until: null }, due: DUE_PARTIAL }),
      payload({
        standing: { is_up_to_date: false, covered_until: null },
        due: DUE,
        pending_declaration: {
          amount: 1, amount_formatted: '1 FCFA', method_label: 'Wave', reference: 'X', declared_at: '2026-11-12T10:30:00Z',
        },
      }),
      payload({ standing: { is_up_to_date: false, covered_until: null }, due: { ...DUE, amount_due: null } }),
      payload({ standing: { is_up_to_date: false, covered_until: null } }),
    ];
    for (const state of states) {
      fetchMock.mockResolvedValueOnce(fakeResponse(200, state));
      render(<MemberPage token={TOKEN} />);
      await screen.findByText('Propulsé par Adhera');
      await waitFor(() => expect(document.body.textContent).toMatch(/Bonjour/));
      expect(document.body.textContent).not.toMatch(BANNED);
      cleanup();
    }

    // E3, feuille ouverte et tout déplié.
    fetchMock.mockResolvedValue(fakeResponse(200, payload({
      standing: { is_up_to_date: false, covered_until: null }, due: DUE,
    })));
    render(<MemberPage token={TOKEN} />);
    await user.click(await screen.findByRole('button', { name: 'J’ai payé' }));
    const dialog = screen.getByRole('dialog');
    for (const name of [
      'Payer un autre montant ?',
      'Ajouter la référence du transfert (facultatif)',
      'Ajouter une capture d’écran (facultatif)',
    ]) {
      await user.click(within(dialog).getByRole('button', { name }));
    }
    expect(document.body.textContent).not.toMatch(BANNED);
  });
});

describe('le logo de l’association', () => {
  it('s’affiche à côté du nom quand `logo_url` est servi', async () => {
    const logo = 'https://api.eventflow.africa/storage-tenantdemo-asso/membership/logo-e40fd0e4.png';
    renderWith(
      fakeResponse(200, payload({ organisation: { ...payload().organisation, logo_url: logo } })),
    );
    await screen.findByText('Association Démo');
    const img = document.querySelector('header img');
    expect(img).toHaveAttribute('src', logo);
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('rien quand il est null', async () => {
    renderWith(fakeResponse(200, payload()));
    await screen.findByText('Association Démo');
    expect(document.querySelector('header img')).toBeNull();
  });
});

describe('E5 — montant inconnu', () => {
  it('renvoie vers le bureau, sans formulaire', async () => {
    renderWith(
      fakeResponse(
        200,
        payload({
          standing: { is_up_to_date: false, covered_until: null },
          due: {
            ...DUE,
            amount_due: null,
            amount_due_formatted: null,
            balance: null,
            balance_formatted: null,
          },
        }),
      ),
    );

    await screen.findByText(
      /Le montant de votre cotisation n’est pas encore fixé\./,
    );
    expect(
      screen.queryByRole('button', { name: 'J’ai payé, je confirme' }),
    ).not.toBeInTheDocument();
  });
});

describe('E6 — ni dû ni à jour', () => {
  it('annonce qu’il n’y a rien à régler', async () => {
    renderWith(
      fakeResponse(
        200,
        payload({
          standing: { is_up_to_date: false, covered_until: null },
          due: null,
        }),
      ),
    );

    await screen.findByText('Aucune cotisation n’est réclamée pour le moment.');
  });
});

describe('E8 — indisponible', () => {
  it.each([
    [403, 'feature_disabled'],
    [403, 'tenant_inactive'],
    [403, 'trial_expired'],
    [403, 'license_expired'],
    [409, 'cotisation_mode_unsupported'],
  ])('sur un %i %s', async (status, code) => {
    renderWith(fakeResponse(status, { code }));

    await screen.findByText(
      /Ce service n’est pas disponible actuellement\. Contactez le bureau de votre association\./,
    );
  });
});

describe('E9 — erreur technique', () => {
  it('sur un 429, parle de tentatives et propose de réessayer', async () => {
    renderWith(fakeResponse(429, {}));

    await screen.findByText('Trop de tentatives, réessayez dans une minute.');
    expect(
      screen.getByRole('button', { name: /Réessayer/ }),
    ).toBeInTheDocument();
  });

  it('sur un 500', async () => {
    renderWith(fakeResponse(500, {}));

    await screen.findByText('Erreur technique');
    expect(
      screen.getByRole('button', { name: /Réessayer/ }),
    ).toBeInTheDocument();
  });

  it('sur une panne réseau', async () => {
    renderWith(new TypeError('Failed to fetch'));

    await screen.findByText('Erreur technique');
  });

  it('le bouton Réessayer relance l’appel', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(500, {}))
      .mockResolvedValueOnce(fakeResponse(200, payload()));

    render(<MemberPage token={TOKEN} />);

    const retry = await screen.findByRole('button', { name: /Réessayer/ });
    retry.click();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByText('À jour');
  });
});
