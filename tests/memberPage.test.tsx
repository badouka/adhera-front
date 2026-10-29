/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/m/aaaa" }
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
      fakeResponse(200, payload({ organisation: { name: '', om_merchant_number: null, wave_merchant_number: null, payment_instructions: null } })),
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
      screen.getByText('Cotisation de 250 000 FCFA'),
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
    expect(
      screen.getByText(/Elle couvre la période du 5 novembre 2025 au 4 novembre 2026\./),
    ).toBeInTheDocument();
    expect(screen.getByText('77 000 00 00')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copier le numéro Orange Money' }),
    ).toBeInTheDocument();
  });

  it('dit « J’ai payé, je confirme », jamais « Payer »', async () => {
    renderWith(
      fakeResponse(
        200,
        payload({
          standing: { is_up_to_date: false, covered_until: null },
          due: DUE,
        }),
      ),
    );

    await screen.findByRole('button', { name: 'J’ai payé, je confirme' });
    expect(
      screen.queryByRole('button', { name: /^Payer$/ }),
    ).not.toBeInTheDocument();
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
    expect(screen.getByText('Déjà réglé')).toBeInTheDocument();
    expect(screen.getByText('100 000 FCFA')).toBeInTheDocument();
    expect(screen.getByText('250 000 FCFA')).toBeInTheDocument();
    // Le reste à payer apparaît deux fois : en gros, et dans le détail.
    expect(screen.getAllByText('150 000 FCFA')).toHaveLength(2);
  });
});

describe('E4 — déclaration en attente', () => {
  const pending = payload({
    standing: { is_up_to_date: false, covered_until: null },
    due: DUE,
    pending_declaration: {
      amount: 250000,
      amount_formatted: '250 000 FCFA',
      declared_at: '2026-11-12T10:30:00Z',
    },
  });

  it('annonce la vérification par le bureau', async () => {
    renderWith(fakeResponse(200, pending));

    await screen.findByText('En attente de validation');
    expect(
      screen.getByText(
        /Votre confirmation de 250 000 FCFA, envoyée le 12 novembre 2026, est en cours de vérification par le bureau\. Votre reçu apparaîtra sur cette page\./,
      ),
    ).toBeInTheDocument();
  });

  it('n’affiche pas de formulaire', async () => {
    renderWith(fakeResponse(200, pending));

    await screen.findByText('En attente de validation');
    expect(
      screen.queryByRole('button', { name: 'J’ai payé, je confirme' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Envoyer ma confirmation' }),
    ).not.toBeInTheDocument();
  });

  it('n’invente ni mode ni référence : l’API ne les sert pas', async () => {
    renderWith(fakeResponse(200, pending));

    await screen.findByText('En attente de validation');
    expect(screen.queryByText('Avec')).not.toBeInTheDocument();
    expect(screen.queryByText('Référence')).not.toBeInTheDocument();
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
