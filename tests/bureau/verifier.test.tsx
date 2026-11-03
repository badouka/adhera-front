/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/a-verifier" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VerifierPage, { reasonPreview } from '@/app/bureau/a-verifier/page';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import {
  calls,
  fakeResponse,
  fakeServer,
  memberDetail,
  payment,
  POSSIBLE_DUPLICATE,
  renderInBureau,
  SESSION,
  share,
} from './fixtures';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** L'onglet ouvert au toucher (`window.open`), dirigé ensuite vers `wa.me`. */
function fakeTab() {
  const tab = { opener: {}, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  return { tab, open };
}

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

const NDEYE = payment({
  id: 'p-ndeye',
  member_id: 'm-ndeye',
  member_name: 'Ndeye Thiam',
  amount: 25001,
  amount_formatted: '25 000 FCFA',
  method: 'wave',
  method_label: 'Wave',
  reference: 'T-4C7A-29F1',
  paid_on: '2026-11-03',
  has_proof: true,
});

const MOUSSA = payment({
  id: 'p-moussa',
  member_id: 'm-moussa',
  member_name: 'Moussa Camara',
  amount: 20001,
  amount_formatted: '20 000 FCFA',
  method: 'om',
  method_label: 'Orange Money',
  reference: null,
  paid_on: '2026-11-02',
  has_proof: false,
});

const NDEYE_MEMBER = memberDetail({ id: 'm-ndeye', name: 'Ndeye Thiam', first_name: 'Ndeye', last_name: 'Thiam', phone: '77 000 00 08' });
const MOUSSA_MEMBER = memberDetail({ id: 'm-moussa', name: 'Moussa Camara', first_name: 'Moussa', last_name: 'Camara', phone: '77 000 00 09' });

function queue(extra: Parameters<typeof fakeServer>[0] = []) {
  return fakeServer([
    ...extra,
    { match: 'membership/payments?status=declared', body: [NDEYE, MOUSSA] },
    { match: 'membership/members/m-ndeye', body: NDEYE_MEMBER },
    { match: 'membership/members/m-moussa', body: MOUSSA_MEMBER },
  ]);
}

describe('Écran 2 — un paiement à la fois', () => {
  it('« Paiement 1 sur 2 » : le nom, « dit avoir payé », le montant, le moyen, la date, le n° de transaction', async () => {
    const server = queue();
    renderInBureau(<VerifierPage />);
    const card = await screen.findByTestId('payment-card');
    expect(screen.getByTestId('position')).toHaveTextContent('Paiement 1 sur 2');
    expect(within(card).getByRole('heading', { name: 'Ndeye Thiam' })).toBeInTheDocument();
    expect(card).toHaveTextContent('dit avoir payé');
    // R1 : le montant tel que servi, jamais le brut.
    expect(card).toHaveTextContent('25 000 FCFA');
    expect(document.body.textContent).not.toContain('25001');
    expect(card).toHaveTextContent('Wave');
    expect(card).toHaveTextContent('3 novembre 2026');
    expect(card).toHaveTextContent('T-4C7A-29F1');
    // Un seul à la fois : le second n'est pas à l'écran.
    expect(screen.queryByText('Moussa Camara')).not.toBeInTheDocument();
    expect(calls(server)[0]?.url).toBe(
      'https://api.eventflow.africa/api/v1/admin/membership/payments?status=declared',
    );
  });

  it('la preuve AVANT les deux décisions, de même largeur', async () => {
    queue();
    renderInBureau(<VerifierPage />);
    const proof = await screen.findByRole('button', { name: 'Voir la preuve envoyée' });
    const yes = screen.getByRole('button', { name: 'J’ai bien reçu cet argent' });
    const no = screen.getByRole('button', { name: 'Je n’ai pas reçu cet argent' });
    expect(proof.compareDocumentPosition(yes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(yes.compareDocumentPosition(no) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(yes.className).toContain('w-full');
    expect(no.className).toContain('w-full');
  });

  it('sans preuve : la phrase, pas un bouton qui échoue', async () => {
    fakeServer([
      { match: 'membership/payments?status=declared', body: [MOUSSA] },
      { match: 'membership/members/m-moussa', body: MOUSSA_MEMBER },
    ]);
    renderInBureau(<VerifierPage />);
    expect(await screen.findByTestId('no-proof')).toHaveTextContent('Aucune preuve envoyée');
    expect(screen.queryByRole('button', { name: 'Voir la preuve envoyée' })).not.toBeInTheDocument();
  });

  it('« Voir la preuve envoyée » demande le lien signé AU TOUCHER et l’ouvre tel quel', async () => {
    const url = 'https://api.eventflow.africa/api/v1/membership/proofs/x?tenant=demo-asso&signature=abc';
    const server = queue([{ match: 'membership/payments/p-ndeye/proof-url', body: { download_url: url } }]);
    const { tab } = fakeTab();
    const user = userEvent.setup();
    renderInBureau(<VerifierPage />);
    await user.click(await screen.findByRole('button', { name: 'Voir la preuve envoyée' }));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(url));
    expect(calls(server).filter((c) => c.url.includes('proof-url'))).toHaveLength(1);
  });

  it('file vide : « Rien à vérifier »', async () => {
    fakeServer([{ match: 'membership/payments?status=declared', body: [] }]);
    renderInBureau(<VerifierPage />);
    expect(await screen.findByTestId('queue-empty')).toHaveTextContent('Rien à vérifier');
    expect(screen.queryByRole('button', { name: 'J’ai bien reçu cet argent' })).not.toBeInTheDocument();
  });

  it('« Passer au paiement suivant » montre le second sans rien décider', async () => {
    const server = queue();
    const user = userEvent.setup();
    renderInBureau(<VerifierPage />);
    await user.click(await screen.findByRole('button', { name: 'Passer au paiement suivant' }));
    expect(await screen.findByRole('heading', { name: 'Moussa Camara' })).toBeInTheDocument();
    expect(screen.getByTestId('position')).toHaveTextContent('Paiement 2 sur 2');
    expect(calls(server, 'POST')).toHaveLength(0);
  });

  it('mode de cotisation non pris en charge : pas de « J’ai bien reçu cet argent »', async () => {
    queue();
    renderInBureau(<VerifierPage />, { modeSupported: false });
    await screen.findByTestId('payment-card');
    expect(screen.queryByRole('button', { name: 'J’ai bien reçu cet argent' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Je n’ai pas reçu cet argent' })).toBeInTheDocument();
  });
});

describe('Écran 2 → 6 — « J’ai bien reçu cet argent »', () => {
  it('accepte (`validate`, sans `confirm_duplicate`), puis « C’est enregistré » et le reçu par WhatsApp', async () => {
    const accepted = {
      ...NDEYE,
      status: 'validated',
      receipt: { id: 'r-1', reference: 'REC-2026-11AA22BB' },
      share: share({ phone: '77 000 00 08', whatsapp_url: 'https://wa.me/221770000008?text=Re%C3%A7u' }),
    };
    const server = queue([
      { method: 'POST', match: 'membership/payments/p-ndeye/validate', body: accepted },
    ]);
    const { value } = renderInBureau(<VerifierPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'J’ai bien reçu cet argent' }));

    const done = await screen.findByTestId('recorded');
    expect(within(done).getByRole('heading', { name: 'C’est enregistré' })).toBeInTheDocument();
    expect(done).toHaveTextContent('Ndeye Thiam a payé 25 000 FCFA par Wave.');
    expect(done).toHaveTextContent('Reçu n° REC-2026-11AA22BB');
    expect(screen.getByTestId('wa-receipt')).toHaveAttribute(
      'href',
      'https://wa.me/221770000008?text=Re%C3%A7u',
    );
    const [post] = calls(server, 'POST');
    expect(JSON.parse(post?.init.body as string)).toEqual({});
    expect(value.refreshToVerify).toHaveBeenCalled();
    // Le suivant attend : un toucher pour y aller.
    expect(screen.getByRole('button', { name: 'Vérifier le paiement suivant' })).toBeInTheDocument();
  });

  it('`share: null` : « … n’a pas de téléphone », aucun bouton WhatsApp', async () => {
    queue([
      {
        method: 'POST',
        match: 'membership/payments/p-ndeye/validate',
        body: { ...NDEYE, status: 'validated', receipt: { id: 'r-1', reference: 'REC-1' }, share: null },
      },
      { match: 'membership/members/m-ndeye', body: { ...NDEYE_MEMBER, phone: null } },
    ]);
    const user = userEvent.setup();
    renderInBureau(<VerifierPage />);
    await user.click(await screen.findByRole('button', { name: 'J’ai bien reçu cet argent' }));
    expect(await screen.findByTestId('no-phone')).toHaveTextContent(
      'n’a pas de téléphone : impossible d’envoyer le reçu par WhatsApp.',
    );
    expect(screen.queryByTestId('wa-receipt')).not.toBeInTheDocument();
  });
});

describe('Écran 5 — le même chemin pour `validate`', () => {
  it('409 possible_duplicate → « Est-ce le même paiement ? » ; « Oui » n’envoie rien', async () => {
    const server = queue([
      { method: 'POST', match: 'membership/payments/p-ndeye/validate', status: 409, body: POSSIBLE_DUPLICATE },
    ]);
    const user = userEvent.setup();
    const { value } = renderInBureau(<VerifierPage />);
    await user.click(await screen.findByRole('button', { name: 'J’ai bien reçu cet argent' }));

    const question = await screen.findByTestId('duplicate');
    expect(within(question).getByRole('heading', { name: 'Est-ce le même paiement ?' })).toBeInTheDocument();
    expect(question).toHaveTextContent('Déjà enregistré');
    expect(question).toHaveTextContent('10 000 FCFA');
    // L'heure de SAISIE, dans le fuseau de l'association (UTC+0 à Dakar).
    expect(question).toHaveTextContent('à 20 h 37');
    expect(question).toHaveTextContent('REC-2026-E1EADA5D');
    expect(value.setBack).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'Retour' }));

    await user.click(within(question).getByRole('button', { name: /Oui, c’est le même/ }));
    expect(await screen.findByTestId('payment-card')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Rien n’a été enregistré.');
    expect(calls(server, 'POST')).toHaveLength(1);
  });

  it('« Non, … a payé deux fois » rejoue `validate` avec confirm_duplicate: true', async () => {
    const server = fakeServer([
      { match: 'membership/payments?status=declared', body: [NDEYE] },
      { match: 'membership/members/m-ndeye', body: NDEYE_MEMBER },
    ]);
    let posts = 0;
    server.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        return posts === 1
          ? fakeResponse(409, POSSIBLE_DUPLICATE)
          : fakeResponse(200, { ...NDEYE, status: 'validated', receipt: { id: 'r', reference: 'REC-2' }, share: share() });
      }
      if (url.includes('status=declared')) return fakeResponse(200, [NDEYE]);
      return fakeResponse(200, NDEYE_MEMBER);
    });
    const user = userEvent.setup();
    renderInBureau(<VerifierPage />);
    await user.click(await screen.findByRole('button', { name: 'J’ai bien reçu cet argent' }));
    await user.click(await screen.findByRole('button', { name: /Non, Ndeye a payé deux fois/ }));
    await screen.findByTestId('recorded');
    const bodies = calls(server, 'POST').map((c) => JSON.parse(c.init.body as string));
    expect(bodies).toEqual([{}, { confirm_duplicate: true }]);
  });
});

