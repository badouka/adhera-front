/**
 * Déduction de l'état affiché. R4 : on branche sur le `code`, jamais sur le
 * message.
 */

import { ApiError } from './api';
import type { MemberPayload, MemberState, ScreenState } from './types';

/**
 * L'ordre compte : une déclaration en attente masque le formulaire (E4) même si
 * une cotisation reste due, et un montant non fixé (E5) le masque aussi, car le
 * serveur répondrait `amount_due_unknown`.
 */
export function resolveMemberState(payload: MemberPayload): MemberState {
  if (payload.pending_declaration) return 'E4';

  const { due } = payload;
  if (due) {
    if (due.amount_due === null) return 'E5';
    return due.status === 'partielle' ? 'E3b' : 'E3';
  }

  return payload.standing.is_up_to_date ? 'E2' : 'E6';
}

/** Un échec de `GET /m/{token}` → l'écran correspondant. */
export function screenForError(error: unknown): ScreenState {
  if (!(error instanceof ApiError)) return { kind: 'E9', rateLimited: false };

  // Un jeton inconnu et un ancien membre rendent le même 404 : jamais de
  // « vous avez été radié ».
  if (error.status === 404) return { kind: 'E1' };

  // 403 feature_disabled · tenant_inactive · trial_expired · license_expired
  // 409 cotisation_mode_unsupported
  if (error.status === 403 || error.status === 409) return { kind: 'E8' };

  if (error.status === 429) return { kind: 'E9', rateLimited: true };

  return { kind: 'E9', rateLimited: false };
}
