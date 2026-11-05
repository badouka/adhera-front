'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useBackBar } from '@/components/bureau/BureauContext';
import { bigButtonClass, Button, EmptyState, inputClass, LINK_BUTTON, Notice, Skeleton } from '@/components/bureau/ui';
import { ApiError, fieldMessages } from '@/lib/api';
import { isSessionError } from '@/lib/bureau/api/core';
import {
  archiveQuestion,
  createQuestion,
  deleteQuestion,
  listQuestions,
  updateQuestion,
} from '@/lib/bureau/api/questions';
import { setFlash } from '@/lib/bureau/flash';
import { errorMessage } from '@/lib/bureau/messages';
import type { Question, QuestionInput, QuestionLimits, QuestionsPayload, QuestionType } from '@/lib/bureau/types';
import { activeQuestions, NEW_QUESTION, QUESTIONS_PATH, SORT_HINTS, sortLabel } from '../words';

const BACK = { href: QUESTIONS_PATH, label: 'Les questions' };

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; payload: QuestionsPayload; question: Question | null };

type Errors = Record<string, string>;

/**
 * Les erreurs d'un `422` (§20.3), rangées sous le bon élément : la clé
 * `options.3` va sous la réponse possible n° 4 (`reponse-3`), `options` sous la
 * liste (`reponses`).
 */
export function placeErrors(fields: Record<string, string>): Errors {
  const out: Errors = {};
  for (const [key, message] of Object.entries(fields)) {
    const one = /^options\.(\d+)$/.exec(key);
    out[one ? `reponse-${one[1]}` : key === 'options' ? 'reponses' : key] = message;
  }
  return out;
}

/**
 * Ce que le `POST` ou le `PUT` envoie (§20.2) : `options` pour `choice`
 * SEULEMENT (refusée ailleurs) ; la sorte d'une question répondue ne part pas
 * — elle est verrouillée, et le serveur refuserait de la changer.
 */
export function questionBody(
  draft: { label: string; type: QuestionType; options: string[]; required: boolean; onCard: boolean },
  existing: Question | null,
  cardTypes: string[],
): Partial<QuestionInput> {
  const body: Partial<QuestionInput> = {
    label: draft.label.trim(),
    required: draft.required,
    on_card: cardTypes.includes(draft.type) ? draft.onCard : false,
  };
  if (!existing?.has_answers) body.type = draft.type;
  if (draft.type === 'choice') body.options = draft.options.map((o) => o.trim());
  return body;
}

/**
 * L'écran d'une question (F6 § 5) : son libellé, sa sorte en quatre grands
 * choix, ses réponses possibles pour une liste, « Obligatoire » et « Figure
 * sur la carte ». Une question déjà répondue garde sa sorte ; elle se RETIRE
 * du formulaire, elle ne se supprime pas (`has_answers`, §20.3).
 */
export default function QuestionPage() {
  useBackBar(BACK);
  const params = useParams<{ id: string }>();
  const raw = typeof params?.id === 'string' ? params.id : '';
  const isNew = raw === NEW_QUESTION;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const payload = await listQuestions(controller.signal);
        const question = isNew ? null : (payload.questions.find((q) => String(q.id) === raw) ?? null);
        setLoad(!isNew && !question ? { kind: 'missing' } : { kind: 'ready', payload, question });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (isSessionError(cause)) return;
        setLoad({ kind: 'error', message: errorMessage(cause, 'La question n’a pas pu être chargée.') });
      }
    })();
    return () => controller.abort();
  }, [raw, isNew]);

  if (load.kind === 'loading') return <Skeleton label="Chargement de la question…" />;
  if (load.kind === 'missing') return <EmptyState>Cette question n’existe plus.</EmptyState>;
  if (load.kind === 'error') return <Notice tone="late">{load.message}</Notice>;

  return <QuestionEditor key={raw} payload={load.payload} question={load.question} />;
}

