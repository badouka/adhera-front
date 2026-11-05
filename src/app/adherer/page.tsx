import type { Metadata } from 'next';
import { JoinPage } from './JoinPage';

/** R5 : la page est relue à chaque visite, jamais servie d'un cache. */
export const dynamic = 'force-dynamic';

/**
 * Le titre est neutre : la page ne nomme l'association qu'une fois l'API
 * relue. Une page fermée (`membership_join` éteinte) ne doit pas se trahir par
 * son titre (§17.1).
 */
export const metadata: Metadata = {
  title: 'Adhérer',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

/**
 * R2 : aucun fetch ici. Le formulaire se charge dans le navigateur du visiteur :
 * un fetch serveur mettrait toutes les demandes derrière l'IP du VPS, et le
 * limiteur `membership-join` (20 par heure et par IP) fermerait la page au
 * 21ᵉ visiteur.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ parrain?: string | string[] }>;
}) {
  const { parrain } = await searchParams;
  const code = typeof parrain === 'string' && parrain.trim() !== '' ? parrain.trim() : null;
  return <JoinPage parrain={code} />;
}
