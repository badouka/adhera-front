'use client';

import { forwardRef, useState, type ReactNode } from 'react';
import { Field, inputClass } from './ui';

/**
 * Les attributs qui empêchent un téléphone de « corriger » ce qu'on tape :
 * une majuscule mise d'office au début d'un e-mail ou d'un mot de passe fait
 * échouer la connexion sans que personne comprenne pourquoi.
 */
export const NO_AUTOCORRECT = {
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: false,
} as const;

/**
 * Un champ de mot de passe, avec un bouton « Afficher » : sur un téléphone,
 * taper à l'aveugle est la première source d'erreur.
 *
 * Le bouton dit ce qu'il fera (« Afficher », puis « Masquer ») ; son nom
 * accessible nomme le champ, pour qu'on distingue les trois boutons d'un même
 * formulaire.
 */
export const PasswordField = forwardRef<
  HTMLInputElement,
  {
    label: string;
    name: string;
    autoComplete: 'current-password' | 'new-password';
    value: string;
    onChange: (value: string) => void;
    hint?: ReactNode;
    error?: string | null;
    disabled?: boolean;
    inputClassName?: string;
  }
>(function PasswordField(
  { label, name, autoComplete, value, onChange, hint, error, disabled, inputClassName = '' },
  ref,
) {
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} hint={hint} error={error}>
      {(props) => (
        <div className="flex min-w-0 gap-2">
          <input
            {...props}
            ref={ref}
            type={shown ? 'text' : 'password'}
            name={name}
            autoComplete={autoComplete}
            {...NO_AUTOCORRECT}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass(!!error, `grow ${inputClassName}`)}
          />
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-controls={props.id}
            aria-label={`${shown ? 'Masquer' : 'Afficher'} : ${label}`}
            className="min-h-11 shrink-0 rounded-[var(--radius-sm)] border border-line-strong bg-surface-raised px-3 font-semibold text-indigo"
          >
            {shown ? 'Masquer' : 'Afficher'}
          </button>
        </div>
      )}
    </Field>
  );
});
