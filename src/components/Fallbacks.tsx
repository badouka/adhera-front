import { MEMBER_UNAVAILABLE_TEXT } from '@/lib/licence';
import { AlertIcon, BrokenLinkIcon, RetryIcon } from './Icons';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex grow flex-col items-center gap-4 px-2 pt-10 text-center">
      {children}
    </div>
  );
}

/** E1 — lien invalide. Aucun nom d'organisation : on ne sait pas laquelle. */
export function InvalidLink() {
  return (
    <Centered>
      <span className="flex size-16 items-center justify-center rounded-full bg-late-soft text-late">
        <BrokenLinkIcon />
      </span>
      <h1 className="title m-0">Ce lien n’est plus valide</h1>
      <p className="m-0 max-w-[300px]">
        Demandez un nouveau lien à votre association.
      </p>
      <p className="small m-0 max-w-[300px] text-ink-muted">
        Pour votre sécurité, chaque membre reçoit son propre lien. Ne le
        transférez pas.
      </p>
    </Centered>
  );
}

/**
 * E8 — une réponse 403 (licence échue, option éteinte…) ou 409 : le serveur a
 * répondu, et il a dit non. C'est l'association qui parle au membre (B11, F7) :
 * jamais la licence, jamais Adhera.
 */
export function Unavailable() {
  return (
    <Centered>
      <span className="flex size-16 items-center justify-center rounded-full bg-due-soft text-due">
        <AlertIcon />
      </span>
      <h1 className="title m-0">Service indisponible</h1>
      <p className="m-0 max-w-[320px]" data-testid="unavailable">
        {MEMBER_UNAVAILABLE_TEXT}
      </p>
    </Centered>
  );
}

/**
 * E9 — 429, 5xx, réseau. « Erreur technique » et « vérifiez votre connexion »
 * sont RÉSERVÉS à une vraie panne réseau (`network`) : une réponse que le
 * serveur a rendue ne fait jamais accuser la connexion du membre (B11, F7).
 */
export function TechnicalError({
  rateLimited,
  network = false,
  onRetry,
}: {
  rateLimited: boolean;
  /** Aucune réponse du serveur (`status` 0). */
  network?: boolean;
  onRetry: () => void;
}) {
  return (
    <Centered>
      <span className="flex size-16 items-center justify-center rounded-full bg-late-soft text-late">
        <AlertIcon />
      </span>
      <h1 className="title m-0">
        {rateLimited ? 'Trop de tentatives' : network ? 'Erreur technique' : 'Service momentanément indisponible'}
      </h1>
      <p className="m-0 max-w-[320px]">
        {rateLimited
          ? 'Trop de tentatives, réessayez dans une minute.'
          : network
            ? 'Votre page n’a pas pu être chargée. Vérifiez votre connexion, puis réessayez.'
            : 'Votre page n’a pas pu être chargée. Réessayez dans un instant.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 flex h-13 min-w-[180px] items-center justify-center gap-2 rounded-[var(--radius-md)] bg-indigo px-5 text-[17px] font-bold text-on-indigo"
      >
        <RetryIcon />
        Réessayer
      </button>
    </Centered>
  );
}

/** Le chargement : il a lieu dans le navigateur, jamais en SSR (R2). */
export function Loading() {
  return (
    <div
      className="flex grow flex-col gap-4 pt-2"
      aria-busy="true"
      aria-live="polite"
    >
      <p className="sr-only">Chargement de votre cotisation…</p>
      <div className="h-7 w-2/3 rounded-[var(--radius-sm)] bg-line/60" />
      <div className="h-32 rounded-[var(--radius-md)] bg-line/40" />
      <div className="h-24 rounded-[var(--radius-md)] bg-line/30" />
    </div>
  );
}
