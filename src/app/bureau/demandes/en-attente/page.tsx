'use client';

import { Registry } from '@/components/bureau/Registry';

/**
 * Sous « Toute personne qui paie sa première cotisation » (§17.2) : les
 * candidats qui n'ont pas encore payé. Rien à examiner — le bureau garde
 * seulement le droit de refuser, depuis leur fiche.
 */
const BACK = { href: '/bureau/demandes', label: 'Demandes d’adhésion' };

export default function EnAttentePage() {
  return <Registry status="pending" back={BACK} />;
}
