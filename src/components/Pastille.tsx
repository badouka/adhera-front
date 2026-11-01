import type { ReactNode } from 'react';

export type PastilleTone = 'paid' | 'due' | 'late' | 'info' | 'muted';

/**
 * La pastille de statut. Les trois tonalités de cotisation viennent de
 * tokens.css : --paid (à jour), --due (à régler), --late (en retard). `info`
 * reprend l'indigo pour la déclaration en attente ; `muted` est le gris de ce
 * qui reste visible sans compter.
 */
const TONES: Record<PastilleTone, string> = {
  paid: 'bg-surface-raised text-paid',
  due: 'bg-due-soft text-due',
  late: 'bg-late-soft text-late',
  info: 'bg-indigo-soft text-indigo',
  // Ce qui existe sans être réclamé (arriéré non réclamé, §12.3).
  muted: 'border border-line bg-surface text-ink-muted',
};

export function Pastille({
  tone,
  children,
  icon,
}: {
  tone: PastilleTone;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <span
      className={`small inline-flex shrink-0 items-center gap-[6px] rounded-full px-[10px] py-1 font-semibold ${TONES[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}
