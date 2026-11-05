/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/m/aaaa" }
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberPage, referralCount } from '@/app/m/[token]/MemberPage';
import { cardLines, MemberCardView } from '@/components/card/MemberCardView';
import { phoneDigits, spacedPhone, whatsappNumber } from '@/lib/phone';
import { whatsappLink } from '@/lib/whatsapp';
import { DUE, fakeResponse, memberCard, payload, TOKEN } from './fixtures';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWith(body: unknown) {
  fetchMock.mockResolvedValue(fakeResponse(200, body));
  return render(<MemberPage token={TOKEN} />);
}

const CANDIDATE = { name: 'Babacar Kane', first_name: 'Babacar', last_name: 'Kane' };

describe('§17.5 — la page d’une personne qui a demandé à adhérer', () => {
  it('under_review : « en cours d’examen », la date, rien à payer, AUCUN bouton de paiement', async () => {
    renderWith(
      payload({
        member: CANDIDATE,
        standing: { is_up_to_date: false, covered_until: null },
        application: { status: 'under_review', submitted_at: '2026-11-04T09:12:33+00:00', rejection_reason: null },
      }),
    );
    const block = await screen.findByTestId('application-review');
    expect(screen.getByRole('heading', { name: 'Bonjour Babacar' })).toBeInTheDocument();
    expect(block).toHaveTextContent('Votre demande est en cours d’examen.');
    expect(block).toHaveTextContent('Vous avez demandé à adhérer le 4 novembre 2026.');
    expect(block).toHaveTextContent(
      'Vous n’avez rien à payer pour l’instant : l’association vous répondra sur WhatsApp.',
    );
    expect(screen.queryByRole('button', { name: /J’ai payé/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Où payer')).not.toBeInTheDocument();
  });

  it('awaiting_first_payment : « Votre première cotisation », « vous serez membre dès qu’elle sera reçue », puis le paiement', async () => {
    renderWith(
      payload({
        member: CANDIDATE,
        standing: { is_up_to_date: false, covered_until: null },
        due: DUE,
        application: { status: 'awaiting_first_payment', submitted_at: '2026-11-04T09:12:33+00:00', rejection_reason: null },
      }),
    );
    const due = await screen.findByTestId('due-block');
    expect(due).toHaveTextContent('Votre première cotisation');
    expect(due).not.toHaveTextContent('Votre cotisation à payer');
    expect(within(due).getByTestId('first-payment')).toHaveTextContent('Vous serez membre dès qu’elle sera reçue.');
    expect(screen.getByRole('button', { name: 'J’ai payé : le signaler' })).toBeInTheDocument();
    expect(screen.getByLabelText('Où payer')).toBeInTheDocument();
  });

  it('un MEMBRE garde « Votre cotisation à payer » (application: null)', async () => {
    renderWith(payload({ standing: { is_up_to_date: false, covered_until: null }, due: DUE, application: null }));
    expect(await screen.findByTestId('due-block')).toHaveTextContent('Votre cotisation à payer');
    expect(screen.queryByTestId('first-payment')).not.toBeInTheDocument();
  });

  it('rejected : « n’a pas été acceptée », le message de l’association tel quel, et rien d’autre', async () => {
    renderWith(
      payload({
        member: CANDIDATE,
        standing: { is_up_to_date: false, covered_until: null },
        receipts: [],
        application: {
          status: 'rejected',
          submitted_at: '2026-11-04T09:12:33+00:00',
          rejection_reason: 'Cette association n’accepte que les techniciens en exercice.',
        },
      }),
    );
    const block = await screen.findByTestId('application-rejected');
    expect(block).toHaveTextContent('Votre demande n’a pas été acceptée.');
    expect(block).toHaveTextContent('Cette association n’accepte que les techniciens en exercice.');
    expect(block).toHaveTextContent('Pour en parler, contactez l’association.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Gardez le message/)).not.toBeInTheDocument();
  });
});

describe('§17.8 — « Faites venir quelqu’un »', () => {
  const REFERRAL = {
    invite_url: 'https://demo-asso.adhera.africa/adherer?parrain=K7PQ4RMT',
    share_text:
      'Je suis membre de Association Démo.\nRejoins-nous en déposant ta demande ici :\nhttps://demo-asso.adhera.africa/adherer?parrain=K7PQ4RMT',
    joined_count: 3,
    pending_count: 1,
  };

  it('le message est share_text TEL QUE SERVI, et le compteur compte des personnes', async () => {
    renderWith(payload({ referral: REFERRAL }));
    const block = await screen.findByTestId('referral');
    expect(within(block).getByRole('heading', { name: 'Faites venir quelqu’un' })).toBeInTheDocument();
    expect(within(block).getByTestId('referral-count')).toHaveTextContent(
      '3 personnes sont venues grâce à vous, et 1 demande en cours d’examen.',
    );
    const link = within(block).getByRole('link', { name: 'Inviter par WhatsApp' });
    const href = new URL(link.getAttribute('href') as string);
    expect(href.origin + href.pathname).toBe('https://wa.me/');
    expect(href.searchParams.get('text')).toBe(REFERRAL.share_text);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(block).not.toHaveTextContent(/filleul|FCFA/);
  });

  it('pas de referral (fonctionnalité éteinte, ou non actif) : aucun bloc', async () => {
    renderWith(payload({ referral: null }));
    await screen.findByRole('heading', { name: /Bonjour/ });
    expect(screen.queryByTestId('referral')).not.toBeInTheDocument();
  });

  it('les phrases du compteur', () => {
    const r = (joined: number, pending: number) => referralCount({ ...REFERRAL, joined_count: joined, pending_count: pending });
    expect(r(0, 0)).toBeNull();
    expect(r(1, 0)).toBe('1 personne est venue grâce à vous. Merci !');
    expect(r(0, 2)).toBe('2 demandes en cours d’examen, grâce à vous.');
  });
});

describe('§20.7 — les lignes de la carte', () => {
  it('deux lignes au plus, sous le type de membre, jamais une ligne vide', () => {
    render(
      <MemberCardView
        card={memberCard({
          lines: [
            { label: 'Spécialité', value: 'Anesthésie-réanimation' },
            { label: 'Structure où vous exercez', value: 'Hôpital Principal de Dakar' },
          ],
        })}
      />,
    );
    const lines = screen.getByTestId('card-lines');
    expect(lines).toHaveTextContent('SpécialitéAnesthésie-réanimation');
    expect(lines).toHaveTextContent('Structure où vous exercezHôpital Principal de Dakar');
    expect(
      cardLines(
        memberCard({
          lines: [
            { label: 'A', value: 'un' },
            { label: 'B', value: ' ' },
            { label: 'C', value: 'trois' },
            { label: 'D', value: 'quatre' },
          ],
        }),
      ).map((l) => l.label),
    ).toEqual(['A', 'C']);
  });

  it('`[]` ou absente : rien', () => {
    render(<MemberCardView card={memberCard({ lines: [] })} />);
    expect(screen.queryByTestId('card-lines')).not.toBeInTheDocument();
    cleanup();
    render(<MemberCardView card={memberCard()} />);
    expect(screen.queryByTestId('card-lines')).not.toBeInTheDocument();
  });
});

describe('F6 § 6 — un téléphone se lit espacé, se copie en chiffres', () => {
  it('espace les numéros sénégalais, garde les autres tels quels', () => {
    expect(spacedPhone('761234567')).toBe('76 123 45 67');
    expect(spacedPhone('76 123 45 67')).toBe('76 123 45 67');
    expect(spacedPhone('+221771234567')).toBe('+221 77 123 45 67');
    expect(spacedPhone('00221 77 123 45 67')).toBe('+221 77 123 45 67');
    expect(spacedPhone('+33 6 12 34 56 78')).toBe('+33 6 12 34 56 78');
    expect(spacedPhone('Wave Business')).toBe('Wave Business');
    expect(phoneDigits('76 123 45 67')).toBe('761234567');
  });

  it('le numéro WhatsApp : l’indicatif 221 pour 9 chiffres, rien de deviné sinon', () => {
    expect(whatsappNumber('77 000 00 22')).toBe('221770000022');
    expect(whatsappNumber('+221 77 000 00 22')).toBe('221770000022');
    expect(whatsappNumber('+33 6 12 34 56 78')).toBe('33612345678');
    expect(whatsappNumber('12 34')).toBeNull();
    expect(whatsappLink('Bonjour', '12 34')).toBe('https://wa.me/?text=Bonjour');
  });

  it('les numéros de paiement de la page du membre : espacés, « Copier » copie les chiffres', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderWith(
      payload({
        organisation: {
          name: 'Association Démo',
          logo_url: null,
          om_merchant_number: '771234567',
          wave_merchant_number: '76 123 45 67',
          payment_instructions: null,
        },
        standing: { is_up_to_date: false, covered_until: null },
        due: DUE,
      }),
    );
    const where = await screen.findByLabelText('Où payer');
    expect(within(where).getByText('77 123 45 67')).toBeInTheDocument();
    expect(within(where).getByText('76 123 45 67')).toBeInTheDocument();
    within(where).getByRole('button', { name: 'Copier le numéro Wave' }).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('761234567'));
  });
});
