'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertIcon } from '@/components/Icons';
import { getSettings, isSessionError, logout } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import {
  currentTenant,
  getSession,
  loginHref,
  navigation,
  subscribe,
  type BureauSession,
} from '@/lib/bureau/session';
import type { Settings } from '@/lib/bureau/types';
import {
  BureauContext,
  useBureau,
  type BureauContextValue,
} from './BureauContext';
import {
  CashIcon,
  CloseIcon,
  InboxIcon,
  LogoutIcon,
  MenuIcon,
  SettingsIcon,
  UsersIcon,
} from './Icons';
import { Button, buttonClass, Skeleton } from './ui';

/** « Encaisser » ouvre la navigation : c'est le geste le plus fréquent. */
const ENCAISSER = { href: '/bureau/encaisser', label: 'Encaisser', icon: CashIcon } as const;

const NAV = [
  ENCAISSER,
  { href: '/bureau', label: 'À valider', icon: InboxIcon },
  { href: '/bureau/membres', label: 'Membres', icon: UsersIcon },
  { href: '/bureau/reglages', label: 'Réglages', icon: SettingsIcon },
] as const;

const LOGIN_PATH = '/bureau/connexion';

function isActive(pathname: string, href: string): boolean {
  if (href === '/bureau') return pathname === '/bureau';
  return pathname === href || pathname.startsWith(`${href}/`);
}

type FrameState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; session: BureauSession; settings: Settings };

/**
 * Le cadre de l'espace bureau : garde de session, chargement des réglages,
 * navigation et bannière de mode.
 *
 * La page de connexion passe AU TRAVERS : elle n'a pas de session à garder, et
 * le nom de l'association ne s'y affiche pas (la route `settings` exige le
 * jeton).
 */
export function BureauFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/bureau';
  if (pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`)) {
    return <>{children}</>;
  }
  return <GuardedFrame pathname={pathname}>{children}</GuardedFrame>;
}

function GuardedFrame({
  pathname,
  children,
}: {
  pathname: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<FrameState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [modeFlag, setModeFlag] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const tenant = currentTenant();
    const session = tenant ? getSession(tenant) : null;

    if (!tenant || !session) {
      navigation.replace(loginHref(false, tenant));
      return () => controller.abort();
    }

    void (async () => {
      try {
        const settings = await getSettings(controller.signal);
        setState({ kind: 'ready', session, settings });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (isSessionError(error)) return;
        setState({
          kind: 'error',
          message: errorMessage(
            error,
            'L’espace du bureau n’a pas pu être chargé.',
          ),
        });
      }
    })();

    return () => controller.abort();
  }, [attempt]);

  // Une purge venue d'ailleurs (déconnexion, 401) ferme le cadre aussitôt :
  // aucune donnée ne reste affichée sans session.
  useEffect(
    () =>
      subscribe(() => {
        const tenant = currentTenant();
        if (!getSession(tenant)) setState({ kind: 'loading' });
      }),
    [],
  );

  const setSettings = useCallback((settings: Settings) => {
    setState((prev) => (prev.kind === 'ready' ? { ...prev, settings } : prev));
  }, []);
  const markModeUnsupported = useCallback(() => setModeFlag(false), []);

  const value = useMemo<BureauContextValue | null>(() => {
    if (state.kind !== 'ready') return null;
    return {
      session: state.session,
      settings: state.settings,
      setSettings,
      modeSupported: state.settings.mode_is_supported && modeFlag,
      markModeUnsupported,
    };
  }, [state, setSettings, modeFlag, markModeUnsupported]);

  if (state.kind === 'error') {
    return (
      <div className="flex min-h-dvh flex-col items-center gap-4 bg-surface px-4 pt-16 text-center text-ink">
        <span className="flex size-16 items-center justify-center rounded-full bg-late-soft text-late">
          <AlertIcon />
        </span>
        <h1 className="title m-0">Espace du bureau indisponible</h1>
        <p className="m-0 max-w-[360px]">{state.message}</p>
        <Button tone="primary" onClick={() => setAttempt((n) => n + 1)}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (!value) {
    return (
      <div className="min-h-dvh bg-surface p-4">
        <Skeleton label="Chargement de l’espace du bureau…" />
      </div>
    );
  }

  return (
    <BureauContext.Provider value={value}>
      <div className="flex min-h-dvh bg-surface text-ink">
        <Sidebar pathname={pathname} />
        <div className="flex min-w-0 grow flex-col">
          <TopBar pathname={pathname} />
          {value.modeSupported ? null : <ModeBanner />}
          <main className="mx-auto flex w-full max-w-[1120px] min-w-0 grow flex-col gap-4 px-4 pt-4 pb-10 lg:px-8 lg:pt-8">
            {children}
          </main>
        </div>
      </div>
    </BureauContext.Provider>
  );
}

/**
 * Une seule bannière pour tout l'espace, au lieu de laisser chaque écran
 * tomber en `409 cotisation_mode_unsupported` (contrat §3, piège 5).
 */
function ModeBanner() {
  return (
    <div
      role="alert"
      className="border-b border-due bg-due-soft px-4 py-3 font-semibold text-due lg:px-8"
    >
      Le mode de cotisation de votre association n’est pas encore pris en
      charge. Contactez DIGISSOL.
    </div>
  );
}

function Logo({ settings, size }: { settings: Settings; size: number }) {
  if (!settings.logo_url) return null;
  return (
    // L'URL est versionnée par son contenu (§3) : relue, jamais recomposée.
    <img
      src={settings.logo_url}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className="shrink-0 rounded-[var(--radius-sm)] bg-surface-raised object-contain"
      style={{ width: size, height: size }}
    />
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  const { settings, session } = useBureau();

  return (
    <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-6 bg-ink px-3 py-5 text-[var(--sidebar-text)] lg:flex">
      <div className="flex items-center gap-3 px-2">
        <Logo settings={settings} size={40} />
        <span className="heading min-w-0 break-words text-on-indigo">
          {settings.issuer_name?.trim() || 'Espace du bureau'}
        </span>
      </div>

      <nav aria-label="Espace du bureau" className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          if (href === ENCAISSER.href) {
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className="mb-3 flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-surface-raised px-3 text-[17px] font-bold text-indigo! no-underline"
              >
                <Icon />
                {label}
              </Link>
            );
          }
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 font-semibold no-underline ${
                // `!` : la règle globale `a { color }` de F1 est hors @layer.
                active
                  ? 'bg-indigo text-on-indigo!'
                  : 'text-[var(--sidebar-text)]! hover:bg-indigo/40'
              }`}
            >
              <Icon />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="grow" />

      <div className="flex flex-col gap-2 border-t border-[var(--sidebar-text)]/20 px-2 pt-4">
        <span className="small">Connecté :</span>
        <span className="font-semibold break-words text-on-indigo">
          {session.admin.name}
        </span>
        <LogoutButton className="justify-start px-0 text-[var(--sidebar-text)]" />
      </div>
    </aside>
  );
}