describe('Écran 3 — « Je n’ai pas reçu cet argent »', () => {
  it('trois raisons toutes prêtes en gros boutons radio, et « Une autre raison (je l’écris) »', async () => {
    queue();
    const user = userEvent.setup();
    renderInBureau(<VerifierPage />);
    await user.click(await screen.findByRole('button', { name: 'Je n’ai pas reçu cet argent' }));
    const screen3 = await screen.findByTestId('refuse');
    expect(within(screen3).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([
      'Je ne trouve pas ce paiement',
      'Le montant n’est pas le bon',
      'La preuve est illisible',
      'Une autre raison (je l’écris)',
    ]);
    expect(within(screen3).getByRole('radio', { name: 'Je ne trouve pas ce paiement' })).toBeChecked();
    // L'aperçu : ce que Ndeye lira, avec le moyen et le montant SERVIS.
    expect(screen.getByTestId('preview')).toHaveTextContent('Le message que Ndeye recevra');
    expect(screen.getByTestId('preview')).toHaveTextContent(
      'Le trésorier ne trouve pas votre paiement Wave de 25 000 FCFA.',
    );
  });

  it.each([
    ['not_found', 'Je ne trouve pas ce paiement'],
    ['wrong_amount', 'Le montant n’est pas le bon'],
    ['unreadable_proof', 'La preuve est illisible'],
  ] as const)('« %s » : `reason_code` seul, puis WhatsApp s’ouvre sur `share.whatsapp_url`', async (code, label) => {
    const refused = { ...NDEYE, status: 'rejected', share: share({ whatsapp_url: `https://wa.me/221770000008?text=${code}` }) };
    const server = queue([{ method: 'POST', match: 'membership/payments/p-ndeye/reject', body: refused }]);
    const { tab, open } = fakeTab();
    const user = userEvent.setup();
    const { value } = renderInBureau(<VerifierPage />);
    await user.click(await screen.findByRole('button', { name: 'Je n’ai pas reçu cet argent' }));
    await user.click(screen.getByRole('radio', { name: label }));
    await user.click(screen.getByRole('button', { name: 'Refuser et prévenir par WhatsApp' }));

    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(`https://wa.me/221770000008?text=${code}`));
    // L'onglet a été ouvert AU TOUCHER, coupé de `opener`.
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    const [post] = calls(server, 'POST');
    expect(JSON.parse(post?.init.body as string)).toEqual({ reason_code: code });
    // Retour à la file : le suivant, et le compteur relu.
    expect(await screen.findByRole('heading', { name: 'Moussa Camara' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Paiement refusé. Ndeye le verra sur sa page.');
    expect(value.refreshToVerify).toHaveBeenCalled();
  });

  it('le texte libre : 10 caractères au moins, puis envoyé en `reason`', async () => {
    const server = queue([
      { method: 'POST', match: 'membership/payments/p-ndeye/reject', body: { ...NDEYE, status: 'rejected', share: share() } },
    ]);
    fakeTab();
    const user = userEvent.setup();
    renderInBureau(<VerifierPage />);
    await user.click(await screen.findByRole('button', { name: 'Je n’ai pas reçu cet argent' }));
    await user.click(screen.getByRole('radio', { name: 'Une autre raison (je l’écris)' }));
    const field = screen.getByLabelText('Votre message');
    await user.type(field, 'Trop court');
    await user.clear(field);
    await user.type(field, 'Court');
    await user.click(screen.getByRole('button', { name: 'Refuser et prévenir par WhatsApp' }));
    expect(await screen.findByText(/10 caractères au moins/)).toBeInTheDocument();
    expect(calls(server, 'POST')).toHaveLength(0);

    await user.clear(field);
    await user.type(field, 'Je ne vois rien sur le relevé de ce jour.');
    // L'aperçu suit la frappe.
    expect(screen.getByTestId('preview')).toHaveTextContent('Je ne vois rien sur le relevé de ce jour.');
    await user.click(screen.getByRole('button', { name: 'Refuser et prévenir par WhatsApp' }));
    await waitFor(() => expect(calls(server, 'POST')).toHaveLength(1));
    expect(JSON.parse(calls(server, 'POST')[0]?.init.body as string)).toEqual({
      reason: 'Je ne vois rien sur le relevé de ce jour.',
    });
  });

  it('« Refuser sans envoyer de message » : le refus seul, aucun onglet', async () => {
    const server = queue([
      { method: 'POST', match: 'membership/payments/p-ndeye/reject', body: { ...NDEYE, status: 'rejected', share: share() } },
    ]);
    const { open } = fakeTab();
    const user = userEvent.setup();
    renderInBureau(<VerifierPage />);
    await user.click(await screen.findByRole('button', { name: 'Je n’ai pas reçu cet argent' }));
    await user.click(screen.getByRole('button', { name: 'Refuser sans envoyer de message' }));
    await waitFor(() => expect(calls(server, 'POST')).toHaveLength(1));
    expect(open).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Paiement refusé.');
  });

  it('`share: null` après le refus : l’onglet se referme, et la phrase « pas de téléphone »', async () => {
    queue([
      { method: 'POST', match: 'membership/payments/p-ndeye/reject', body: { ...NDEYE, status: 'rejected', share: null } },
    ]);
    const { tab } = fakeTab();
    const user = userEvent.setup();
    renderInBureau(<VerifierPage />);
    await user.click(await screen.findByRole('button', { name: 'Je n’ai pas reçu cet argent' }));
    await user.click(screen.getByRole('button', { name: 'Refuser et prévenir par WhatsApp' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ndeye n’a pas de téléphone : il ou elle verra le motif sur sa page.',
    );
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it('un membre sans téléphone sur sa fiche : la phrase d’avance, et « Refuser ce paiement »', async () => {
    queue([{ match: 'membership/members/m-ndeye', body: { ...NDEYE_MEMBER, phone: null } }]);
    const user = userEvent.setup();
    renderInBureau(<VerifierPage />);
    await user.click(await screen.findByRole('button', { name: 'Je n’ai pas reçu cet argent' }));
    expect(await screen.findByTestId('refuse-no-phone')).toHaveTextContent(
      'Ndeye n’a pas de téléphone : il ou elle verra le motif sur sa page.',
    );
    expect(screen.getByRole('button', { name: 'Refuser ce paiement' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refuser et prévenir par WhatsApp' })).not.toBeInTheDocument();
  });

  it('un refus du serveur s’affiche tel quel (il parle français)', async () => {
    queue([
      {
        method: 'POST',
        match: 'membership/payments/p-ndeye/reject',
        status: 422,
        body: {
          message: 'Raison inconnue.',
          errors: { reason_code: ['Raison inconnue. Les raisons possibles sont « not_found », « wrong_amount », « unreadable_proof ».'] },
        },
      },
    ]);
    fakeTab();
    const user = userEvent.setup();
    renderInBureau(<VerifierPage />);
    await user.click(await screen.findByRole('button', { name: 'Je n’ai pas reçu cet argent' }));
    await user.click(screen.getByRole('button', { name: 'Refuser et prévenir par WhatsApp' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Les raisons possibles sont');
  });

  it('reasonPreview : l’aperçu seulement, composé des libellés servis', () => {
    expect(reasonPreview('wrong_amount', NDEYE, '')).toBe(
      'Le montant reçu ne correspond pas à votre paiement Wave de 25 000 FCFA. Vérifiez la somme envoyée, puis signalez-le à nouveau sur votre page.',
    );
    expect(reasonPreview('unreadable_proof', NDEYE, '')).toBe(
      'La preuve de votre paiement Wave de 25 000 FCFA est illisible. Envoyez une capture plus nette depuis votre page.',
    );
    expect(reasonPreview('other', NDEYE, '  ')).toBe('…');
  });
});
