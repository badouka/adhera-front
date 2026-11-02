import type { ReactNode } from 'react';
import { AdheraMark } from './Icons';

/** Le pied de page par défaut de la page du membre. */
export function PoweredBy() {
  return (
    <>
      <AdheraMark size={16} />
      Propulsé par Adhera
    </>
  );
}

/**
 * La coque commune : en-tête au logo et au nom de l'organisation, contenu, pied
 * de page « Propulsé par Adhera ».
 *
 * La vue « Ma carte » se passe d'en-tête (la carte porte déjà le logo et le
 * nom) et de pied de page : elle ne porte que le nom de l'association (F4).
 */
export function Shell({
  organisationName,
  logoUrl,
  children,
  header = true,
  footer = <PoweredBy />,
}: {
  /** Faux : aucune bande d'en-tête. */
  header?: boolean;
  /** `null` : aucun pied de page. */
  footer?: ReactNode;
  /** Omis en E1 : on ne sait pas de quelle association il s'agit. */
  organisationName?: string;
  /** `organisation.logo_url` : versionnée par son contenu, jamais recomposée. */
  logoUrl?: string | null;
  children: ReactNode;
}) {
  const name = organisationName?.trim();

  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink">
      {!header ? null : name ? (
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

      {footer ? (
        <footer className="small flex items-center justify-center gap-[6px] px-4 pt-3 pb-4 text-ink-muted">
          {footer}
        </footer>
      ) : null}
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
