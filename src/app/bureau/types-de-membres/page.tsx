'use client';

import { useCallback } from 'react';
import { useBackBar, useBureau } from '@/components/bureau/BureauContext';
import { CategoriesPanel } from '@/components/bureau/CategoriesPanel';
import { SettingsWarnings } from '@/components/bureau/SettingsWarnings';
import { PageTitle } from '@/components/bureau/ui';
import { getSettings } from '@/lib/bureau/api/settings';

/**
 * « Types de membres et montants », rangé dans « Plus » (F5) : le montant et,
 * depuis S8, le rythme de chaque type (§22.1). Les avertissements des réglages
 * (§22.4) dépendent des types : ils se relisent après chaque changement.
 */
export default function TypesDeMembresPage() {
  useBackBar({ href: '/bureau/plus', label: 'Plus' });
  const { setSettings } = useBureau();
  const refreshWarnings = useCallback(() => {
    getSettings()
      .then(setSettings)
      .catch(() => {
        // Sans réponse, les avertissements affichés restent ceux d'avant.
      });
  }, [setSettings]);

  return (
    <>
      <PageTitle
        title="Types de membres et montants"
        subtitle="Ce que chaque type de membre paie, et à quel rythme."
      />
      <SettingsWarnings />
      <CategoriesPanel onChanged={refreshWarnings} />
    </>
  );
}
