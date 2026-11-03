'use client';

import { useEffect } from 'react';
import { navigation } from '@/lib/bureau/session';
import { VERIFY_PATH } from '@/components/bureau/BureauFrame';

/**
 * F5 — l'ancienne adresse de la file : elle mène à « Paiements à vérifier ».
 * Un lien déjà reçu (un e-mail, un favori) continue de servir.
 */
export default function AncienneFile() {
  useEffect(() => {
    navigation.replace(`${VERIFY_PATH}${window.location.search}`);
  }, []);
  return null;
}
