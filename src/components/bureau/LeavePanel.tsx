'use client';

import { useState } from 'react';
import { isSessionError, leaveMember } from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import { LEFT_REASONS, type LeftReason, type MemberDetail } from '@/lib/bureau/types';
import { formatDate, todayInDakar } from '@/lib/dates';
import { ConfirmDialog, Recap } from './ConfirmDialog';
import { dateError } from './format';
import { Button, Field, inputClass, Panel } from './ui';

/**
 * B10 — la sortie d'un membre. C'est la SEULE sortie : il n'existe aucune
 * suppression, et l'interface n'en propose pas. Le membre passe dans les
 * anciens membres, son historique financier reste.
 */
export function LeavePanel({
  member,
  onDone,
  onClose,
}: {
  member: MemberDetail;
  onDone: (updated: MemberDetail) => void;
  onClose: () => void;
}) {
  const [leftAt, setLeftAt] = useState(todayInDakar());
  const [reason, setReason] = useState<LeftReason | ''>('');
  const [errors, setErrors] = useState<{ left_at?: string; reason?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonLabel = LEFT_REASONS.find((r) => r.value === reason)?.label ?? '';

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof errors = {};
    const invalid = dateError(leftAt, 'la date de sortie');
    if (invalid) next.left_at = invalid;
    if (reason === '') next.reason = 'Choisissez le motif de la sortie.';
    setErrors(next);
    if (Object.keys(next).length === 0) {
      setError(null);
      setConfirming(true);
    }
  }

  async function confirm() {
    if (busy || reason === '') return;
    setBusy(true);
    setError(null);
    try {
      onDone(await leaveMember(member.id, leftAt, reason));
    } catch (cause) {
      if (isSessionError(cause)) return;
      setError(errorMessage(cause, 'La sortie n’a pas pu être enregistrée.'));
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Déclarer une sortie"
      actions={
        <Button tone="ghost" onClick={onClose}>
          Fermer
        </Button>
      }
    >
      <form className="m-0 flex flex-col gap-4" onSubmit={review} noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date de sortie" required error={errors.left_at}>
            {(props) => (
              <input
                {...props}
                type="date"
                max={todayInDakar()}
                value={leftAt}
                onChange={(e) => setLeftAt(e.target.value)}
                className={inputClass(!!errors.left_at)}
              />
            )}
          </Field>
          <Field label="Motif" required error={errors.reason}>
            {(props) => (
              <select
                {...props}
                value={reason}
                onChange={(e) => setReason(e.target.value as LeftReason | '')}
                className={inputClass(!!errors.reason)}
              >
                <option value="">Choisir…</option>
                {LEFT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="flex justify-end">
          <Button tone="danger" type="submit">
            Vérifier la sortie
          </Button>
        </div>
      </form>

      {confirming ? (
        <ConfirmDialog
          title="Déclarer la sortie de ce membre ?"
          confirmLabel="Déclarer la sortie"
          confirmTone="danger"
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={() => setConfirming(false)}
        >
          <Recap
            rows={[
              { label: 'Membre', value: member.name },
              { label: 'Date de sortie', value: formatDate(leftAt) },
              { label: 'Motif', value: reasonLabel },
            ]}
          />
          <p className="m-0">
            Le membre passera dans les anciens membres. Son historique est
            conservé.
          </p>
        </ConfirmDialog>
      ) : null}
    </Panel>
  );
}
