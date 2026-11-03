'use client';

import { useBackBar } from '@/components/bureau/BureauContext';
import { CategoriesPanel } from '@/components/bureau/CategoriesPanel';
import { PageTitle } from '@/components/bureau/ui';

/** « Types de membres et montants », rangé dans « Plus » (F5) : l'écran existant. */
export default function TypesDeMembresPage() {
  useBackBar({ href: '/bureau/plus', label: 'Plus' });
  return (
    <>
      <PageTitle
        title="Types de membres et montants"
        subtitle="Ce que chaque type de membre paie chaque année."
      />
      <CategoriesPanel />
    </>
  );
}