function TopBar({ pathname }: { pathname: string }) {
  const { settings, session } = useBureau();
  const [open, setOpen] = useState(false);

  // Le menu se referme à chaque changement de page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface-raised lg:hidden">
      <div className="flex min-h-14 items-center gap-3 px-4">
        <Logo settings={settings} size={32} />
        <span className="heading min-w-0 grow truncate">
          {settings.issuer_name?.trim() || 'Espace du bureau'}
        </span>
        {/* Toujours visible, hors du menu : le geste le plus fréquent. */}
        <Link
          href={ENCAISSER.href}
          aria-current={isActive(pathname, ENCAISSER.href) ? 'page' : undefined}
          className={buttonClass('primary', 'shrink-0 px-3 no-underline')}
        >
          <CashIcon size={18} />
          Encaisser
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="bureau-menu"
          aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
          className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-ink"
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {open ? (
        <div id="bureau-menu" className="flex flex-col gap-1 border-t border-line bg-ink px-3 py-3 text-[var(--sidebar-text)]">
          <nav aria-label="Espace du bureau" className="flex flex-col gap-1">
            {NAV.filter((item) => item.href !== ENCAISSER.href).map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={`flex min-h-12 items-center gap-3 rounded-[var(--radius-sm)] px-3 font-semibold no-underline ${
                    active ? 'bg-indigo text-on-indigo!' : 'text-[var(--sidebar-text)]!'
                  }`}
                >
                  <Icon />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--sidebar-text)]/20 px-3 pt-3">
            <span className="small min-w-0 break-words">
              Connecté : <span className="font-semibold text-on-indigo">{session.admin.name}</span>
            </span>
            <LogoutButton className="px-0 text-[var(--sidebar-text)]" />
          </div>
        </div>
      ) : null}
    </header>
  );
}

function LogoutButton({ className = '' }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    const tenant = currentTenant();
    await logout();
    navigation.replace(loginHref(false, tenant));
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex min-h-11 items-center gap-2 bg-transparent font-semibold disabled:opacity-60 ${className}`}
    >
      <LogoutIcon />
      {busy ? 'Déconnexion…' : 'Se déconnecter'}
    </button>
  );
}
