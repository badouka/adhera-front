/**
 * Les mots des écrans des questions (§20, lexique S6) : « question », « sorte
 * de question », « réponses possibles », « figure sur la carte » — jamais
 * « champ », « type », « option » (garde-fou à l'appui, sur ces fichiers).
 */

import type { Question, QuestionLimits, QuestionType } from '@/lib/bureau/types';

export const QUESTIONS_PATH = '/bureau/questions';
export const NEW_QUESTION = 'nouvelle';

export const SORT_LABELS: Record<QuestionType, string> = {
  text: 'Texte',
  choice: 'Liste de choix',
  yes_no: 'Oui / Non',
  date: 'Date',
};

/** Ce que la sorte demande au membre, sous chaque grand choix. */
export const SORT_HINTS: Record<QuestionType, string> = {
  text: 'Le membre écrit sa réponse.',
  choice: 'Le membre choisit une réponse dans votre liste.',
  yes_no: 'Le membre répond oui ou non.',
  date: 'Le membre choisit une date.',
};

export function sortLabel(type: string): string {
  return SORT_LABELS[type as QuestionType] ?? type;
}

/** « Liste de choix · obligatoire · figure sur la carte ». */
export function questionMeta(question: Question): string {
  return [
    sortLabel(question.type),
    question.required ? 'obligatoire' : null,
    question.on_card ? 'figure sur la carte' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function activeQuestions(questions: Question[]): Question[] {
  return questions.filter((q) => !q.archived).sort((a, b) => a.position - b.position);
}

export function archivedQuestions(questions: Question[]): Question[] {
  return questions.filter((q) => q.archived);
}

/** La phrase qui dit pourquoi « Ajouter une question » est grisé : la borne est SERVIE. */
export function fullFormSentence(limits: QuestionLimits): string {
  return `Votre formulaire porte déjà ${limits.max_active} questions, et c’est le maximum : un formulaire plus long se fait abandonner. Retirez-en une pour en ajouter une autre.`;
}

/** §20.9, FON-21 — la seule place où le bureau peut l'apprendre. */
export const IMPORT_SENTENCE =
  'Les réponses figurent dans le fichier Excel des membres, mais un import ne les relit pas : corrigées dans Excel puis réimportées, elles seraient perdues.';
