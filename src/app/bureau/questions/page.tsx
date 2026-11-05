'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useBackBar } from '@/components/bureau/BureauContext';
import { bigButtonClass, Button, EmptyState, Notice, Skeleton, Toast } from '@/components/bureau/ui';
import { isSessionError } from '@/lib/bureau/api/core';
import { listQuestions, reorderQuestions } from '@/lib/bureau/api/questions';
import { takeFlash } from '@/lib/bureau/flash';
import { errorMessage } from '@/lib/bureau/messages';
import type { Question, QuestionsPayload } from '@/lib/bureau/types';
import {
  activeQuestions,
  archivedQuestions,
  fullFormSentence,
  IMPORT_SENTENCE,
  NEW_QUESTION,
  questionMeta,
  QUESTIONS_PATH,
} from './words';

const BACK = { href: '/bureau/plus', label: 'Plus' };

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; payload: QuestionsPayload };

/** L'ordre après un déplacement d'un cran ; `null` au bord de la liste. */
export function moved(ids: number[], index: number, delta: -1 | 1): number[] | null {
  const target = index + delta;
  if (target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target] as number, next[index] as number];
  return next;
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg aria-hidden="true" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}

/**
 * « Les questions de l'association » (F6 § 5, §20.1 à §20.3) : la liste des
 * questions posées sur la page « Adhérer », dans leur ordre. Monter et
 * descendre avec deux flèches — le glisser-déposer échoue sur un téléphone.
 * Toutes les bornes viennent de `limits` : aucune n'est écrite ici.
 */
export default function QuestionsPage() {
  useBackBar(BACK);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    const flash = takeFlash();
    if (flash) setToast(flash);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setLoad({ kind: 'ready', payload: await listQuestions(controller.signal) });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (isSessionError(cause)) return;
        setLoad({ kind: 'error', message: errorMessage(cause, 'Les questions n’ont pas pu être chargées.') });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  if (load.kind === 'loading') return <Skeleton label="Chargement des questions…" />;
  if (load.kind === 'error') {
    return (
      <Notice tone="late">
        <span>{load.message}</span>
        <span>
          <Button onClick={() => setAttempt((n) => n + 1)}>Réessayer</Button>
        </span>
      </Notice>
    );
  }

  const { payload } = load;
  const { limits } = payload;
  const active = activeQuestions(payload.questions);
  const archived = archivedQuestions(payload.questions);
  const full = active.length >= limits.max_active;

  async function move(index: number, delta: -1 | 1) {
    const ids = moved(active.map((q) => q.id), index, delta);
    if (!ids || busy || load.kind !== 'ready') return;
    const before = load.payload;
    // Le déplacement se voit tout de suite ; la réponse du serveur fait foi.
    const byId = new Map(active.map((q) => [q.id, q]));
    const optimistic: Question[] = ids.map((id, position) => ({ ...(byId.get(id) as Question), position }));
    setLoad({ kind: 'ready', payload: { ...before, questions: [...optimistic, ...archived] } });
    setBusy(true);
    setError(null);
    try {
      const { questions } = await reorderQuestions(ids);
      setLoad({ kind: 'ready', payload: { ...before, questions: [...questions, ...archived] } });
    } catch (cause) {
      setLoad({ kind: 'ready', payload: before });
      if (!isSessionError(cause)) setError(errorMessage(cause, 'L’ordre n’a pas pu être enregistré.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="title m-0">Les questions de l’association</h1>
        <p className="m-0 text-ink-muted">
          Elles sont posées sur la page « Adhérer », dans cet ordre, et lues sur la fiche de chaque
          membre. {limits.max_active} questions au plus, dont {limits.max_on_card} sur la carte de
          membre.
        </p>
      </div>

      {error ? <Notice tone="late">{error}</Notice> : null}

      {active.length === 0 ? (
        <EmptyState>Aucune question pour l’instant : le formulaire demande le nom, le téléphone et le type de membre.</EmptyState>
      ) : (
        <ol className="m-0 flex list-none flex-col overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-raised p-0" data-testid="questions">
          {active.map((question, index) => (
            <li key={question.id} className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0">
              <span className="tnum w-6 shrink-0 text-center font-bold text-ink-muted">{index + 1}</span>
              <Link
                href={`${QUESTIONS_PATH}/${question.id}`}
                className="flex min-h-12 min-w-0 grow flex-col justify-center text-ink! no-underline"
              >
                <span className="font-semibold break-words">{question.label}</span>
                <span className="small text-ink-muted">{questionMeta(question)}</span>
              </Link>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label={`Monter « ${question.label} »`}
                  disabled={busy || index === 0}
                  onClick={() => void move(index, -1)}
                  className="flex size-11 items-center justify-center rounded-[var(--radius-sm)] border border-line-strong bg-surface-raised text-indigo disabled:opacity-40"
                >
                  <Arrow up />
                </button>
                <button
                  type="button"
                  aria-label={`Descendre « ${question.label} »`}
                  disabled={busy || index === active.length - 1}
                  onClick={() => void move(index, 1)}
                  className="flex size-11 items-center justify-center rounded-[var(--radius-sm)] border border-line-strong bg-surface-raised text-indigo disabled:opacity-40"
                >
                  <Arrow up={false} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {full ? (
        <div className="flex flex-col gap-2">
          <button type="button" disabled aria-describedby="questions-pleines" className={bigButtonClass('outline-indigo')}>
            Ajouter une question
          </button>
          <p id="questions-pleines" className="small m-0 text-ink-muted">
            {fullFormSentence(limits)}
          </p>
        </div>
      ) : (
        <Link href={`${QUESTIONS_PATH}/${NEW_QUESTION}`} className={bigButtonClass('outline-indigo')}>
          Ajouter une question
        </Link>
      )}

      <p className="small m-0 text-ink-muted" data-testid="import-sentence">
        {IMPORT_SENTENCE}
      </p>

      {archived.length > 0 ? (
        <details className="group rounded-[var(--radius-md)] border border-line bg-surface-raised px-4" data-testid="archived">
          <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span>Questions retirées ({archived.length})</span>
            <span className="small font-semibold text-indigo group-open:hidden">Voir</span>
            <span className="small hidden font-semibold text-indigo group-open:inline">Masquer</span>
          </summary>
          <p className="small m-0 text-ink-muted">
            Elles ne sont plus posées. Les réponses déjà données restent sur les fiches et dans le
            fichier Excel.
          </p>
          <ul className="m-0 flex list-none flex-col p-0 pb-2">
            {archived.map((question) => (
              <li key={question.id} className="flex flex-col border-t border-line py-2 first:mt-2">
                <span className="font-semibold break-words">{question.label}</span>
                <span className="small text-ink-muted">{questionMeta(question)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}
