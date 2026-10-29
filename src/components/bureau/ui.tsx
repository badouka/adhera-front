'use client';

import { forwardRef, useId, type ReactNode } from 'react';

/* ─────────────────────────────── Boutons ─────────────────────────────── */

export type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost';

/*
  La couleur du texte porte `!` : `buttonClass` habille aussi des liens, et la
  règle globale `a { color }` de F1, hors @layer, l'emporterait sinon sur les
  utilitaires Tailwind (un « Ajouter un membre » indigo sur fond indigo).
*/
const BUTTON: Record<ButtonTone, string> = {
  primary: 'bg-indigo text-on-indigo! font-bold',
  secondary: 'border border-line-strong bg-surface-raised text-ink! font-semibold',
  danger: 'bg-late text-on-indigo! font-bold',
  ghost: 'bg-transparent text-indigo! font-semibold',
};

export function buttonClass(tone: ButtonTone = 'secondary', extra = ''): string {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 text-center disabled:opacity-60 ${BUTTON[tone]} ${extra}`;
}

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }
>(function Button({ tone = 'secondary', className = '', type, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={buttonClass(tone, className)}
      {...rest}
    />
  );
});

/* ─────────────────────────────── Champs ─────────────────────────────── */

export const INPUT =
  'min-h-11 w-full min-w-0 rounded-[var(--radius-sm)] border bg-surface-raised px-3 text-ink';

export function inputClass(invalid: boolean, extra = ''): string {
  return `${INPUT} ${invalid ? 'border-late' : 'border-line-strong'} ${extra}`;
}

type FieldRender = {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
};

/**
 * Un champ étiqueté. L'erreur affichée est TOUJOURS un libellé français écrit
 * par l'écran, jamais un message de l'API (piège 10).
 */
export function Field({
  label,
  hint,
  error,
  required,
  optional,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: boolean;
  children: (props: FieldRender) => ReactNode;
}) {
  const id = useId();
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <label htmlFor={id} className="font-semibold">
        {label}
        {required ? <span className="text-late"> *</span> : null}
        {optional ? (
          <span className="font-normal text-ink-muted"> (facultatif)</span>
        ) : null}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': described || undefined,
      })}
      {hint ? (
        <span id={`${id}-hint`} className="small text-ink-muted">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} className="small font-semibold text-late">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────── Messages ─────────────────────────────── */

export type NoticeTone = 'paid' | 'info' | 'late' | 'due';

const NOTICE: Record<NoticeTone, string> = {
  paid: 'bg-paid-soft text-paid',
  info: 'bg-indigo-soft text-indigo',
  late: 'bg-late-soft text-late',
  due: 'bg-due-soft text-due',
};

export function Notice({
  tone,
  children,
  role,
}: {
  tone: NoticeTone;
  children: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <div
      role={role ?? (tone === 'late' ? 'alert' : 'status')}
      className={`m-0 flex flex-col gap-2 rounded-[var(--radius-md)] p-4 font-semibold break-words ${NOTICE[tone]}`}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────── Mise en page ─────────────────────────── */

export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="title m-0 break-words">{title}</h1>
        {subtitle ? <p className="m-0 text-ink-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4 ${className}`}
    >
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="heading m-0">{title}</h2> : <span />}
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Une ligne « libellé : valeur » d'une fiche. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="m-0 min-w-0 text-right font-semibold break-words">{children}</dd>
    </div>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <p className="sr-only">{label}</p>
      <div className="h-7 w-1/2 rounded-[var(--radius-sm)] bg-line/60" />
      <div className="h-24 rounded-[var(--radius-md)] bg-line/40" />
      <div className="h-24 rounded-[var(--radius-md)] bg-line/30" />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 rounded-[var(--radius-md)] border border-dashed border-line-strong bg-surface-raised p-6 text-center text-ink-muted">
      {children}
    </p>
  );
}

/* ─────────────────────────────── Onglets ─────────────────────────────── */

export function Tabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1 overflow-x-auto border-b border-line"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={`-mb-px min-h-11 shrink-0 border-b-2 px-3 font-semibold whitespace-nowrap ${
              selected
                ? 'border-indigo text-indigo'
                : 'border-transparent text-ink-muted'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
