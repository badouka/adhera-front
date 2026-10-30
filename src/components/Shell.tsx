import type { ReactNode } from 'react';
import { AdheraMark } from './Icons';

/**
 * La coque commune : en-tête au logo et au nom de l'organisation, contenu, pied
 * de page « Propulsé par Adhera ».
 */
export function Shell({
  organisationName,
  logoUrl,
  children,
}: {
  /** Omis en E1 : on ne sait pas de quelle association il s'agit. */
  organisationName?: string;
  /** `organisation.logo_url` : versionnée par son contenu, jamais recomposée. */
  logoUrl?: string | null;
  children: ReactNode;
}) {
  const name = organisationName?.trim();

  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink">
      {name ? (
        <header className="flex items-center justify-center gap-3 border-b border-line bg-surface-raised px-4 pt-4 pb-3">
          {logoUrl ? (
            // Le nom est écrit à côté : le logo est décoratif.
            <img
              src={logoUrl}
              alt=""
              width={40}
              height={40}
              referrerPolicy="no-referrer"
              className="size-10 shrink-0 rounded-[var(--radius-sm)] object-contain"
            />
          ) : null}
          <p className="title m-0 min-w-0 text-center text-balance">{name}</p>
        </header>
      ) : (
        <header className="border-b border-line bg-surface-raised px-4 py-3" />
      )}

      <main className="mx-auto flex w-full max-w-[420px] grow flex-col gap-4 px-4 pt-6 pb-4">
        {children}
      </main>

      <footer className="small flex items-center justify-center gap-[6px] px-4 pt-3 pb-4 text-ink-muted">
        <AdheraMark size={16} />
        Propulsé par Adhera
      </footer>
    </div>
  );
}

/** Un bloc en carte blanche, comme les sections des maquettes. */
export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col gap-3 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4 ${className}`}
    >
      {children}
    </section>
  );
}
