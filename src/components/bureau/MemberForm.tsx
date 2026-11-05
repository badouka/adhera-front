'use client';

import { useEffect, useRef, useState } from 'react';
import { fieldMessages } from '@/lib/api';
import { listCategories } from '@/lib/bureau/api/categories';
import { isSessionError } from '@/lib/bureau/api/core';
import { listQuestions } from '@/lib/bureau/api/questions';
import { errorMessage } from '@/lib/bureau/messages';
import type {
  Category,
  MemberAnswer,
  MemberInput,
  MemberListItem,
  MemberType,
  MemberTypes,
  Question,
} from '@/lib/bureau/types';
import { formatDate, todayInDakar } from '@/lib/dates';
import { dateError } from './format';
import { Button, Field, inputClass } from './ui';

type FieldName = keyof MemberInput;
/** Les champs du membre, et `answers.{id}` pour une question (§20.6). */
type Errors = Partial<Record<FieldName | `answers.${number}`, string>>;

/** Une réponse en cours de saisie : `''` = pas de réponse. */
type Draft = Record<string, string | boolean>;

/** La valeur à renvoyer (§20.6 : on renvoie `value`, on affiche `value_label`). */
function draftOf(answers: MemberAnswer[] | undefined): Draft {
  const out: Draft = {};
  for (const answer of answers ?? []) {
    if (answer.archived) continue;
    out[String(answer.question_id)] = answer.value ?? '';
  }
  return out;
}

/**
 * §20.6 — le `PUT` remplace PAR QUESTION : on n'envoie que ce qui a changé, et
 * `""` efface une réponse. À la création, seulement les réponses données.
 * `required` ne s'applique pas ici : le bureau complétera.
 */
export function changedAnswers(
  questions: Question[],
  draft: Draft,
  initial: Draft,
  creating: boolean,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const question of questions) {
    // §21.4 — une pièce ne s'écrit JAMAIS par une chaîne : seul un dépôt de fichier.
    if (question.type === 'file') continue;
    const key = String(question.id);
    const value = draft[key] ?? '';
    const before = initial[key] ?? '';
    const normalized = typeof value === 'string' ? value.trim() : value;
    if (creating) {
      if (normalized !== '') out[key] = normalized;
    } else if (normalized !== (typeof before === 'string' ? before.trim() : before)) {
      out[key] = normalized;
    }
  }
  return out;
}

/**
 * Les champs du formulaire, dans l'ordre de l'écran : c'est l'ordre du focus
 * sur la première erreur. Le message d'un `422` est celui de l'API, tel quel
 * (elle parle français ; le refus d'un numéro nomme son porteur, §16.1).
 */
