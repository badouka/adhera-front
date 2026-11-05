'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertIcon } from '@/components/Icons';
import { getMe, logout } from '@/lib/bureau/api/auth';
import { isSessionError } from '@/lib/bureau/api/core';
import { listPayments } from '@/lib/bureau/api/payments';
import { getSettings } from '@/lib/bureau/api/settings';
import { errorMessage } from '@/lib/bureau/messages';
import {
  currentTenant,
  getSession,
  loginHref,
  navigation,
  subscribe,
  type BureauSession,
} from '@/lib/bureau/session';
import type { Me, Settings } from '@/lib/bureau/types';
import {
  BureauContext,
  useBureau,
  type BackLink,
  type BureauContextValue,
} from './BureauContext';
import { ChevronLeftIcon, LogoutIcon } from './Icons';
import { Button, Skeleton } from './ui';

/**
 * F5 — quatre entrées, pas une de plus (N1). Tout ce qui sert rarement vit
 * dans « Plus » : les écrans existent, ils sont seulement rangés là.
 */
export const VERIFY_PATH = '/bureau/a-verifier';
export const RECORD_PATH = '/bureau/enregistrer';
export const PLUS_PATH = '/bureau/plus';

type NavKey = 'home' | 'members' | 'verify' | 'plus';

const NAV: ReadonlyArray<{ key: NavKey; href: string; label: string; long: string }> = [
  { key: 'home', href: '/bureau', label: 'Accueil', long: 'Accueil' },
  { key: 'members', href: '/bureau/membres', label: 'Membres', long: 'Membres' },
  { key: 'verify', href: VERIFY_PATH, label: 'Paiements', long: 'Paiements à vérifier' },
  { key: 'plus', href: PLUS_PATH, label: 'Plus', long: 'Plus' },
];

const LOGIN_PATH = '/bureau/connexion';

/** « Mon mot de passe » (S3e), rangé dans « Plus ». */
export const PASSWORD_PATH = '/bureau/mon-mot-de-passe';

/** L'entrée de la navigation à laquelle appartient une page. */
export function navKey(pathname: string): NavKey {
  if (pathname === '/bureau' || pathname.startsWith(RECORD_PATH)) return 'home';
  if (pathname.startsWith('/bureau/membres')) return 'members';
  if (pathname.startsWith(VERIFY_PATH) || pathname.startsWith('/bureau/a-valider')) {
    return 'verify';
  }
  return 'plus';
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

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
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
  const [me, setMe] = useState<Me | null>(null);
  const [toVerify, setToVerify] = useState<number | null>(null);
  const [countTick, setCountTick] = useState(0);
  const [back, setBack] = useState<BackLink | null>(null);

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
        if (isAbort(error)) return;
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

  const ready = state.kind === 'ready';

  // Le nom de la personne — lu par `GET admin/me` (§18.7). Sans réponse,
  // l'en-tête garde le nom de la connexion : il ne bloque rien.
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    getMe(controller.signal)
      .then(setMe)
      .catch(() => {
        // Le nom de la session suffit à dire qui est connecté.
      });
    return () => controller.abort();
  }, [ready]);

  // Le nombre à vérifier, sur l'entrée « Paiements » : relu à chaque page, et
  // après chaque décision (`refreshToVerify`).
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    listPayments({ status: 'declared' }, controller.signal)
      .then((list) => setToVerify(list.length))
      .catch(() => {
        // Sans compteur, l'entrée reste là : seul le chiffre manque.
      });
    return () => controller.abort();
  }, [ready, pathname, countTick]);

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
  const refreshToVerify = useCallback(() => setCountTick((n) => n + 1), []);

  const value = useMemo<BureauContextValue | null>(() => {
    if (state.kind !== 'ready') return null;
    return {
      session: state.session,
      settings: state.settings,
      setSettings,
      modeSupported: state.settings.mode_is_supported && modeFlag,
      markModeUnsupported,
      me,
      setMe,
      toVerify,
      refreshToVerify,
      setBack,
    };
  }, [state, setSettings, modeFlag, markModeUnsupported, me, toVerify, refreshToVerify]);

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

  const active = navKey(pathname);

  return (
    <BureauContext.Provider value={value}>
      <div className="flex min-h-dvh bg-surface text-ink">
        <Sidebar active={active} />
        <div className="flex min-w-0 grow flex-col">
          {back ? <BackBar back={back} /> : <TopBar />}
          {value.modeSupported ? null : <ModeBanner />}
          <main
            className={`mx-auto flex w-full max-w-[1040px] min-w-0 grow flex-col gap-4 px-4 pt-[18px] lg:px-10 lg:pt-8 lg:pb-12 print:max-w-none print:p-0 ${
              back ? 'pb-10' : 'pb-24'
            }`}
          >
            {children}
          </main>
          {back ? null : <TabBar active={active} />}
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
      className="border-b border-due bg-due-soft px-4 py-3 font-semibold text-due lg:px-10 print:hidden"
    >
      Le mode de cotisation de votre association n’est pas encore pris en
      charge. Contactez DIGISSOL.
    </div>
  );
}

