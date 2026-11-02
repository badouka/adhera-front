/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/m/aaaa" }
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemberCardView } from '@/components/card/MemberCardView';
import { makeQrMatrix, qrPath } from '@/components/card/QrCode';
import { memberCard } from './fixtures';

afterEach(cleanup);

const BRANDS = /adhera|eventflow|digissol/i;

describe('F4 § 1.2 — la carte de membre', () => {
  it('porte le logo, l’association, le nom, la catégorie, le numéro, l’adhésion, le statut et le QR', async () => {
    render(<MemberCardView card={memberCard()} />);
    expect(screen.getByTestId('card-logo')).toHaveAttribute(
      'src',
      'https://api.eventflow.africa/storage-tenantdemo-asso/membership/logo-1a2b3c4d.png',
    );
    expect(screen.getByText('Cercle des Administrateurs Publics')).toBeInTheDocument();
    expect(screen.getByText('Aminata Diop')).toBeInTheDocument();
    expect(screen.getByText('Membre actif')).toBeInTheDocument();
    expect(screen.getByTestId('card-number')).toHaveTextContent('N° 0001');
    expect(screen.getByTestId('card-since')).toHaveTextContent('Membre depuis le 10 mars 2026');
    expect(screen.getByTestId('card-standing')).toHaveTextContent('À jour');
    expect(screen.getByTestId('card-standing')).toHaveAttribute('data-tone', 'paid');
    expect(screen.getByTestId('card-valid-until')).toHaveTextContent('Valable jusqu’au 9 mars 2027');
    expect(screen.getByText('Montrez ce code : il permet de vérifier votre adhésion.')).toBeInTheDocument();
    // Le QR est engendré ici, la bibliothèque chargée à la demande.
    expect(await screen.findByRole('img', { name: 'Code QR de vérification de l’adhésion' })).toBeInTheDocument();
  });

  it('les lignes nulles DISPARAISSENT : numéro, adhésion, logo — jamais de « — »', () => {
    render(
      <MemberCardView
        card={memberCard({ member_number: null, member_since: null, logo_url: null, category_label: null })}
      />,
    );
    expect(screen.queryByTestId('card-number')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-since')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-logo')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { hidden: true, name: '' })).toBeNull();
    const text = screen.getByTestId('member-card').textContent ?? '';
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/N°/);
    expect(text).not.toMatch(/depuis/);
  });

  it('un exonéré est « À jour » SANS « Valable jusqu’au » (valid_until nul)', () => {
    render(<MemberCardView card={memberCard({ display_name: 'Awa Gueye', valid_until: null })} />);
    expect(screen.getByTestId('card-standing')).toHaveTextContent('À jour');
    expect(screen.queryByTestId('card-valid-until')).not.toBeInTheDocument();
    expect(screen.getByTestId('member-card').textContent).not.toMatch(/Valable/);
  });

  it('pas à jour : badge orange, et aucune date même si le serveur en servait une', () => {
    render(
      <MemberCardView
        card={memberCard({ is_up_to_date: false, standing_label: 'Cotisation à régler', valid_until: '2027-03-09' })}
      />,
    );
    expect(screen.getByTestId('card-standing')).toHaveTextContent('Cotisation à régler');
    expect(screen.getByTestId('card-standing')).toHaveAttribute('data-tone', 'due');
    expect(screen.queryByTestId('card-valid-until')).not.toBeInTheDocument();
  });

  it('organisation_name vide : aucun texte de remplacement (FON-18)', () => {
    render(<MemberCardView card={memberCard({ organisation_name: '', logo_url: null })} />);
    expect(screen.queryByTestId('card-organisation')).not.toBeInTheDocument();
    const card = screen.getByTestId('member-card');
    // Le premier texte de la carte est le nom du membre.
    expect(card.textContent?.startsWith('Aminata Diop')).toBe(true);
    expect(card.textContent).not.toMatch(/association|organisation/i);
  });

  it('organisation_name vide mais logo présent : le logo seul', () => {
    render(<MemberCardView card={memberCard({ organisation_name: '   ' })} />);
    expect(screen.getByTestId('card-logo')).toBeInTheDocument();
    expect(screen.queryByTestId('card-organisation')).not.toBeInTheDocument();
  });

  it('aucune mention « Adhera », « EventFlow » ni « DIGISSOL » dans la carte', async () => {
    const { container } = render(<MemberCardView card={memberCard()} />);
    await screen.findByRole('img', { name: /Code QR/ });
    expect(container.textContent).not.toMatch(BRANDS);
    // Ni dans un texte alternatif, ni dans un libellé accessible.
    for (const el of Array.from(container.querySelectorAll('[alt],[aria-label],[title]'))) {
      for (const attr of ['alt', 'aria-label', 'title']) {
        expect(el.getAttribute(attr) ?? '').not.toMatch(BRANDS);
      }
    }
  });
});

describe('le QR code', () => {
  it('encode verify_url en niveau M : version 4, 33 modules pour cette adresse', async () => {
    const matrix = await makeQrMatrix('https://demo-asso.adhera.africa/v/5RGF6J9Z2UJX');
    expect(matrix.size).toBe(33);
    expect(matrix.path.length).toBeGreaterThan(100);
  });

  it('qrPath trace un carré par module sombre', () => {
    expect(qrPath(2, (r, c) => r === c)).toBe('M0 0h1v1h-1zM1 1h1v1h-1z');
  });
});
