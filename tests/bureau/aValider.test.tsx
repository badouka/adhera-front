/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AValiderPage from '@/app/bureau/a-valider/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import { calls, fakeServer, fullText, payment, renderInBureau, SESSION } from './fixtures';

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
  it('« Encaisser » est en tête de l’accueil', async () => {
    fakeServer([{ match: 'membership/payments', body: [] }]);
    renderInBureau(<AValiderPage />);
    const encaisser = await screen.findByRole('link', { name: 'Encaisser un paiement' });
    expect(encaisser).toHaveAttribute('href', '/bureau/encaisser');
    // Avant tout le reste de la page.
    const title = screen.getByRole('heading', { name: 'À valider' });
    expect(encaisser.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('chaque ligne : nom, montant, mode, référence, date, et « Reçu ✓ »', async () => {
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
    expect(screen.getByText('payé le 29 octobre 2026')).toBeInTheDocument();
    expect(
      screen.getByText('Cotisation du 1er octobre 2026 au 30 septembre 2027'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reçu ✓' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voir la capture' })).toBeInTheDocument();
  });

  it('sans référence : « sans référence », et sans capture : pas de bouton', async () => {
    fakeServer([{ match: 'membership/payments', body: [payment({ reference: null, has_proof: false })] }]);
    renderInBureau(<AValiderPage />);
    await screen.findByText('Moussa Ndiaye (test)');
    expect(screen.getByText('sans référence')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /capture/ })).not.toBeInTheDocument();
  });

  it('état vide : « Aucun versement à valider. »', async () => {
    fakeServer([{ match: 'membership/payments', body: [] }]);
    renderInBureau(<AValiderPage />);
    await screen.findByText('Aucun versement à valider.');
  });

  it('la capture : lien signé demandé AU CLIC, ouvert tel quel, sans opener', async () => {
    const signed = 'https://api.eventflow.africa/api/v1/membership/proofs/p?tenant=demo-asso&signature=abc';
    const server = fakeServer([
      { match: /proof-url$/, body: { download_url: signed, expires_in_minutes: 60, mime_type: 'image/png' } },
      { match: 'membership/payments', body: [payment()] },
    ]);
    const tab = { opener: {} as unknown, closed: false, location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);

    await screen.findByText('Moussa Ndiaye (test)');
    // Rien n'est demandé au chargement : le lien périme en 60 minutes.
    expect(calls(server).some((c) => c.url.includes('proof-url'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Voir la capture' }));

    // `inline` côté serveur : ouverte dans un nouvel onglet, lien intact.
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
    expect(screen.queryByRole('button', { name: 'Reçu ✓' })).not.toBeInTheDocument();
  });

  it('onglet « Refusés » : le motif, qui, quand', async () => {
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

    await user.click(screen.getByRole('tab', { name: 'Refusés' }));

    await screen.findByText('Refusé le 29 octobre 2026 par Trésorier Démo');
    expect(screen.getByText('Motif : Référence introuvable chez Orange Money.')).toBeInTheDocument();
  });

  it('mode de cotisation non pris en charge : aucun bouton « Reçu ✓ »', async () => {
    fakeServer([{ match: 'membership/payments', body: [payment()] }]);
    renderInBureau(<AValiderPage />, { modeSupported: false });
    await screen.findByText('Moussa Ndiaye (test)');
    expect(screen.queryByRole('button', { name: 'Reçu ✓' })).not.toBeInTheDocument();
  });
});

describe('B3 — « Reçu ✓ » : la confirmation légère (R9)', () => {
  it('« Reçu ✓ » ouvre un panneau, pas une boîte modale ; « Confirmer » valide', async () => {
    const server = fakeServer([
      { method: 'POST', match: /validate$/, body: VALIDATED },
      { match: 'membership/payments', body: [payment()] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Reçu ✓' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const panel = screen.getByRole('group', { name: 'Confirmer la réception' });
    // Le récapitulatif tient sur une ligne : nom, montant formaté, mode, référence.
    expect(within(panel).getByTestId('recap').textContent).toBe(
      'Moussa Ndiaye (test) — 100 000 FCFA — Wave — TEST-F1 — payé le 29 octobre 2026 — un reçu sera émis',
    );
    // Un seul bouton confirme, et il a le focus : un toucher de plus.
    const confirm = within(panel).getByRole('button', { name: 'Confirmer' });
    expect(document.activeElement).toBe(confirm);
    expect(calls(server, 'POST')).toHaveLength(0);

    await user.click(confirm);

    await screen.findByText(/Reçu REC-2026-CB4A73AE émis\./);
    const posts = calls(server, 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(
      'https://api.eventflow.africa/api/v1/admin/membership/payments/01a1893f-d5b7-707e-9a64-6f65cb4a73ae/validate',
    );
    expect(JSON.parse(posts[0]?.init.body as string)).toEqual({ paid_on: '2026-10-29' });
    expect(screen.getByRole('button', { name: 'Télécharger le reçu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reçu ✓' })).not.toBeInTheDocument();
  });

  it('une autre date de paiement reste possible, repliée', async () => {
    const server = fakeServer([
      { method: 'POST', match: /validate$/, body: VALIDATED },
      { match: 'membership/payments', body: [payment()] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Reçu ✓' }));
    expect(screen.queryByLabelText('Date du paiement')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Autre date de paiement ?' }));
    const date = screen.getByLabelText('Date du paiement') as HTMLInputElement;
    await user.clear(date);
    await user.type(date, '2026-10-28');
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(calls(server, 'POST')).toHaveLength(1));
    expect(JSON.parse(calls(server, 'POST')[0]?.init.body as string)).toEqual({ paid_on: '2026-10-28' });
  });

  it('sans reçu dans la réponse : ni promesse, ni lien', async () => {
    fakeServer([
      { method: 'POST', match: /validate$/, body: { ...VALIDATED, receipt: null } },
      { match: 'membership/payments', body: [payment()] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Reçu ✓' }));
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    await screen.findByText('Paiement confirmé.');
    expect(screen.queryByText(/Reçu .* émis/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Télécharger le reçu' })).not.toBeInTheDocument();
  });

  it('« Annuler » ne valide rien', async () => {
    const server = fakeServer([{ match: 'membership/payments', body: [payment()] }]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Reçu ✓' }));
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('group', { name: 'Confirmer la réception' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reçu ✓' })).toBeInTheDocument();
    expect(calls(server, 'POST')).toHaveLength(0);
  });

  it('un refus du serveur reste dans le panneau, en français', async () => {
    fakeServer([
      { method: 'POST', match: /validate$/, status: 409, body: { message: 'Mode non pris en charge.', code: 'cotisation_mode_unsupported' } },
      { match: 'membership/payments', body: [payment()] },
    ]);
    const user = userEvent.setup();
    const { value } = renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Reçu ✓' }));
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    await screen.findByText(/mode de cotisation de votre association n’est pas encore pris en charge/);
    expect(value.markModeUnsupported).toHaveBeenCalled();
  });
});

describe('B4 — refuser', () => {
  it('refuse un motif de moins de 10 caractères, sans appeler l’API', async () => {
    const server = fakeServer([{ match: 'membership/payments', body: [payment()] }]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Refuser' }));

    await user.type(screen.getByLabelText(/Motif du refus/), '  trop  ');
    await user.click(screen.getByRole('button', { name: 'Refuser le paiement' }));

    expect(screen.getByText(/10 caractères au moins/)).toBeInTheDocument();
    expect(calls(server, 'POST')).toHaveLength(0);
  });

  it('le texte d’aide dit la vérité : le membre lira le motif sur sa page', async () => {
    fakeServer([{ match: 'membership/payments', body: [payment()] }]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Refuser' }));

    const reason = screen.getByLabelText(/Motif du refus/);
    const hint = screen.getByText('Ce motif sera affiché au membre sur sa page.');
    expect(reason.getAttribute('aria-describedby')).toContain(hint.id);
    expect(document.body.textContent).not.toMatch(/ne s’affiche pas sur la page du membre/);
  });

  it('envoie le motif, retire la ligne, et annonce que le membre le verra', async () => {
    const reason = 'Référence introuvable chez Orange Money.';
    const server = fakeServer([
      { method: 'POST', match: /reject$/, body: payment({ status: 'rejected', rejection_reason: reason }) },
      { match: 'membership/payments', body: [payment()] },
    ]);
    const user = userEvent.setup();
    renderInBureau(<AValiderPage />);
    await user.click(await screen.findByRole('button', { name: 'Refuser' }));
    await user.type(screen.getByLabelText(/Motif du refus/), reason);
    await user.click(screen.getByRole('button', { name: 'Refuser le paiement' }));

    await screen.findByText(
      fullText('Paiement refusé : Moussa Ndiaye (test), 100 000 FCFA. Le membre verra le motif sur sa page et pourra signaler à nouveau son paiement.'),
    );
    const posts = calls(server, 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/reject$/);
    expect(JSON.parse(posts[0]?.init.body as string)).toEqual({ reason });
    expect(screen.queryByRole('button', { name: 'Reçu ✓' })).not.toBeInTheDocument();
  });
});
