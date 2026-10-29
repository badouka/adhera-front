import { MemberPage } from './MemberPage';

/**
 * R5 : rien n'est mis en cache. `force-dynamic` fait servir la coque avec
 * `Cache-Control: no-store` et interdit toute mise en cache de la route.
 */
export const dynamic = 'force-dynamic';

/**
 * R2 : ce composant serveur est MINIMAL et ne fait AUCUN fetch. Les données du
 * membre se chargent dans le navigateur, sinon tous les membres passeraient
 * derrière l'IP du VPS et le limiteur `membership-public` (20 req/min/IP)
 * renverrait un 429 au 21ᵉ membre de la minute.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <MemberPage token={token} />;
}
