import type { MemberAnswer } from '@/lib/bureau/types';

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
            {answer.value_label?.trim() || 'Pas de réponse'}
          </dd>
        </div>
      ))}
    </dl>
  );
}