function QuestionEditor({ payload, question }: { payload: QuestionsPayload; question: Question | null }) {
  const router = useRouter();
  const { limits } = payload;
  const types = (limits.types.length > 0 ? limits.types : ['text', 'choice', 'yes_no', 'date']) as QuestionType[];
  const [label, setLabel] = useState(question?.label ?? '');
  const [type, setType] = useState<QuestionType>(question?.type ?? (types[0] as QuestionType));
  const [options, setOptions] = useState<string[]>(
    question && question.options.length > 0 ? question.options : Array.from({ length: limits.options_min }, () => ''),
  );
  const [required, setRequired] = useState(question?.required ?? false);
  const [onCard, setOnCard] = useState(question?.on_card ?? false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (question?.archived) {
    return (
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-3">
        <h1 className="title m-0 break-words">{question.label}</h1>
        <Notice tone="due">
          Cette question est retirée du formulaire. Les réponses déjà données restent sur les fiches.
        </Notice>
        <Link href={QUESTIONS_PATH} className={LINK_BUTTON}>
          Revenir aux questions
        </Link>
      </div>
    );
  }

  const locked = question?.has_answers === true;
  const cardable = limits.card_types.includes(type);
  const othersOnCard = activeQuestions(payload.questions).filter((q) => q.on_card && q.id !== question?.id).length;
  const cardFull = othersOnCard >= limits.max_on_card;

  async function save() {
    if (busy) return;
    setErrors({});
    setFormError(null);
    setBusy(true);
    const body = questionBody({ label, type, options, required, onCard }, question, limits.card_types);
    try {
      if (question) await updateQuestion(question.id, body);
      else await createQuestion(body as QuestionInput);
      setFlash(question ? 'La question est enregistrée.' : 'La question est ajoutée au formulaire.');
      router.push(QUESTIONS_PATH);
    } catch (cause) {
      setBusy(false);
      if (isSessionError(cause)) return;
      const fields = fieldMessages(cause);
      if (Object.keys(fields).length > 0) {
        setErrors(placeErrors(fields));
        return;
      }
      setFormError(errorMessage(cause, 'La question n’a pas pu être enregistrée.'));
    }
  }

  async function remove() {
    if (!question || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      if (question.has_answers) await archiveQuestion(question.id);
      else await deleteQuestion(question.id);
      setFlash(question.has_answers ? 'La question est retirée du formulaire.' : 'La question est supprimée.');
      router.push(QUESTIONS_PATH);
    } catch (cause) {
      setBusy(false);
      if (isSessionError(cause)) return;
      // 409 question_has_answers : quelqu'un a répondu entre-temps — le message de l'API le dit.
      setFormError(cause instanceof ApiError && cause.message ? cause.message : errorMessage(cause, 'La question n’a pas pu être retirée.'));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-5">
      <h1 className="title m-0">{question ? 'Modifier la question' : 'Nouvelle question'}</h1>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor="question-libelle" className="font-semibold">
          La question
        </label>
        <input
          id="question-libelle"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-invalid={errors.label ? true : undefined}
          aria-describedby="question-libelle-aide"
          placeholder="Par exemple : Spécialité"
          className={inputClass(!!errors.label)}
        />
        <span id="question-libelle-aide" className="small text-ink-muted">
          C’est la phrase que le membre lit, et le titre de sa colonne dans le fichier Excel.
        </span>
        {errors.label ? <span className="small font-semibold text-late">{errors.label}</span> : null}
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={locked} aria-describedby={locked ? 'sorte-verrouillee' : undefined}>
        <legend className="mb-2 p-0 font-semibold">La sorte de question</legend>
        <div className="grid grid-cols-2 gap-2">
          {types.map((value) => (
            <label
              key={value}
              className="flex min-h-14 cursor-pointer flex-col justify-center gap-[2px] rounded-[var(--radius-md)] border border-line-strong bg-surface-raised p-3 has-[:checked]:border-2 has-[:checked]:border-indigo has-[:checked]:bg-indigo-soft has-[:disabled]:cursor-default has-[:disabled]:opacity-70"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="sorte"
                  checked={type === value}
                  onChange={() => setType(value)}
                  className="size-5 shrink-0 accent-indigo"
                />
                <b>{sortLabel(value)}</b>
              </span>
              <span className="small text-ink-muted">{SORT_HINTS[value] ?? ''}</span>
            </label>
          ))}
        </div>
        {locked ? (
          <span id="sorte-verrouillee" className="small text-ink-muted">
            Des membres ont déjà répondu : la sorte de cette question ne peut plus changer.
          </span>
        ) : null}
        {errors.type ? <span className="small font-semibold text-late">{errors.type}</span> : null}
      </fieldset>

      {type === 'choice' ? (
        <AnswersEditor
          values={options}
          limits={limits}
          errors={errors}
          onChange={setOptions}
        />
      ) : null}

      <div className="flex flex-col gap-3">
        <label className="flex min-h-12 cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="mt-[2px] size-5 shrink-0 accent-indigo"
          />
          <span className="flex flex-col">
            <b>Obligatoire</b>
            <span className="small text-ink-muted">
              Sur la page « Adhérer » seulement : le bureau peut toujours enregistrer un membre sans
              sa réponse.
            </span>
          </span>
        </label>
        {errors.required ? <span className="small font-semibold text-late">{errors.required}</span> : null}

        {cardable ? (
          <label className="flex min-h-12 cursor-pointer items-start gap-3 has-[:disabled]:cursor-default">
            <input
              type="checkbox"
              checked={onCard}
              disabled={!onCard && cardFull}
              onChange={(e) => setOnCard(e.target.checked)}
              aria-describedby="carte-aide"
              className="mt-[2px] size-5 shrink-0 accent-indigo"
            />
            <span className="flex flex-col">
              <b>Figure sur la carte</b>
              <span id="carte-aide" className="small text-ink-muted">
                {!onCard && cardFull
                  ? `${limits.max_on_card} questions figurent déjà sur la carte : c’est le maximum. Retirez-en une de la carte pour y mettre celle-ci.`
                  : 'La réponse s’affiche sur la carte de membre, sous le type de membre.'}
              </span>
            </span>
          </label>
        ) : null}
        {errors.on_card ? <span className="small font-semibold text-late">{errors.on_card}</span> : null}
      </div>

      {formError ? <Notice tone="late">{formError}</Notice> : null}

      <div className="flex flex-col gap-[10px]">
        <button type="button" disabled={busy} onClick={() => void save()} className={bigButtonClass('primary')}>
          {question ? 'Enregistrer la question' : 'Ajouter la question'}
        </button>
        <Link href={QUESTIONS_PATH} className={`${LINK_BUTTON} text-center`}>
          Annuler
        </Link>
      </div>

      {question ? (
        <section className="flex flex-col gap-2 border-t border-line pt-4">
          {confirmRemove ? (
            <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border-2 border-late bg-late-soft p-4" role="alertdialog" aria-label="Confirmer">
              <p className="m-0 font-semibold">
                {question.has_answers
                  ? `Retirer « ${question.label} » du formulaire ? Elle ne sera plus posée ; les réponses déjà données restent sur les fiches et dans le fichier Excel.`
                  : `Supprimer « ${question.label} » ? Personne n’y a encore répondu.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button tone="danger" disabled={busy} onClick={() => void remove()}>
                  {question.has_answers ? 'Retirer du formulaire' : 'Supprimer'}
                </Button>
                <Button disabled={busy} onClick={() => setConfirmRemove(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmRemove(true)} className={bigButtonClass('outline-red')}>
              {question.has_answers ? 'Retirer du formulaire' : 'Supprimer'}
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Les réponses possibles d'une liste de choix : ajouter, retirer, entre
 * `options_min` et `options_max` — les deux SERVIES (§20.2).
 */
function AnswersEditor({
  values,
  limits,
  errors,
  onChange,
}: {
  values: string[];
  limits: QuestionLimits;
  errors: Errors;
  onChange: (values: string[]) => void;
}) {
  const canAdd = values.length < limits.options_max;
  const canRemove = values.length > limits.options_min;
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 font-semibold">Les réponses possibles</legend>
      <span className="small text-ink-muted">
        De {limits.options_min} à {limits.options_max}. Au-delà de cinq, le membre les voit dans une
        liste déroulante.
      </span>
      {values.map((value, index) => (
        <div key={index} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              value={value}
              aria-label={`Réponse possible n° ${index + 1}`}
              aria-invalid={errors[`reponse-${index}`] ? true : undefined}
              onChange={(e) => onChange(values.map((v, i) => (i === index ? e.target.value : v)))}
              className={inputClass(!!errors[`reponse-${index}`])}
            />
            <Button
              tone="ghost"
              disabled={!canRemove}
              aria-label={`Retirer la réponse possible n° ${index + 1}`}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
              className="shrink-0 text-late!"
            >
              Retirer
            </Button>
          </div>
          {errors[`reponse-${index}`] ? (
            <span className="small font-semibold text-late">{errors[`reponse-${index}`]}</span>
          ) : null}
        </div>
      ))}
      {errors.reponses ? <span className="small font-semibold text-late">{errors.reponses}</span> : null}
      <span>
        <Button disabled={!canAdd} onClick={() => onChange([...values, ''])}>
          Ajouter une réponse possible
        </Button>
      </span>
    </fieldset>
  );
}