const FIELDS: FieldName[] = [
  'type',
  'first_name',
  'last_name',
  'name',
  'phone',
  'email',
  'region',
  'category_id',
  'joined_at',
  'member_number',
];

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
  initialAnswers,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  memberTypes: MemberTypes;
  /** Absent à la création. */
  initial?: MemberListItem;
  /** §20.6 — les réponses de la fiche (`answers`), archivées comprises. */
  initialAnswers?: MemberAnswer[];
  submitLabel: string;
  /** Rend l'erreur de l'API telle quelle : le formulaire la traduit. */
  onSubmit: (input: MemberInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const imposed = fixedType(memberTypes);
  const [type, setType] = useState<MemberType>(initial?.type ?? imposed ?? 'personne');
  // Une fiche ancienne peut porter `first_name: null` (reprise v3.5.7) : le
  // champ s'ouvre vide, et c'est l'occasion de le compléter.
  const [firstName, setFirstName] = useState(initial?.first_name ?? '');
  const [lastName, setLastName] = useState(initial?.last_name ?? '');
  // La raison sociale d'une organisation EST son `name`.
  const [name, setName] = useState(initial?.type === 'organisation' ? initial.name : '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [categoryId, setCategoryId] = useState<string>(
    initial?.category_id != null ? String(initial.category_id) : '',
  );
  const [joinedAt, setJoinedAt] = useState(initial?.joined_at ?? (initial ? '' : todayInDakar()));
  // §16.1 : modifiable par `PUT` seulement — à la création, le serveur numérote.
  const numberEditable = !!initial && initial.member_number !== undefined;
  const initialNumber = initial?.member_number ?? '';
  const [memberNumber, setMemberNumber] = useState(initialNumber);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [startAnswers] = useState<Draft>(() => draftOf(initialAnswers));
  const [answers, setAnswers] = useState<Draft>(startAnswers);
  const retired = (initialAnswers ?? []).filter((a) => a.archived);

  // Les questions ACTIVES, dans leur ordre : une question retirée ne se saisit
  // plus (§20.3). Sans elles, le formulaire reste celui du membre.
  useEffect(() => {
    const controller = new AbortController();
    listQuestions(controller.signal)
      .then((payload) =>
        setQuestions(payload.questions.filter((q) => !q.archived).sort((a, b) => a.position - b.position)),
      )
      .catch(() => setQuestions([]));
    return () => controller.abort();
  }, []);

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
    const order = [...FIELDS, ...questions.map((q) => `answers.${q.id}` as const)];
    const first = order.find((f) => next[f]);
    if (!first) return;
    formRef.current
      ?.querySelector<HTMLElement>(`[name="${first}"]`)
      ?.focus();
  }

  const effectiveType = imposed ?? type;

  function validate(): Errors {
    const next: Errors = {};
    if (effectiveType === 'personne') {
      if (firstName.trim() === '') next.first_name = 'Indiquez le prénom.';
      if (lastName.trim() === '') next.last_name = 'Indiquez le nom de famille.';
    } else if (name.trim() === '') {
      next.name = 'Indiquez la raison sociale.';
    }
    if (email.trim() !== '' && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      next.email = 'Cette adresse e-mail n’est pas valide.';
    }
    if (joinedAt !== '') {
      const invalid = dateError(joinedAt, 'la date d’adhésion');
      if (invalid) next.joined_at = invalid;
    }
    const chosen = categories?.find((c) => String(c.id) === categoryId);
    if (chosen && !chosen.is_calculable && String(initial?.category_id) !== categoryId) {
      next.category_id = 'Le montant de ce type de membre ne peut pas être calculé.';
    }
    return next;
  }

  function answersPart(): { answers?: Record<string, string | boolean> } {
    const changed = changedAnswers(questions, answers, startAnswers, !initial);
    return Object.keys(changed).length > 0 ? { answers: changed } : {};
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
        type: effectiveType,
        // Jamais les deux jeux à la fois : l'API refuse un prénom sur une
        // organisation, et ignore un `name` sur une personne.
        ...(effectiveType === 'personne'
          ? { first_name: firstName.trim(), last_name: lastName.trim() }
          : { name: name.trim() }),
        phone: emptyToNull(phone),
        email: emptyToNull(email),
        region: emptyToNull(region),
        category_id: categoryId === '' ? null : Number(categoryId),
        joined_at: joinedAt === '' ? null : joinedAt,
        // Envoyé seulement s'il a changé : rien ne se revalide pour rien.
        ...(numberEditable && memberNumber.trim() !== initialNumber.trim()
          ? { member_number: emptyToNull(memberNumber) }
          : {}),
        ...answersPart(),
      });
    } catch (error) {
      if (isSessionError(error)) return;
      const messages = fieldMessages(error);
      const mapped: Errors = {};
      for (const field of FIELDS) {
        if (messages[field]) mapped[field] = messages[field];
      }
      for (const question of questions) {
        const key = `answers.${question.id}` as const;
        if (messages[key]) mapped[key] = messages[key];
      }
      if (Object.keys(mapped).length > 0) {
        setErrors(mapped);
        focusFirst(mapped);
      } else {
        setFormError(errorMessage(error, 'Le membre n’a pas pu être enregistré.'));
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

      {effectiveType === 'personne' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Prénom" required error={errors.first_name}>
            {(props) => (
              <input {...props} name="first_name" autoComplete="off" maxLength={255} value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass(!!errors.first_name)} />
            )}
          </Field>
          <Field label="Nom" required error={errors.last_name}>
            {(props) => (
              <input {...props} name="last_name" autoComplete="off" maxLength={255} value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass(!!errors.last_name)} />
            )}
          </Field>
        </div>
      ) : (
        <Field label="Raison sociale" required error={errors.name}>
          {(props) => (
            <input {...props} name="name" autoComplete="off" maxLength={255} value={name} onChange={(e) => setName(e.target.value)} className={inputClass(!!errors.name)} />
          )}
        </Field>
      )}

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
        {numberEditable ? (
          <Field label="Numéro de membre" optional error={errors.member_number}>
            {(props) => (
              <input {...props} name="member_number" autoComplete="off" maxLength={32} value={memberNumber} onChange={(e) => setMemberNumber(e.target.value)} className={inputClass(!!errors.member_number)} />
            )}
          </Field>
        ) : null}
      </div>

      <Field
        label="Type de membre"
        optional
        error={errors.category_id}
        hint={categories === null ? 'Chargement des types de membres…' : undefined}
      >
        {(props) => (
          <select {...props} name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass(!!errors.category_id)}>
            <option value="">Aucun type de membre</option>
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

      {questions.length > 0 || retired.length > 0 ? (
        <fieldset className="m-0 flex flex-col gap-4 border-0 border-t border-line p-0 pt-4" data-testid="member-answers">
          <legend className="float-left mb-1 w-full p-0 font-semibold">Ses réponses aux questions de l’association</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {questions.filter((question) => question.type !== 'file').map((question) => (
              <AnswerInput
                key={question.id}
                question={question}
                value={answers[String(question.id)] ?? ''}
                error={errors[`answers.${question.id}`]}
                onChange={(value) => setAnswers((prev) => ({ ...prev, [String(question.id)]: value }))}
              />
            ))}
          </div>
          {retired.length > 0 ? (
            <div className="small flex flex-col gap-1 text-ink-muted">
              {retired.map((answer) => (
                <span key={answer.question_id}>
                  {answer.label} (question retirée) : {answer.value_label ?? 'pas de réponse'}
                </span>
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : null}

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

/** Un oui/non tel que le serveur peut le rendre : booléen, `1`/`0`, `oui`/`non`. */
function yesNo(value: string | boolean): '' | 'oui' | 'non' {
  if (value === true || ['1', 'true', 'oui', 'yes'].includes(String(value).toLowerCase())) return 'oui';
  if (value === false || ['0', 'false', 'non', 'no'].includes(String(value).toLowerCase())) return 'non';
  return '';
}

/**
 * Une réponse saisie par le bureau : aucune n'est obligatoire ici. Une valeur
 * absente des réponses possibles actuelles reste proposée — c'est ce que le
 * membre a déclaré (§20.10).
 */
function AnswerInput({
  question,
  value,
  error,
  onChange,
}: {
  question: Question;
  value: string | boolean;
  error: string | undefined;
  onChange: (value: string | boolean) => void;
}) {
  const name = `answers.${question.id}`;
  const text = typeof value === 'string' ? value : '';
  return (
    <Field label={question.label} optional error={error} hint={question.type === 'date' && formatDate(text) ? formatDate(text) : undefined}>
      {(props) =>
        question.type === 'choice' ? (
          <select {...props} name={name} value={text} onChange={(e) => onChange(e.target.value)} className={inputClass(!!error)}>
            <option value="">Pas de réponse</option>
            {(text && !question.options.includes(text) ? [text, ...question.options] : question.options).map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        ) : question.type === 'yes_no' ? (
          <select
            {...props}
            name={name}
            value={yesNo(value)}
            onChange={(e) => onChange(e.target.value === 'oui' ? true : e.target.value === 'non' ? false : '')}
            className={inputClass(!!error)}
          >
            <option value="">Pas de réponse</option>
            <option value="oui">Oui</option>
            <option value="non">Non</option>
          </select>
        ) : (
          <input
            {...props}
            name={name}
            type={question.type === 'date' ? 'date' : 'text'}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass(!!error)}
          />
        )
      }
    </Field>
  );
}
