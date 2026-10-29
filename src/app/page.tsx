import Link from 'next/link';
import { Shell } from '@/components/Shell';

/**
 * La racine d'un sous-domaine. On ne connaît pas le membre : texte neutre, sans
 * nom d'association.
 */
export default function Home() {
  return (
    <Shell>
      <div className="flex grow flex-col items-center gap-4 px-2 pt-10 text-center">
        <h1 className="title m-0">Adhera</h1>
        <p className="m-0 max-w-[320px]">
          Utilisez le lien reçu de votre association.
        </p>
        <div className="grow" />
        <Link href="/bureau" className="small text-ink-muted">
          Espace du bureau
        </Link>
      </div>
    </Shell>
  );
}
