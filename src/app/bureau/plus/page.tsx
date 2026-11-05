'use client';

import Link from 'next/link';
import { LogoutButton, PASSWORD_PATH } from '@/components/bureau/BureauFrame';

/**
 * « Plus » (F5, N3) : tout ce qui sert rarement. Les écrans existaient déjà ;
 * ils sont rangés ici, chacun avec son « Retour ».
 */
export const PLUS_ENTRIES: ReadonlyArray<{ href: string; label: string; card?: boolean }> = [
  { href: '/bureau/campagnes', label: 'Relancer les membres' },
  { href: '/bureau/a-envoyer', label: 'Rappels WhatsApp à envoyer' },
  { href: '/bureau/demandes', label: 'Demandes d’adhésion' },
  // F6 § 5 — deux entrées, et deux seulement.
  { href: '/bureau/adhesion-en-ligne', label: 'L’adhésion en ligne : le lien, et qui devient membre' },
  { href: '/bureau/questions', label: 'Les questions de l’association' },
  { href: '/bureau/anciens', label: 'Anciens membres' },
  { href: '/bureau/paiements', label: 'Tous les paiements' },
  { href: '/bureau/chiffres', label: 'Chiffres détaillés et fichiers Excel' },
  { href: '/bureau/types-de-membres', label: 'Types de membres et montants' },
  { href: '/bureau/reglages', label: 'Paramètres de l’association' },
  { href: '/bureau/profil', label: 'Mon profil' },
  { href: PASSWORD_PATH, label: 'Changer mon mot de passe' },
];

export default function PlusPage() {
  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4">
      <h1 className="title m-0">Plus</h1>
      <nav
        aria-label="Plus"
        className="flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-raised"
      >
        {PLUS_ENTRIES.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-4 py-2 text-[16px] text-ink! no-underline last:border-b-0"
          >
            <span>{entry.label}</span>
            <span aria-hidden="true" className="font-semibold text-indigo">
              ›
            </span>
          </Link>
        ))}
      </nav>
      <div className="flex flex-col items-start rounded-[var(--radius-md)] border border-line bg-surface-raised px-4">
        <LogoutButton className="w-full text-ink" />
      </div>
    </div>
  );
}
