/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AValiderPage from '@/app/bureau/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import { calls, fakeServer, payment, renderInBureau, SESSION } from './fixtures';

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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const VALIDATED = payment({
  status: 'validated',
  decided_at: '2026-10-29T20:01:26+00:00',
  decided_by_user_id: 3,
  decided_by_name: 'Trésorier Démo',
  receipt: { id: '01a18940-c9a5-71ec-970d-9d7510492173', reference: 'REC-2026-CB4A73AE' },
});

describe('B2 — la file « À valider »', () => {
  it('demande les déclarations et en affiche chaque détail', async () => {
    const server = fakeServer([{ match: 'membership/payments', body: [payment()] }]);
    renderInBureau(<AValiderPage />);

    await screen.findByText('Moussa Ndiaye (test)');
    expect(calls(server)[0]?.url).toBe(
      'https://api.eventflow.africa/api/v1/admin/membership/payments?status=declared',
    );
    // R1 : le montant tel que servi.
    expect(screen.getByText('100 000 FCFA')).toBeInTheDocument();
    expect(screen.getByText('Wave')).toBeInTheDocument();
    expect(screen.getByText('TEST-F1')).toBeInTheDocument();
    // Payé le, puis déclaré le : les deux dates sont lues sans glisser à LA.
    expect(screen.getAllByText('29 octobre 2026', { selector: 'dd' })).toHaveLength(2);
    expect(
      screen.getByText('Cotisation du 1er octobre 2026 au 30 septembre 2027'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Valider' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rejeter' })).toBeInTheDocument();
  });

  it('état vide : « Aucun versement à valider. »', async () => {
    fakeServer([{ match: 'membership/payments', body: [] }]);
    renderInBureau(<AValiderPage />);
    await screen.findByText('Aucun versement à valider.');
  });

  it('sans justificatif : pas de bouton, et ça se dit', async () => {
    fakeServer([{ match: 'membership/payments', body: [payment({ has_proof: false })] }]);
    renderInBureau(<AValiderPage />);
    await screen.findByText('Moussa Ndiaye (test)');
    expect(screen.queryByRole('button', { name: /justificatif/ })).not.toBeInTheDocument();
    expect(screen.getByText('Aucun justificatif joint.')).toBeInTheDocument();
  });

  it('le justificatif : lien signé demandé AU CLIC, ouvert tel quel, sans opener', async () => {
    const signed = 'https://api.eventflow.africa/api/v1/membership/proofs/p?tenant=demo-asso&signature=abc';
    const server = fakeServer([
      { match: /proof-url$/, body: { url: signed } },
      { match: 'membership/payments', body: [payment()] },
    ]);
    const tab = { opener: {} as unknown, closed: false, location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);

    await screen.findByText('Moussa Ndiaye (test)');
    // Rien n'est demandé au chargement : le lien périme en 60 minutes.
    expect(calls(server).some((c) => c.url.includes('proof-url'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Voir le justificatif' }));

    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(signed));
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(calls(server).filter((c) => c.url.includes('proof-url'))).toHaveLength(1);
  });

  it('onglet « Validés » : qui a validé, et quand', async () => {
    const server = fakeServer([
      { match: 'membership/payments?status=validated', body: [VALIDATED] },
      { match: 'membership/payments', body: [] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await screen.findByText('Aucun versement à valider.');

    await user.click(screen.getByRole('tab', { name: 'Validés' }));

    await screen.findByText('Validé le 29 octobre 2026 par Trésorier Démo');
    expect(calls(server).at(-1)?.url).toContain('status=validated');
    expect(screen.getByRole('button', { name: 'Télécharger le reçu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument();
  });

  it('onglet « Rejetés » : le motif, qui, quand', async () => {
    fakeServer([
      {
        match: 'membership/payments?status=rejected',
        body: [
          payment({
            status: 'rejected',
            decided_at: '2026-10-29T20:01:27+00:00',
            decided_by_name: 'Trésorier Démo',
            rejection_reason: 'Référence introuvable chez Orange Money.',
          }),
        ],
      },
      { match: 'membership/payments', body: [] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await screen.findByText('Aucun versement à valider.');

    await user.click(screen.getByRole('tab', { name: 'Rejetés' }));

    await screen.findByText('Rejeté le 29 octobre 2026 par Trésorier Démo');
    expect(screen.getByText('Motif : Référence introuvable chez Orange Money.')).toBeInTheDocument();
  });

  it('mode de cotisation non pris en charge : aucun bouton « Valider »', async () => {
    fakeServer([{ match: 'membership/payments', body: [payment()] }]);
    renderInBureau(<AValiderPage />, { modeSupported: false });
    await screen.findByText('Moussa Ndiaye (test)');
    expect(screen.queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument();
  });
});

describe('B3 — valider (R9)', () => {
  it('récapitule, préremplit la date, puis valide et propose le reçu', async () => {
    const server = fakeServer([
      { method: 'POST', match: /validate$/, body: { ...VALIDATED, paid_on: '2026-10-28' } },
      { match: 'membership/payments', body: [payment()] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Valider' }));

    const dialog = screen.getByRole('dialog', { name: 'Valider ce versement ?' });
    // Le récapitulatif : nom, montant formaté, mode, référence.
    for (const text of ['Moussa Ndiaye (test)', '100 000 FCFA', 'Wave', 'TEST-F1']) {
      expect(within(dialog).getByText(text)).toBeInTheDocument();
    }
    const date = within(dialog).getByLabelText('Date du paiement') as HTMLInputElement;
    expect(date.value).toBe('2026-10-29');
    // Rien n'est parti avant la confirmation.
    expect(calls(server, 'POST')).toHaveLength(0);

    await user.clear(date);
    await user.type(date, '2026-10-28');
    await user.click(within(dialog).getByRole('button', { name: 'Valider et émettre le reçu' }));

    await screen.findByText('Versement validé. Reçu émis.');
    const posts = calls(server, 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(
      'https://api.eventflow.africa/api/v1/admin/membership/payments/01a1893f-d5b7-707e-9a64-6f65cb4a73ae/validate',
    );
    expect(JSON.parse(posts[0]?.init.body as string)).toEqual({ paid_on: '2026-10-28' });
    expect(screen.getByRole('button', { name: 'Télécharger le reçu' })).toBeInTheDocument();
    // La ligne a quitté la file.
    expect(screen.queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument();
  });

  it('sans reçu dans la réponse : ni promesse, ni lien', async () => {
    fakeServer([
      { method: 'POST', match: /validate$/, body: { ...VALIDATED, receipt: null } },
      { match: 'membership/payments', body: [payment()] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Valider' }));
    await user.click(screen.getByRole('button', { name: 'Valider et émettre le reçu' }));

    await screen.findByText('Versement validé.');
    expect(screen.queryByText(/Reçu émis/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Télécharger le reçu' })).not.toBeInTheDocument();
  });

  it('« Annuler » ne valide rien', async () => {
    const server = fakeServer([{ match: 'membership/payments', body: [payment()] }]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Valider' }));
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls(server, 'POST')).toHaveLength(0);
  });

  it('un refus du serveur reste dans la boîte, en français', async () => {
    fakeServer([
      { method: 'POST', match: /validate$/, status: 409, body: { message: 'Mode non pris en charge.', code: 'cotisation_mode_unsupported' } },
      { match: 'membership/payments', body: [payment()] },
    ]);
    const user = userEvent.setup();
    const { value } = renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Valider' }));
    await user.click(screen.getByRole('button', { name: 'Valider et émettre le reçu' }));

    await screen.findByText(/mode de cotisation de votre association n’est pas encore pris en charge/);
    expect(value.markModeUnsupported).toHaveBeenCalled();
  });
});

describe('B4 — rejeter (R9)', () => {
  it('refuse un motif de moins de 10 caractères, sans appeler l’API', async () => {
    const server = fakeServer([{ match: 'membership/payments', body: [payment()] }]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Rejeter' }));

    const dialog = screen.getByRole('dialog', { name: 'Rejeter cette déclaration ?' });
    expect(within(dialog).getByText('TEST-F1')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Motif du rejet/), '  trop  ');
    await user.click(within(dialog).getByRole('button', { name: 'Rejeter la déclaration' }));

    expect(within(dialog).getByText(/10 caractères au moins/)).toBeInTheDocument();
    expect(calls(server, 'POST')).toHaveLength(0);
  });

  it('envoie le motif, puis retire la ligne de la file', async () => {
    const reason = 'Référence introuvable chez Orange Money.';
    const server = fakeServer([
      { method: 'POST', match: /reject$/, body: payment({ status: 'rejected', rejection_reason: reason }) },
      { match: 'membership/payments', body: [payment()] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Rejeter' }));
    await user.type(screen.getByLabelText(/Motif du rejet/), reason);
    await user.click(screen.getByRole('button', { name: 'Rejeter la déclaration' }));

    await screen.findByText(/rejetée\. Le membre verra le motif/);
    const posts = calls(server, 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/reject$/);
    expect(JSON.parse(posts[0]?.init.body as string)).toEqual({ reason });
  });
});
