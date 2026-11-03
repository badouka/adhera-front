'use client';

import { useEffect, useRef, useState } from 'react';
import { PasswordField } from '@/components/bureau/PasswordField';
import { buttonClass, Notice, PageTitle, Panel } from '@/components/bureau/ui';
import { ApiError } from '@/lib/api';
import { changePassword, isSessionError, type PasswordChange } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';

type FieldName = keyof PasswordChange;

const FIELDS: ReadonlyArray<FieldName> = ['current_password', 'password', 'password_confirmation'];

const EMPTY: PasswordChange = { current_password: '', password: '', password_confirmation: '' };

/**
 * Un champ laissé vide : arrêté avant tout envoi, pour ne pas user l'une des
 * 10 tentatives par heure du compte (§14.3). Les deux premiers libellés sont
 * ceux du serveur (§14.2) ; le serveur range une confirmation absente sous
 * `password`, mais un champ vide se signale là où il est.
 */
const MISSING: Record<FieldName, string> = {
  current_password: 'Saisissez votre mot de passe actuel.',
  password: 'Choisissez un nouveau mot de passe.',
  password_confirmation: 'Retapez le nouveau mot de passe à l’identique.',
};

/** Neutre : le compte peut être tenu par une femme comme par un homme. */
export const PASSWORD_CHANGED =
  'Votre mot de passe a été changé. Vos autres appareils ont été déconnectés : il faudra vous y reconnecter.';

export const PASSWORD_HINT =
  '8 caractères minimum. Deux mots et quelques chiffres suffisent, par exemple Baobab-Lagune-4827.';

/**
 * « Mon mot de passe » (S3e, contrat §14) — ouvert à tous les rôles.
 *
 * Les messages d'un `422` de cette route (§14.2) disent quoi faire ; comme
 * partout dans Adhera, ils s'affichent TELS QUELS, chacun sous son champ. Une confirmation différente arrive sous `password` : elle
 * reste sous « Nouveau mot de passe ». Le `message` commun (« Le mot de passe
 * n'a pas été changé. ») n'est pas répété. Aucune règle de symbole, de
 * majuscule ni de chiffre côté écran (§14.2).
 *
 * Après un `200`, rien à faire : le jeton de l'onglet reste valable, les
 * autres sont révoqués (§14.1).
 */
export default function MonMotDePassePage() {
  const [values, setValues] = useState<PasswordChange>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  // Change à chaque succès : les champs se remontent, masqués.
  const [round, setRound] = useState(0);
  const refs = {
    current_password: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    password_confirmation: useRef<HTMLInputElement>(null),
  };
  const messageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (done || formError) messageRef.current?.focus();
  }, [done, formError]);

  function set(field: FieldName, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setDone(false);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setDone(false);
    setFormError(null);

    const missing: Partial<Record<FieldName, string>> = {};
    for (const field of FIELDS) if (values[field] === '') missing[field] = MISSING[field];
    setErrors(missing);
    const firstMissing = FIELDS.find((f) => missing[f]);
    if (firstMissing) return refs[firstMissing].current?.focus();

    setSending(true);
    try {
      await changePassword(values);
      setValues(EMPTY);
      setErrors({});
      setRound((n) => n + 1);
      setDone(true);
    } catch (error) {
      if (isSessionError(error)) return;
      if (error instanceof ApiError && error.status === 422) {
        const next: Partial<Record<FieldName, string>> = {};
        const others: string[] = [];
        for (const [field, messages] of Object.entries(error.errors)) {
          if ((FIELDS as ReadonlyArray<string>).includes(field)) {
            next[field as FieldName] = messages.join(' ');
          } else {
            others.push(...messages);
          }
        }
        setErrors(next);
        if (others.length > 0) setFormError(others.join(' '));
        else if (Object.keys(next).length === 0) {
          setFormError(error.message || 'Le mot de passe n’a pas pu être changé.');
        }
        const first = FIELDS.find((f) => next[f]);
        if (first) refs[first].current?.focus();
      } else {
        // 429 : le délai réel (`Retry-After`) ; réseau coupé : « Connexion impossible… ».
        setFormError(errorMessage(error, 'Le mot de passe n’a pas pu être changé.'));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageTitle title="Mon mot de passe" />
      <Panel className="w-full max-w-[480px]">
        <form className="m-0 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <PasswordField
            key={`current-${round}`}
            ref={refs.current_password}
            label="Mot de passe actuel"
            name="current_password"
            autoComplete="current-password"
            value={values.current_password}
            onChange={(v) => set('current_password', v)}
            error={errors.current_password}
          />
          <PasswordField
            key={`new-${round}`}
            ref={refs.password}
            label="Nouveau mot de passe"
            name="password"
            autoComplete="new-password"
            hint={PASSWORD_HINT}
            value={values.password}
            onChange={(v) => set('password', v)}
            error={errors.password}
          />
          <PasswordField
            key={`confirm-${round}`}
            ref={refs.password_confirmation}
            label="Confirmez le nouveau mot de passe"
            name="password_confirmation"
            autoComplete="new-password"
            value={values.password_confirmation}
            onChange={(v) => set('password_confirmation', v)}
            error={errors.password_confirmation}
          />

          <div ref={messageRef} tabIndex={-1} className="outline-none">
            {done ? <Notice tone="paid">{PASSWORD_CHANGED}</Notice> : null}
            {formError ? <Notice tone="late">{formError}</Notice> : null}
          </div>

          <button type="submit" disabled={sending} className={buttonClass('primary', 'min-h-12')}>
            {sending ? 'Enregistrement…' : 'Enregistrer mon mot de passe'}
          </button>
        </form>
      </Panel>
    </>
  );
}
