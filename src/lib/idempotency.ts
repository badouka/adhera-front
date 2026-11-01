/**
 * `Idempotency-Key` — l'en-tête des deux routes qui créent de l'argent
 * (contrat §11.1) : la saisie directe du bureau et le « J'ai payé » du membre.
 *
 * ⚠️ Une clé par INTENTION d'encaisser : créée à l'OUVERTURE du panneau,
 * conservée tant que l'envoi n'a pas réussi — un réessai après une coupure
 * rejoue la même clé, et le serveur rend le versement d'origine sans rien
 * écrire —, régénérée seulement après un succès (ou par un panneau neuf).
 * Une clé régénérée à chaque envoi rendrait l'en-tête décoratif.
 */

import { useCallback, useState } from 'react';

/** Un UUID v4. `randomUUID` n'existe qu'en contexte sûr et sur un navigateur récent. */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * La clé d'un panneau : tirée UNE fois au montage (l'initialiseur de `useState`
 * ne rejoue pas aux re-rendus), et `renew()` après un succès ou un
 * `422 idempotency_key_reused`.
 */
export function useIdempotencyKey(): [string, () => void] {
  const [key, setKey] = useState(newIdempotencyKey);
  const renew = useCallback(() => setKey(newIdempotencyKey()), []);
  return [key, renew];
}
