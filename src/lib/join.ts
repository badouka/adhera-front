/**
 * L'adhésion en ligne — les deux routes PUBLIQUES (§17.3, §17.4, §20.4).
 *
 * Aucune authentification : le tenant vient de `X-Tenant-Slug`. R2 : les deux
 * appels partent du NAVIGATEUR (limiteur `membership-join`, 20/h par IP et 5/h
 * par téléphone). R5 : `cache: 'no-store'`.
 *
 * ⚠️ Fonctionnalité éteinte = `404 Tenant not found.`, au même octet qu'un slug
 * inconnu (§17.1) : la page ne doit RIEN en déduire, et affiche la même page
 * introuvable dans les deux cas.
 */

import { API_BASE, ApiError, headers, toApiError } from './api';

export type JoinCategory = {
  id: number;
  label: string;
  /** `null` quand le montant n'est pas fixe — jamais « 0 FCFA » (§17.3). */
  amount_formatted: string | null;
  mode: string;
};

export type QuestionType = 'text' | 'choice' | 'yes_no' | 'date' | 'file';

/** §20.4 — une question ACTIVE, sans réglage du bureau (`on_card`…). */
export type JoinQuestion = {
  id: number;
  label: string;
  type: QuestionType | string;
  /** `[]` hors `choice`, jamais `null`. */
  options: string[];
  required: boolean;
};

export type EmailMode = 'hidden' | 'optional' | 'required';
/** §21.2 — la photo à l'adhésion. `hidden` : le champ disparaît (une photo postée serait ignorée). */
export type PhotoMode = 'hidden' | 'optional' | 'required';
export type AdmissionMode = 'bureau' | 'premier_paiement';

export type JoinForm = {
  organisation: { name: string; logo_url: string | null; icon_url?: string | null };
  admission_mode: AdmissionMode | string;
  categories: JoinCategory[];
  /** « Aminata D. » ; `null`, EN SILENCE, pour un code invalide (§17.3). */
  referrer: { display_name: string } | null;
  /** Composé par le serveur : affiché tel quel, jamais réécrit (piège 4). */
  consent_text: string;
  /** `null` : aucun encart. */
  intro?: string | null;
  ask_region?: boolean;
  email_mode?: EmailMode | string;
  /** §21.2 — absent d'un serveur antérieur à S7 : lu comme `hidden`. */
  photo_mode?: PhotoMode | string;
  questions?: JoinQuestion[];
};

/** Une réponse telle qu'elle part : texte, option, date `AAAA-MM-JJ`, ou oui/non. */
export type AnswerValue = string | boolean;

export type JoinInput = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  region: string | null;
  category_id: number;
  referral_code: string | null;
  answers: Record<string, AnswerValue>;
  /** §21.1 — les pièces, par identifiant de question `file`. */
  files: Record<string, File>;
  photo: File | null;
  /** Le pot de miel : vide pour un humain, toujours envoyé tel quel. */
  website: string;
};

export type JoinResult = {
  message: string;
  /** Le lien personnel : jamais renvoyé une seconde fois. `null` : pot de miel. */
  member_url: string | null;
};

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, null, 'Réseau indisponible');
  }
}

/** `GET membership/join[?parrain=]` — ce que la page affiche. */
export async function fetchJoinForm(
  tenant: string,
  parrain: string | null,
  signal?: AbortSignal,
): Promise<JoinForm> {
  const query = parrain ? `?${new URLSearchParams({ parrain }).toString()}` : '';
  const response = await send(`${API_BASE}/membership/join${query}`, {
    method: 'GET',
    headers: headers(tenant),
    signal,
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as JoinForm;
}

/**
 * `POST membership/join` — la demande. `idempotencyKey` est celle de
 * L'OUVERTURE du formulaire (piège 3) : un double clic ou un réessai après une
 * coupure rejoue la même, et le serveur ne crée pas de seconde ligne.
 */
export async function submitJoin(
  tenant: string,
  input: JoinInput,
  idempotencyKey: string,
): Promise<JoinResult> {
  const body: Record<string, unknown> = {
    type: 'personne',
    first_name: input.first_name,
    last_name: input.last_name,
    phone: input.phone,
    category_id: input.category_id,
    consent: true,
    website: input.website,
  };
  if (input.email) body.email = input.email;
  if (input.region) body.region = input.region;
  if (input.referral_code) body.referral_code = input.referral_code;
  if (Object.keys(input.answers).length > 0) body.answers = input.answers;

  const withFiles = input.photo !== null || Object.keys(input.files).length > 0;
  const response = await send(`${API_BASE}/membership/join`, {
    method: 'POST',
    // §21.1 — UNE requête, avec tout : du multipart dès qu'il y a un fichier,
    // du JSON sinon. Pas de Content-Type manuel en multipart : le navigateur
    // pose la frontière.
    headers: withFiles
      ? { ...headers(tenant), 'Idempotency-Key': idempotencyKey }
      : { ...headers(tenant), 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: withFiles ? joinFormData(body, input) : JSON.stringify(body),
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as JoinResult;
}

/**
 * La demande en `multipart/form-data` (§21.1) : les champs, `answers[{id}]`
 * pour chaque réponse (texte ou pièce), `photo`. Un oui/non part en `1` / `0`,
 * le consentement en `1` — deux formes que l'API accepte (§20.4).
 */
export function joinFormData(body: Record<string, unknown>, input: JoinInput): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (key === 'answers' || value === null || value === undefined) continue;
    form.set(key, value === true ? '1' : String(value));
  }
  for (const [id, value] of Object.entries(input.answers)) {
    form.set(`answers[${id}]`, typeof value === 'boolean' ? (value ? '1' : '0') : value);
  }
  for (const [id, file] of Object.entries(input.files)) form.set(`answers[${id}]`, file);
  if (input.photo) form.set('photo', input.photo);
  return form;
}
