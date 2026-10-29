import type { ReactNode } from 'react';
import { AdheraMark } from './Icons';

/**
 * La coque commune : en-tête au nom de l'organisation, contenu, pied de page
 * « Propulsé par Adhera ».
 *
 * Pas de logo dans ce sprint : l'API n'en sert pas (`organisation.logo_url`
 * manque au contrat). Le nom tient donc la place du logo des maquettes.
 */
export function Shell({
  organisationName,
  children,
}: {
  /** Omis en E1 : on ne sait pas de quelle association il s'agit. */
  organisationName?: string;
  children: ReactNode;
}) {
  const name = organisationName?.trim();

  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink">
      {name ? (
        <header className="flex justify-center border-b border-line bg-surface-raised px-4 pt-4 pb-3">
          <p className="title m-0 text-center text-balance">{name}</p>
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
