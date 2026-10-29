'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Field, inputClass, Notice } from '@/components/bureau/ui';
import { ApiError } from '@/lib/api';
import { INVALID_CREDENTIALS, login } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import { currentTenant, getSession, saveSession } from '@/lib/bureau/session';

type Status =
  | { kind: 'checking' }
  | { kind: 'no-tenant' }
  | { kind: 'form'; tenant: string; expired: boolean };

/**
 * B1 — la connexion du bureau.
 *
 * Le nom et le logo de l'association ne s'affichent PAS ici : la route
 * `settings` exige le jeton. Le refus est volontairement le même pour un
 * e-mail inconnu, un mot de passe faux et un compte désactivé.
 */
export default function ConnexionPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'checking' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tenant = currentTenant();
    if (!tenant) {
      setStatus({ kind: 'no-tenant' });
      return;
    }
    if (getSession(tenant)) {
      router.replace('/bureau');
      return;
    }
    const expired =
      new URLSearchParams(window.location.search).get('session') === 'expiree';
    setStatus({ kind: 'form', tenant, expired });
  }, [router]);

  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || status.kind !== 'form') return;

    setFormError(null);
    const next: typeof errors = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      next.email = 'Indiquez votre adresse e-mail.';
    }
    if (password === '') next.password = 'Indiquez votre mot de passe.';
    setErrors(next);
    if (next.email) return emailRef.current?.focus();
    if (next.password) return passwordRef.current?.focus();

    setSending(true);
    try {
      const data = await login(status.tenant, email.trim(), password);
      saveSession({ token: data.token, tenant: status.tenant, admin: data.admin });
      setPassword('');
      router.replace('/bureau');
    } catch (error) {
      setPassword('');
      if (error instanceof ApiError && error.code === INVALID_CREDENTIALS) {
        setFormError('E-mail ou mot de passe incorrect.');
      } else if (error instanceof ApiError && error.status === 429) {
        setFormError('Trop de tentatives, réessayez dans quelques minutes.');
      } else {
        setFormError(errorMessage(error, 'La connexion n’a pas abouti. Réessayez.'));
      }
      setSending(false);
    }
  }

  return (
    <Shell>
      {status.kind === 'checking' ? null : status.kind === 'no-tenant' ? (
        <div className="flex flex-col gap-2 pt-6 text-center">
          <h1 className="title m-0">Espace du bureau</h1>
          <p className="m-0">
            Ouvrez l’espace du bureau depuis l’adresse de votre association.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5 pt-2">
          <div className="flex flex-col gap-1">
            <h1 className="title m-0">Espace du bureau</h1>
            <p className="m-0 text-ink-muted">
              Connectez-vous avec l’adresse e-mail de votre compte du bureau.
            </p>
          </div>

          {status.expired && !formError ? (
            <Notice tone="due">Votre session a expiré. Reconnectez-vous.</Notice>
          ) : null}

          <form className="m-0 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <Field label="E-mail" error={errors.email}>
              {(props) => (
                <input
                  {...props}
                  ref={emailRef}
                  type="email"
                  name="email"
                  autoComplete="username"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass(!!errors.email, 'h-13')}
                />
              )}
            </Field>
            <Field label="Mot de passe" error={errors.password}>
              {(props) => (
                <input
                  {...props}
                  ref={passwordRef}
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass(!!errors.password, 'h-13')}
                />
              )}
            </Field>

            <div ref={errorRef} tabIndex={-1} role="alert" aria-live="polite">
              {formError ? (
                <p className="m-0 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late">
                  {formError}
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={sending}
              className="flex h-13 items-center justify-center rounded-[var(--radius-md)] bg-indigo text-[17px] font-bold text-on-indigo disabled:opacity-60"
            >
              {sending ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>
      )}
    </Shell>
  );
}
