'use client';

import { useEffect, useRef, useState } from 'react';
import { isSessionError, listCategories } from '@/lib/bureau/api';
import { errorMessage, invalidFields } from '@/lib/bureau/messages';
import type {
  Category,
  MemberInput,
  MemberListItem,
  MemberType,
  MemberTypes,
} from '@/lib/bureau/types';
import { todayInDakar } from '@/lib/dates';
import { dateError } from './format';
import { Button, Field, inputClass } from './ui';

type FieldName = keyof MemberInput;
type Errors = Partial<Record<FieldName, string>>;

/**
 * Les libellés d'erreur, en français et écrits ici. Les messages de l'API sont
 * en anglais : `errors` ne sert qu'à DÉSIGNER le champ fautif (piège 10).
 */
export const MEMBER_FIELD_ERRORS: Record<FieldName, string> = {
  type: 'Choisissez le type de membre.',
  name: 'Indiquez le nom du membre (255 caractères au plus).',
  phone: 'Vérifiez le numéro de téléphone.',
  email: 'Vérifiez l’adresse e-mail : elle est invalide ou déjà utilisée.',
  region: 'Vérifiez la région (255 caractères au plus).',
  category_id: 'Choisissez une catégorie active.',
  joined_at: 'Indiquez une date d’adhésion valide.',
};

const FIELDS = Object.keys(MEMBER_FIELD_ERRORS) as FieldName[];

/** Le type imposé par les réglages, ou null si l'association est mixte. */
function fixedType(memberTypes: MemberTypes): MemberType | null {
  if (memberTypes === 'personnes') return 'personne';
  if (memberTypes === 'organisations') return 'organisation';
  return null;
}

function emptyToNull(value: string): string | null {
  const text = value.trim();
  return text === '' ? null : text;
}

