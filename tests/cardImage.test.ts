import { describe, expect, it } from 'vitest';
import { cardFileName } from '@/components/card/cardImage';

const base = {
  organisation_name: 'Association',
  logo_url: null,
  icon_url: null,
  display_name: 'Aïssatou Ndiaye',
  first_name: 'Aïssatou',
  last_name: 'Ndiaye',
  type: 'personne' as const,
  category_label: null,
  member_number: null,
  member_since: null,
  is_up_to_date: true,
  valid_until: null,
  standing_label: 'À jour',
  verify_url: 'https://demo-asso.adhera.africa/v/ABC',
};

describe('carte en PNG — le nom du fichier', () => {
  it('carte-{prenom}-{nom}.png, sans accent ni espace', () => {
    expect(cardFileName(base)).toBe('carte-aissatou-ndiaye.png');
    expect(cardFileName({ ...base, first_name: 'Mame Diarra', last_name: 'Lo' })).toBe(
      'carte-mame-diarra-lo.png',
    );
  });

  it('une organisation : son nom', () => {
    expect(
      cardFileName({ ...base, first_name: null, last_name: null, display_name: 'Agence Conseil Teranga' }),
    ).toBe('carte-agence-conseil-teranga.png');
  });
});
