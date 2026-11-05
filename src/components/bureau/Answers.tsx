'use client';

import { useState } from 'react';
import { isSessionError } from '@/lib/bureau/api/core';
import { getFileLink } from '@/lib/bureau/api/members';
import { errorMessage } from '@/lib/bureau/messages';
import { openPendingTab } from '@/lib/bureau/pendingTab';
import type { MemberAnswer } from '@/lib/bureau/types';

/**
 * §21.5 — une pièce justificative : son NOM d'origine (ce que le bureau
 * reconnaît), et un lien demandé AU CLIC, valable 5 minutes. Jamais un lien
 * servi d'avance : il serait périmé avant le clic.
 */
function FileAnswer({ answer }: { answer: MemberAnswer }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const uuid = typeof answer.value === 'string' ? answer.value : null;

  async function open() {
    if (!uuid || busy) return;
    setBusy(true);
    setProblem(null);
    // L'onglet s'ouvre au clic : un `window.open` après un `await` est bloqué.
    const tab = openPendingTab();
    try {
      const link = await getFileLink(uuid);
      if (!tab.go(link.url)) setBlocked(link.url);
    } catch (cause) {
      tab.close();
      if (!isSessionError(cause)) setProblem(errorMessage(cause, 'Le document n’a pas pu être ouvert.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <span className="break-words">{answer.value_label}</span>
      {uuid ? (
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          className="bg-transparent p-0 text-left font-semibold text-indigo underline underline-offset-2 disabled:opacity-60"
        >
          {busy ? 'Ouverture…' : 'Ouvrir le document'}
        </button>
      ) : null}
      {blocked ? (
        <a href={blocked} target="_blank" rel="noopener noreferrer" className="small font-semibold">
          L’onglet ne s’est pas ouvert : l’ouvrir maintenant
        </a>
      ) : null}
      {problem ? <span className="small font-semibold text-late">{problem}</span> : null}
    </span>
  );
}

/**
 * §20.6 — les réponses aux questions de l'association, telles que le serveur
 * les LIBELLE (`value_label` : « 3 mars 1998 », « Oui »). Une question sans
 * réponse s'affiche vide, elle ne disparaît pas ; une question retirée est
 * marquée, en lecture seule. Une valeur absente des réponses possibles
 * actuelles est juste : c'est ce que le membre a déclaré.
 */
export function AnswersList({
  answers,
  testId = 'answers',
}: {
  answers: MemberAnswer[];
  testId?: string;
}) {
  if (answers.length === 0) return null;
  return (
    <dl className="m-0 flex flex-col gap-3" data-testid={testId}>
      {answers.map((answer) => (
        <div key={answer.question_id} className="flex min-w-0 flex-col">
          <dt className="label text-ink-muted">
            {answer.label}
            {answer.archived ? ' (question retirée)' : ''}
          </dt>
          <dd className={`m-0 break-words ${answer.value_label ? '' : 'text-ink-muted'}`}>
            {answer.type === 'file' && answer.value_label ? (
              <FileAnswer answer={answer} />
            ) : (
              answer.value_label?.trim() || 'Pas de réponse'
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** §21.3 — la photo d'un membre ou d'un candidat (lien signé, 60 minutes). */
export function MemberPhoto({ url, name, size = 72 }: { url: string | null | undefined; name: string; size?: number }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt={`Photo de ${name}`}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      style={{ width: size, height: size }}
      className="shrink-0 rounded-[var(--radius-sm)] border border-line object-cover"
      data-testid="member-photo"
    />
  );
}