/** Le nom de l'association : jamais coupé (N1), il passe à la ligne. */
export function associationName(settings: Settings): string {
  return settings.issuer_name?.trim() || 'Espace du bureau';
}

/**
 * F5-bis R1 — la ligne 1 du téléphone : le sigle servi (`short_name`, §19), sinon
 * le nom complet (règle E1). Le sigle n'est jamais fabriqué ici.
 */
export function headerTitle(settings: Settings): string {
  return settings.short_name?.trim() || associationName(settings);
}

/**
 * F5-bis R1 — « Fatim Diarra » : le nom de la personne, SEUL. Ni « Connecté·e »,
 * ni rôle : `role_label` est servi au masculin, et une trésorière lirait
 * « Trésorier » en haut de chaque écran. Le rôle ne reste que dans « Mon profil ».
 */
export function personName(me: Me | null, session: BureauSession): string {
  return me?.name?.trim() || session.admin.name;
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

function CountBadge({ count }: { count: number | null }) {
  if (!count) return null;
  return (
    <span
      className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[var(--radius-pill)] bg-indigo px-[6px] text-[12px] font-bold text-on-indigo"
      data-testid="verify-count"
    >
      {count}
    </span>
  );
}

/** Ordinateur (1024 px et plus) : la barre `ink` de 248 px de la maquette. */
function Sidebar({ active }: { active: NavKey }) {
  const { settings, session, me, toVerify } = useBureau();

  return (
    <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col bg-ink py-6 lg:flex print:hidden">
      <div className="flex flex-col gap-1 border-b border-[var(--sidebar-text)]/20 px-5 pb-5">
        <Logo settings={settings} size={40} />
        <span className="text-[18px] leading-6 font-bold break-words text-on-indigo">
          {associationName(settings)}
        </span>
        <span className="small break-words text-[var(--sidebar-text)]" data-testid="person-name">
          {personName(me, session)}
        </span>
      </div>

      <nav aria-label="Espace du bureau" className="flex flex-col pt-3">
        {NAV.map(({ key, href, long }) => {
          const on = key === active;
          return (
            <Link
              key={key}
              href={href}
              aria-current={on ? 'page' : undefined}
              // `!` : la règle globale `a { color }` de F1 est hors @layer.
              className={`flex h-12 items-center justify-between border-l-[3px] no-underline ${
                on
                  ? 'border-indigo bg-indigo/30 pr-5 pl-[17px] font-semibold text-on-indigo!'
                  : 'border-transparent px-5 text-[var(--sidebar-text)]!'
              }`}
            >
              {long}
              {key === 'verify' ? <CountBadge count={toVerify} /> : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/**
 * Téléphone : le sigle (le nom complet s'il n'est pas servi), puis le nom de la
 * personne. L'ordinateur, qui a la place, garde le nom complet (barre latérale).
 */
function TopBar() {
  const { settings, session, me } = useBureau();
  return (
    <header className="bg-ink px-4 pt-[14px] pb-3 lg:hidden print:hidden">
      <div className="text-[18px] leading-6 font-bold break-words text-on-indigo">
        {headerTitle(settings)}
      </div>
      <div className="small break-words text-[var(--sidebar-text)]" data-testid="person-name">
        {personName(me, session)}
      </div>
    </header>
  );
}

/** Un écran d'un geste : « Retour », et ni en-tête ni barre du bas. */
function BackBar({ back }: { back: BackLink }) {
  return (
    <div className="sticky top-0 z-30 flex h-14 items-center border-b border-line bg-surface-raised px-2 print:hidden">
      {back.onClick ? (
        <button
          type="button"
          onClick={back.onClick}
          className="inline-flex h-11 items-center gap-[6px] bg-transparent px-2 font-semibold text-indigo"
        >
          <ChevronLeftIcon size={20} />
          {back.label}
        </button>
      ) : (
        <Link
          href={back.href}
          className="inline-flex h-11 items-center gap-[6px] px-2 font-semibold text-indigo! no-underline"
        >
          <ChevronLeftIcon size={20} />
          {back.label}
        </Link>
      )}
    </div>
  );
}

/** Téléphone : la barre du bas, quatre entrées, le nombre à vérifier. */
function TabBar({ active }: { active: NavKey }) {
  const { toVerify } = useBureau();
  return (
    <nav
      aria-label="Navigation"
      className="fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-4 border-t border-line bg-surface-raised pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
    >
      {NAV.map(({ key, href, label }) => {
        const on = key === active;
        return (
          <Link
            key={key}
            href={href}
            aria-current={on ? 'page' : undefined}
            className={`small flex items-center justify-center gap-[6px] border-t-[3px] no-underline ${
              on
                ? 'border-indigo font-bold text-indigo!'
                : 'border-transparent text-ink-muted!'
            }`}
          >
            {label}
            {key === 'verify' ? <CountBadge count={toVerify} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** « Se déconnecter » : dans « Plus ». La purge locale a lieu quoi qu'il arrive. */
export function LogoutButton({ className = '' }: { className?: string }) {
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
