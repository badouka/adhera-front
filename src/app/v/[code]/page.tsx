import type { Metadata } from 'next';
import { VerifyPage } from './VerifyPage';

/** R5 : la vérification est toujours relue, jamais servie d'un cache. */
export const dynamic = 'force-dynamic';

/**
 * Le titre reste neutre : il s'affiche dans l'historique du téléphone de celui
 * qui vérifie, il ne nomme ni l'association ni le membre.
 */
export const metadata: Metadata = {
  title: 'Vérification d’adhésion',
  description: 'Vérification de l’adhésion d’un membre.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

/**
 * R2 : aucun fetch ici. La vérification part du navigateur de celui qui scanne,
 * comme la page du membre : un fetch serveur mettrait tous les contrôles
 * derrière l'IP du VPS.
 */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <VerifyPage code={code} />;
}