export function MemberForm({
  memberTypes,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  memberTypes: MemberTypes;
  /** Absent à la création. */
  initial?: MemberListItem;
  submitLabel: string;
  /** Rend l'erreur de l'API telle quelle : le formulaire la traduit. */
  onSubmit: (input: MemberInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const imposed = fixedType(memberTypes);
  const [type, setType] = useState<MemberType>(initial?.type ?? imposed ?? 'personne');
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [categoryId, setCategoryId] = useState<string>(
    initial?.category_id != null ? String(initial.category_id) : '',
  );
  const [joinedAt, setJoinedAt] = useState(initial?.joined_at ?? (initial ? '' : todayInDakar()));
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    listCategories(controller.signal)
      .then(setCategories)
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isSessionError(error)) setCategories([]);
      });
    return () => controller.abort();
  }, []);

  // Seules les catégories actives se proposent ; une catégorie non calculable
  // ferait lever l'ouverture d'une période (§4) : elle est grisée. La
  // catégorie actuelle d'un membre reste visible, même désactivée.
  const options = (categories ?? []).filter(
    (c) => c.is_active || String(c.id) === categoryId,
  );

  function focusFirst(next: Errors) {
    const first = FIELDS.find((f) => next[f]);
    if (!first) return;
    formRef.current
      ?.querySelector<HTMLElement>(`[name="${first}"]`)
      ?.focus();
  }

  function validate(): Errors {
    const next: Errors = {};
    if (name.trim() === '') next.name = 'Indiquez le nom du membre.';
    if (email.trim() !== '' && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      next.email = 'Cette adresse e-mail n’est pas valide.';
    }
    if (joinedAt !== '') {
      const invalid = dateError(joinedAt, 'la date d’adhésion');
      if (invalid) next.joined_at = invalid;
    }
    const chosen = categories?.find((c) => String(c.id) === categoryId);
    if (chosen && !chosen.is_calculable && String(initial?.category_id) !== categoryId) {
      next.category_id = 'Le montant de cette catégorie ne peut pas être calculé.';
    }
    return next;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setFormError(null);
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return focusFirst(next);

    setSending(true);
    try {
      await onSubmit({
        type: imposed ?? type,
        name: name.trim(),
        phone: emptyToNull(phone),
        email: emptyToNull(email),
        region: emptyToNull(region),
        category_id: categoryId === '' ? null : Number(categoryId),
        joined_at: joinedAt === '' ? null : joinedAt,
      });
    } catch (error) {
      if (isSessionError(error)) return;
      const fields = invalidFields(error);
      const mapped: Errors = {};
      for (const field of fields) {
        if ((FIELDS as string[]).includes(field)) {
          mapped[field as FieldName] = MEMBER_FIELD_ERRORS[field as FieldName];
        }
      }
      if (Object.keys(mapped).length > 0) {
        setErrors(mapped);
        focusFirst(mapped);
      } else {
        setFormError(
          fields.length > 0
            ? 'Le formulaire contient une erreur. Vérifiez les champs, puis réessayez.'
            : errorMessage(error, 'Le membre n’a pas pu être enregistré.'),
        );
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <form ref={formRef} className="m-0 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      {imposed ? null : (
        <fieldset className="m-0 flex flex-col gap-[6px] border-0 p-0">
          <legend className="m-0 mb-[6px] p-0 font-semibold">Type de membre</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['personne', 'organisation'] as const).map((value) => (
              <label
                key={value}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border-2 px-3 font-semibold ${
                  type === value ? 'border-indigo bg-indigo-soft' : 'border-line bg-surface-raised'
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                  className="m-0 size-5 accent-[var(--indigo)]"
                />
                {value === 'personne' ? 'Personne' : 'Organisation'}
              </label>
            ))}
          </div>
          {errors.type ? (
            <span className="small font-semibold text-late">{errors.type}</span>
          ) : null}
        </fieldset>
      )}

      <Field label={type === 'organisation' ? 'Nom de l’organisation' : 'Nom complet'} required error={errors.name}>
        {(props) => (
          <input {...props} name="name" maxLength={255} value={name} onChange={(e) => setName(e.target.value)} className={inputClass(!!errors.name)} />
        )}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Téléphone" optional error={errors.phone} hint="Le numéro WhatsApp, de préférence.">
          {(props) => (
            <input {...props} name="phone" type="tel" inputMode="tel" autoComplete="off" maxLength={32} value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass(!!errors.phone)} />
          )}
        </Field>
        <Field label="E-mail" optional error={errors.email}>
          {(props) => (
            <input {...props} name="email" type="email" inputMode="email" autoComplete="off" maxLength={255} value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass(!!errors.email)} />
          )}
        </Field>
        <Field label="Région" optional error={errors.region}>
          {(props) => (
            <input {...props} name="region" maxLength={255} value={region} onChange={(e) => setRegion(e.target.value)} className={inputClass(!!errors.region)} />
          )}
        </Field>
        <Field label="Date d’adhésion" optional error={errors.joined_at}>
          {(props) => (
            <input {...props} name="joined_at" type="date" max={todayInDakar()} value={joinedAt} onChange={(e) => setJoinedAt(e.target.value)} className={inputClass(!!errors.joined_at)} />
          )}
        </Field>
      </div>

      <Field
        label="Catégorie"
        optional
        error={errors.category_id}
        hint={categories === null ? 'Chargement des catégories…' : undefined}
      >
        {(props) => (
          <select {...props} name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass(!!errors.category_id)}>
            <option value="">Aucune catégorie</option>
            {options.map((c) => (
              <option
                key={c.id}
                value={c.id}
                disabled={!c.is_calculable && String(initial?.category_id) !== String(c.id)}
              >
                {c.label}
                {c.amount_formatted ? ` — ${c.amount_formatted}` : ''}
                {c.is_active ? '' : ' (désactivée)'}
                {c.is_calculable ? '' : ' (montant non calculable)'}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div role="alert" aria-live="polite">
        {formError ? (
          <p className="m-0 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late">{formError}</p>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button tone="ghost" onClick={onCancel} disabled={sending}>
            Annuler
          </Button>
        ) : null}
        <Button tone="primary" type="submit" disabled={sending}>
          {sending ? 'Enregistrement…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
