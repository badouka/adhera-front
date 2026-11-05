/**
 * Les questions de l'association (§20.2). Les six routes répondent SANS
 * enveloppe : une question créée ou modifiée revient à la racine.
 */

import { request } from './core';
import type { Question, QuestionInput, QuestionsPayload } from '../types';

const seg = (id: number) => encodeURIComponent(String(id));

/** La liste, archivées comprises (en fin de liste), et les bornes. */
export function listQuestions(signal?: AbortSignal) {
  return request<QuestionsPayload>('membership/questions', { signal });
}

export function createQuestion(input: QuestionInput) {
  return request<Question>('membership/questions', { method: 'POST', json: input });
}

/** Un lot PARTIEL est valide : `{ on_card: false }` seul. */
export function updateQuestion(id: number, input: Partial<QuestionInput>) {
  return request<Question>(`membership/questions/${seg(id)}`, { method: 'PUT', json: input });
}

/** Rend les questions ACTIVES dans le nouvel ordre. */
export function reorderQuestions(ids: number[]) {
  return request<{ questions: Question[] }>('membership/questions/order', {
    method: 'PUT',
    json: { ids },
  });
}

/** « Retirer du formulaire » : les réponses déjà données restent sur les fiches. */
export function archiveQuestion(id: number) {
  return request<Question>(`membership/questions/${seg(id)}/archive`, { method: 'POST' });
}

/** « Supprimer » : seulement si personne n'a répondu (`409 question_has_answers`). */
export function deleteQuestion(id: number) {
  return request<{ deleted: boolean }>(`membership/questions/${seg(id)}`, { method: 'DELETE' });
}
