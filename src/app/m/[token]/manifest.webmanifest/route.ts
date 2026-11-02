import { buildManifest, isPlausibleToken } from '@/lib/manifest';

/**
 * `/m/{jeton}/manifest.webmanifest` — le manifeste de la carte d'un membre,
 * engendré à chaque demande.
 *
 * R2 : aucun appel à l'API ici. Le nom de l'association et son logo arrivent
 * dans l'adresse (`?nom=`, `?logo=`), posée par la page une fois la carte
 * chargée dans le navigateur ; le logo n'est retenu que s'il vient de l'API.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!isPlausibleToken(token)) {
    return new Response('Not found', { status: 404 });
  }

  const query = new URL(request.url).searchParams;
  const manifest = buildManifest(token, query.get('nom'), query.get('logo'));

  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      // R5 : le nom ou le logo peuvent changer ; rien ne se fige.
      'Cache-Control': 'no-store',
    },
  });
}
