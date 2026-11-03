'use client';

import { useEffect } from 'react';
import { navigation } from '@/lib/bureau/session';
import { RECORD_PATH } from '@/components/bureau/BureauFrame';

/**
 * F5 — l'ancienne adresse de la saisie : elle mène à « Un membre a payé »,
 * pour qu'un favori ou un lien déjà envoyé ne tombe pas dans le vide.
 */
export default function AncienneSaisie() {
  useEffect(() => {
    navigation.replace(`${RECORD_PATH}${window.location.search}`);
  }, []);
  return null;
}
