'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loading, TechnicalError } from '@/components/Fallbacks';
import { BrokenLinkIcon, CheckIcon } from '@/components/Icons';
import { Shell } from '@/components/Shell';
import { ApiError, fieldMessages } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { MAX_FILE_BYTES, PHOTO_ACCEPT, TOO_LARGE } from '@/lib/files';
import { useIdempotencyKey } from '@/lib/idempotency';
import {
  fetchJoinForm,
  submitJoin,
  type AnswerValue,
  type JoinCategory,
  type JoinForm,
  type JoinQuestion,
} from '@/lib/join';
import { phoneDigits, spacedPhone } from '@/lib/phone';
import { resolveTenant } from '@/lib/tenant';
import { whatsappLink } from '@/lib/whatsapp';

/** La liste de la maquette : les 14 régions, et l'étranger. */
export const REGIONS: ReadonlyArray<string> = [
  'Dakar', 'Diourbel', 'Fatick', 'Kaffrine', 'Kaolack', 'Kédougou', 'Kolda', 'Louga',
  'Matam', 'Saint-Louis', 'Sédhiou', 'Tambacounda', 'Thiès', 'Ziguinchor', 'Hors du Sénégal',
];

/** Au-delà, une liste déroulante : la liste des fonctions du CAP est longue (F6 § 1). */
export const MAX_CHOICE_BUTTONS = 5;

type Load =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; rateLimited: boolean }
  | { kind: 'ready'; form: JoinForm };

type Sent = { firstName: string; phone: string; memberUrl: string | null; category: JoinCategory | null };

type Errors = Record<string, string>;

/** L'identifiant DOM de chaque champ : c'est lui que l'on fait défiler et que l'on focalise. */
export const fieldId = (key: string) => `adherer-${key.replace(/\./g, '-')}`;

/** « 25 000 FCFA par an », « montant libre » : jamais un blanc, jamais « 0 FCFA » (§17.3). */
export function categoryPrice(category: JoinCategory): string {
  if (!category.amount_formatted) return 'montant libre';
  if (category.mode === 'minimum') return `au moins ${category.amount_formatted} par an`;
  return `${category.amount_formatted} par an`;
}

/** Une réponse vide n'est pas une réponse (§20.4) : elle ne part pas. */
function isAnswered(value: AnswerValue | undefined): value is AnswerValue {
  return typeof value === 'boolean' || (typeof value === 'string' && value.trim() !== '');
}

/**
 * La validation LOCALE ne dit que ce que l'API dirait (F6 § 1) : un champ
 * obligatoire vide, un téléphone trop court. Tout le reste est jugé par le
 * serveur, et ses `422` s'affichent sous le bon champ.
 */
export function validateJoin(
  form: JoinForm,
  values: {
    categoryId: number | null;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    consent: boolean;
    answers: Record<string, AnswerValue>;
    files?: Record<string, File>;
    photo?: File | null;
  },
): Errors {
  const errors: Errors = {};
  if (values.categoryId === null) errors.category_id = 'Choisissez comment vous adhérez.';
  if (!values.firstName.trim()) errors.first_name = 'Écrivez votre prénom.';
  if (!values.lastName.trim()) errors.last_name = 'Écrivez votre nom.';
  const digits = phoneDigits(values.phone);
  if (digits === '') {
    errors.phone = 'Votre numéro de téléphone est indispensable : c’est par là que l’association vous répondra.';
  } else if (digits.length < 9) {
    errors.phone = 'Ce numéro est trop court : écrivez-le en entier, par exemple 77 123 45 67.';
  }
  const photo = values.photo ?? null;
  if (photoMode(form) === 'required' && !photo) {
    errors.photo = 'Envoyez une photo : elle figurera sur votre carte de membre.';
  } else if (photo && photo.size > MAX_FILE_BYTES) {
    errors.photo = TOO_LARGE;
  }
  for (const question of form.questions ?? []) {
    const key = `answers.${question.id}`;
    if (question.type === 'file') {
      const file = values.files?.[String(question.id)];
      if (question.required && !file) errors[key] = `Envoyez un document pour « ${question.label} ».`;
      else if (file && file.size > MAX_FILE_BYTES) {
        errors[key] = `« ${question.label} » : le fichier dépasse la taille maximale de 5 MB.`;
      }
      continue;
    }
    if (question.required && !isAnswered(values.answers[String(question.id)])) {
      errors[key] = `Répondez à la question « ${question.label} ».`;
    }
  }
  if (form.email_mode === 'required' && !values.email.trim()) {
    errors.email = 'Écrivez votre adresse e-mail.';
  }
  if (!values.consent) errors.consent = 'Cochez la case de consentement pour envoyer votre demande.';
  return errors;
}

export { MAX_FILE_BYTES } from '@/lib/files';

/** §21.2 — absent d'un serveur antérieur à S7 : pas de champ photo. */
export function photoMode(form: JoinForm): string {
  return form.photo_mode ?? 'hidden';
}

/** L'ordre des champs à l'écran : la page défile jusqu'au PREMIER en erreur. */
export function fieldOrder(form: JoinForm): string[] {
  return [
    'category_id',
    'first_name',
    'last_name',
    'phone',
    ...(form.ask_region ? ['region'] : []),
    ...(photoMode(form) === 'hidden' ? [] : ['photo']),
    ...(form.questions ?? []).map((q) => `answers.${q.id}`),
    ...(form.email_mode === 'hidden' ? [] : ['email']),
    'consent',
  ];
}

/**
 * `/adherer` — la porte d'entrée publique (F6 § 1). Un inconnu, sur son
 * téléphone : une phrase en haut, une seule page découpée en trois blocs
 * titrés (« Vous », « Vos réponses à l'association », « Pour finir »), un
 * bouton. Pas d'étapes : elles ajoutent des gestes et perdent des saisies quand
 * le téléphone recharge la page.
 *
 * ⚠️ AUCUN ORACLE D'APPARTENANCE (§17.4) : l'écran de confirmation ne dépend
 * que de ce que le visiteur a tapé, jamais de la réponse du serveur sur son
 * numéro.
 */
export function JoinPage({ parrain }: { parrain: string | null }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [tenant, setTenant] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sent, setSent] = useState<Sent | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const slug = resolveTenant(window.location);
    setTenant(slug);
    // Un hôte hors `{slug}.adhera.africa` : la même page qu'une association fermée.
    if (!slug) {
      setLoad({ kind: 'missing' });
      return () => controller.abort();
    }
    void (async () => {
      try {
        setLoad({ kind: 'ready', form: await fetchJoinForm(slug, parrain, controller.signal) });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof ApiError && error.status === 404) setLoad({ kind: 'missing' });
        else setLoad({ kind: 'error', rateLimited: error instanceof ApiError && error.status === 429 });
      }
    })();
    return () => controller.abort();
  }, [parrain, attempt]);

  if (load.kind === 'loading') {
    return (
      <Shell>
        <Loading />
      </Shell>
    );
  }
  if (load.kind === 'missing' || !tenant) {
    return (
      <Shell>
        <JoinMissing />
      </Shell>
    );
  }
  if (load.kind === 'error') {
    return (
      <Shell>
        <TechnicalError rateLimited={load.rateLimited} onRetry={() => setAttempt((n) => n + 1)} />
      </Shell>
    );
  }

  const { form } = load;
  return (
    <Shell organisationName={form.organisation.name} logoUrl={form.organisation.logo_url}>
      {sent ? (
        <JoinSent form={form} sent={sent} />
      ) : (
        <JoinFormView
          form={form}
          tenant={tenant}
          parrain={parrain}
          onSent={setSent}
          onClosed={() => setLoad({ kind: 'missing' })}
        />
      )}
    </Shell>
  );
}

/**
 * La page d'une association sans adhésion en ligne — et celle d'un slug
 * inconnu : la MÊME, mot pour mot (§17.1). Rien ne laisse deviner que
 * l'association existe.
 */
export function JoinMissing() {
  return (
    <div className="flex grow flex-col items-center gap-4 px-2 pt-10 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-late-soft text-late">
        <BrokenLinkIcon />
      </span>
      <h1 className="title m-0">Cette page n’existe pas</h1>
      <p className="m-0 max-w-[300px]">
        Vérifiez le lien que vous avez reçu, ou demandez-le à nouveau à la personne qui vous l’a
        envoyé.
      </p>
    </div>
  );
}

const INPUT =
  'min-h-12 w-full min-w-0 rounded-[var(--radius-sm)] border bg-surface-raised px-3 text-[16px] text-ink';
const inputClass = (invalid: boolean) => `${INPUT} ${invalid ? 'border-late' : 'border-line-strong'}`;
const CHOICE =
  'flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] border border-line-strong bg-surface-raised px-3 py-2 has-[:checked]:border-indigo has-[:checked]:bg-indigo-soft';

function ErrorText({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <span id={`${id}-erreur`} className="small font-semibold text-late">
      {message}
    </span>
  );
}

function described(id: string, error: string | undefined, hint?: boolean): string | undefined {
  return [hint ? `${id}-aide` : null, error ? `${id}-erreur` : null].filter(Boolean).join(' ') || undefined;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4" aria-label={title}>
      <h2 className="heading m-0 border-b border-line pb-2">{title}</h2>
      {children}
    </section>
  );
}

function JoinFormView({
  form,
  tenant,
  parrain,
  onSent,
  onClosed,
}: {
  form: JoinForm;
  tenant: string;
  parrain: string | null;
  onSent: (sent: Sent) => void;
  onClosed: () => void;
}) {
  const categories = form.categories;
  const questions = form.questions ?? [];
  const emailMode = form.email_mode ?? 'optional';
  const [categoryId, setCategoryId] = useState<number | null>(
    categories.length === 1 ? (categories[0]?.id ?? null) : null,
  );
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [region, setRegion] = useState('');
  const [email, setEmail] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const [consent, setConsent] = useState(false);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [website, setWebsite] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [files, setFiles] = useState<Record<string, File>>({});
  // §21.1 — après un refus, RIEN n'a été gardé : les fichiers sont à re-choisir.
  const [reselect, setReselect] = useState(false);
  const [filesKey, setFilesKey] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  // Une clé par OUVERTURE du formulaire (piège 3) — pas par rendu, pas par envoi.
  const [idempotencyKey, renewKey] = useIdempotencyKey();
  const emailRef = useRef<HTMLInputElement>(null);

  // Un message en haut qu'il faut chercher n'est pas un message : la page
  // défile jusqu'au PREMIER champ en erreur et y place le curseur.
  useEffect(() => {
    if (focusTick === 0) return;
    const first = fieldOrder(form).find((key) => errors[key]);
    if (!first) return;
    const target = document.getElementById(fieldId(first));
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target?.focus({ preventScroll: true });
    // Seulement après un envoi refusé.
  }, [focusTick]);

  function setAnswer(id: number, value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [String(id)]: value }));
    setErrors((prev) => {
      const { [`answers.${id}`]: _gone, ...rest } = prev;
      return rest;
    });
  }

  function clear(key: string) {
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _gone, ...rest } = prev;
      return rest;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const local = validateJoin(form, { categoryId, firstName, lastName, phone, email, consent, answers, files, photo });
    if (Object.keys(local).length > 0) {
      setErrors(local);
      setFocusTick((n) => n + 1);
      return;
    }
    setBusy(true);
    const sentAnswers: Record<string, AnswerValue> = {};
    for (const question of questions) {
      if (question.type === 'file') continue;
      const value = answers[String(question.id)];
      if (isAnswered(value)) sentAnswers[String(question.id)] = typeof value === 'string' ? value.trim() : value;
    }
    try {
      const result = await submitJoin(
        tenant,
        {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim(),
          email: emailMode === 'hidden' ? null : email.trim() || null,
          region: form.ask_region ? region || null : null,
          category_id: categoryId as number,
          referral_code: parrain,
          answers: sentAnswers,
          files,
          photo: photoMode(form) === 'hidden' ? null : photo,
          website,
        },
        idempotencyKey,
      );
      window.scrollTo(0, 0);
      onSent({
        firstName: firstName.trim(),
        phone: phone.trim(),
        memberUrl: result.member_url,
        category: categories.find((c) => c.id === categoryId) ?? null,
      });
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiError && error.status === 404) {
        onClosed();
        return;
      }
      if (error instanceof ApiError && error.status === 422) {
        // Rien n'a été créé : la saisie corrigée est une NOUVELLE tentative.
        renewKey();
        if (photo || Object.keys(files).length > 0) {
          setPhoto(null);
          setFiles({});
          setFilesKey((n) => n + 1);
          setReselect(true);
        }
        const fields = fieldMessages(error);
        const known = fieldOrder(form);
        const placed: Errors = {};
        const elsewhere: string[] = [];
        for (const [key, message] of Object.entries(fields)) {
          if (known.includes(key)) placed[key] = message;
          else elsewhere.push(message);
        }
        setErrors(placed);
        if (elsewhere.length > 0 || Object.keys(placed).length === 0) {
          setFormError(elsewhere[0] ?? error.message);
        }
        if (Object.keys(placed).length > 0) setFocusTick((n) => n + 1);
        return;
      }
      setFormError(
        error instanceof ApiError && error.status === 429
          ? 'Trop de demandes depuis ce téléphone. Réessayez dans une heure.'
          : 'Votre demande n’a pas pu être envoyée. Vérifiez votre connexion, puis réessayez : rien n’a été perdu.',
      );
    }
  }

  let step = 0;
  const next = () => (step += 1);
  const review = form.admission_mode !== 'premier_paiement';
  const intro = form.intro?.trim();

  if (categories.length === 0) {
    return (
      <>
        <h1 className="title m-0">Adhérer à l’association</h1>
        <p className="m-0">
          L’adhésion en ligne n’est pas encore ouverte. Contactez l’association pour adhérer.
        </p>
      </>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      {form.referrer?.display_name ? (
        <p className="m-0 rounded-[var(--radius-md)] bg-indigo-soft p-4 font-semibold text-indigo" data-testid="referrer">
          {form.referrer.display_name} vous invite à rejoindre l’association.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <h1 className="title m-0">Adhérer à l’association</h1>
        <p className="m-0 text-ink-muted">
          {review
            ? 'Remplissez ce formulaire. L’association examinera votre demande et vous répondra sur WhatsApp.'
            : 'Remplissez ce formulaire, puis payez votre première cotisation : vous serez membre dès qu’elle sera reçue.'}
        </p>
        {intro ? (
          <p className="m-0 whitespace-pre-line break-words" data-testid="intro">
            {intro}
          </p>
        ) : null}
      </div>

      <Block title="Vous">
        <fieldset
          className="m-0 flex flex-col gap-2 border-0 p-0"
          aria-describedby={described(fieldId('category_id'), errors.category_id)}
        >
          <legend className="mb-2 p-0 font-semibold">{next()}. Vous adhérez comme</legend>
          {categories.map((category, index) => (
            <label key={category.id} className={CHOICE}>
              <input
                type="radio"
                name="category"
                id={index === 0 ? fieldId('category_id') : undefined}
                checked={categoryId === category.id}
                onChange={() => {
                  setCategoryId(category.id);
                  clear('category_id');
                }}
                className="size-5 shrink-0 accent-indigo"
              />
              <span className="grow">{category.label}</span>
              <span className="small text-right text-ink-muted">
                <span className="money">{categoryPrice(category)}</span>
              </span>
            </label>
          ))}
          <ErrorText id={fieldId('category_id')} message={errors.category_id} />
        </fieldset>

        <TextField
          id="first_name"
          label={`${next()}. Votre prénom`}
          value={firstName}
          error={errors.first_name}
          autoComplete="given-name"
          onChange={(v) => {
            setFirstName(v);
            clear('first_name');
          }}
        />
        <TextField
          id="last_name"
          label={`${next()}. Votre nom`}
          value={lastName}
          error={errors.last_name}
          autoComplete="family-name"
          onChange={(v) => {
            setLastName(v);
            clear('last_name');
          }}
        />
        <TextField
          id="phone"
          label={`${next()}. Votre numéro WhatsApp`}
          value={phone}
          error={errors.phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="77 123 45 67"
          hint="L’association vous répondra sur ce numéro."
          onChange={(v) => {
            setPhone(v);
            clear('phone');
          }}
        />
        {form.ask_region ? (
          <div className="flex flex-col gap-[6px]">
            <label htmlFor={fieldId('region')} className="font-semibold">
              {next()}. Votre région
            </label>
            <select
              id={fieldId('region')}
              value={region}
              onChange={(e) => {
                setRegion(e.target.value);
                clear('region');
              }}
              aria-invalid={errors.region ? true : undefined}
              aria-describedby={described(fieldId('region'), errors.region)}
              className={inputClass(!!errors.region)}
            >
              <option value="">Choisissez</option>
              {REGIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <ErrorText id={fieldId('region')} message={errors.region} />
          </div>
        ) : null}
        {photoMode(form) !== 'hidden' ? (
          <FileInput
            key={`photo-${filesKey}`}
            id="photo"
            label={`${next()}. Votre photo`}
            optional={photoMode(form) !== 'required'}
            accept={PHOTO_ACCEPT}
            hint="Elle figurera sur votre carte de membre : votre visage, de face, bien éclairé."
            file={photo}
            preview
            reselect={reselect}
            error={errors.photo}
            onChange={(file) => {
              setPhoto(file);
              clear('photo');
            }}
          />
        ) : null}
      </Block>

      {questions.length > 0 ? (
        <Block title="Vos réponses à l’association">
          {questions.map((question) =>
            question.type === 'file' ? (
              <FileInput
                key={`${question.id}-${filesKey}`}
                id={`answers.${question.id}`}
                label={`${next()}. ${question.label}`}
                optional={!question.required}
                accept="application/pdf,image/jpeg,image/png"
                hint="Un PDF, ou une photo du document (JPEG ou PNG), 5 Mo au plus."
                file={files[String(question.id)] ?? null}
                reselect={reselect}
                error={errors[`answers.${question.id}`]}
                onChange={(file) => {
                  setFiles((prev) => {
                    const { [String(question.id)]: _old, ...rest } = prev;
                    return file ? { ...rest, [String(question.id)]: file } : rest;
                  });
                  clear(`answers.${question.id}`);
                }}
              />
            ) : (
            <QuestionField
              key={question.id}
              number={next()}
              question={question}
              value={answers[String(question.id)]}
              error={errors[`answers.${question.id}`]}
              onChange={(value) => setAnswer(question.id, value)}
            />
            ),
          )}
        </Block>
      ) : null}

      <Block title="Pour finir">
        {emailMode === 'required' ? (
          <TextField
            id="email"
            label={`${next()}. Votre adresse e-mail`}
            value={email}
            error={errors.email}
            type="email"
            inputMode="email"
            autoComplete="email"
            onChange={(v) => {
              setEmail(v);
              clear('email');
            }}
          />
        ) : emailMode === 'optional' ? (
          showEmail || errors.email ? (
            <TextField
              id="email"
              inputRef={emailRef}
              label="Votre adresse e-mail"
              optional
              value={email}
              error={errors.email}
              type="email"
              inputMode="email"
              autoComplete="email"
              onChange={(v) => {
                setEmail(v);
                clear('email');
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowEmail(true);
                setTimeout(() => emailRef.current?.focus(), 0);
              }}
              className="self-start bg-transparent p-0 text-left font-semibold text-link underline underline-offset-2"
            >
              Ajouter une adresse e-mail (facultatif)
            </button>
          )
        ) : null}

        <div className="flex flex-col gap-[6px]">
          <label className={`${CHOICE} items-start`}>
            <input
              id={fieldId('consent')}
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                clear('consent');
              }}
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={described(fieldId('consent'), errors.consent)}
              className="mt-[3px] size-5 shrink-0 accent-indigo"
            />
            {/* Le texte du serveur, tel quel : c'est sur lui que l'on coche (§17.3). */}
            <span className="break-words">{form.consent_text}</span>
          </label>
          <ErrorText id={fieldId('consent')} message={errors.consent} />
        </div>

        {/* Le pot de miel (§17.4) : invisible pour une personne, jamais rempli par l'écran. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden" data-testid="pot-de-miel">
          <label>
            Site web
            <input
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
        </div>

        {formError ? (
          <p role="alert" className="m-0 rounded-[var(--radius-md)] bg-late-soft p-3 font-semibold text-late">
            {formError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="flex h-14 w-full items-center justify-center rounded-[var(--radius-md)] bg-indigo text-[18px] font-bold text-on-indigo disabled:opacity-60"
        >
          {busy ? 'Envoi…' : 'Envoyer ma demande'}
        </button>
      </Block>
    </form>
  );
}

function TextField({
  id,
  label,
  value,
  error,
  hint,
  optional = false,
  type = 'text',
  inputMode,
  autoComplete,
  placeholder,
  inputRef,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  hint?: string;
  optional?: boolean;
  type?: 'text' | 'tel' | 'email' | 'date';
  inputMode?: 'text' | 'tel' | 'email';
  autoComplete?: string;
  placeholder?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onChange: (value: string) => void;
}) {
  const domId = fieldId(id);
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={domId} className="font-semibold">
        {label}
        {optional ? <span className="font-normal text-ink-muted"> (facultatif)</span> : null}
      </label>
      <input
        ref={inputRef}
        id={domId}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={described(domId, error, !!hint)}
        className={inputClass(!!error)}
      />
      {hint ? (
        <span id={`${domId}-aide`} className="small text-ink-muted">
          {hint}
        </span>
      ) : null}
      <ErrorText id={domId} message={error} />
    </div>
  );
}

/**
 * Un fichier à joindre (§21.1) : la photo, ou une pièce justificative. Rien
 * n'est recadré ni converti ici — le serveur rend une photo carrée de 600 px ;
 * l'aperçu montre le même cadrage, centré. Après un refus, le fichier est à
 * choisir à nouveau : le serveur n'a rien gardé.
 */
function FileInput({
  id,
  label,
  optional,
  accept,
  hint,
  file,
  preview = false,
  reselect,
  error,
  onChange,
}: {
  id: string;
  label: string;
  optional: boolean;
  accept: string;
  hint: string;
  file: File | null;
  preview?: boolean;
  reselect: boolean;
  error: string | undefined;
  onChange: (file: File | null) => void;
}) {
  const domId = fieldId(id);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!preview || !file || !file.type.startsWith('image/')) {
      setDataUrl(null);
      return;
    }
    // Une adresse `data:` : la politique de la page n'autorise pas `blob:`.
    const reader = new FileReader();
    reader.onload = () => setDataUrl(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file, preview]);

  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={domId} className="font-semibold">
        {label}
        {optional ? <span className="font-normal text-ink-muted"> (facultatif)</span> : null}
      </label>
      <span id={`${domId}-aide`} className="small text-ink-muted">
        {hint}
      </span>
      {dataUrl ? (
        <img
          src={dataUrl}
          alt="Votre photo, telle qu’elle sera recadrée sur la carte"
          className="size-28 rounded-[var(--radius-sm)] border border-line object-cover"
          data-testid="photo-apercu"
        />
      ) : null}
      <input
        id={domId}
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        aria-invalid={error ? true : undefined}
        aria-describedby={described(domId, error, true)}
        className={`${inputClass(!!error)} py-2`}
      />
      {file ? <span className="small break-words text-ink-muted">{file.name}</span> : null}
      {reselect && !file && !error ? (
        <span className="small font-semibold text-due" data-testid="a-rechoisir">
          À choisir à nouveau : après un refus, aucun fichier n’est gardé.
        </span>
      ) : null}
      <ErrorText id={domId} message={error} />
    </div>
  );
}

/**
 * Une question de l'association (§20.4) : un champ pour `text`, des cases pour
 * `choice` (une liste déroulante au-delà de cinq réponses possibles), « Oui » /
 * « Non » pour `yes_no`, un sélecteur pour `date` — relue en toutes lettres.
 */
export function QuestionField({
  number,
  question,
  value,
  error,
  onChange,
}: {
  number: number;
  question: JoinQuestion;
  value: AnswerValue | undefined;
  error: string | undefined;
  onChange: (value: AnswerValue) => void;
}) {
  const key = `answers.${question.id}`;
  const domId = fieldId(key);
  const label = (
    <>
      {number}. {question.label}
      {question.required ? null : <span className="font-normal text-ink-muted"> (facultatif)</span>}
    </>
  );
  const aria = {
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': described(domId, error),
  };

  if (question.type === 'yes_no' || (question.type === 'choice' && question.options.length <= MAX_CHOICE_BUTTONS)) {
    const choices: Array<{ label: string; value: AnswerValue }> =
      question.type === 'yes_no'
        ? [
            { label: 'Oui', value: true },
            { label: 'Non', value: false },
          ]
        : question.options.map((option) => ({ label: option, value: option }));
    return (
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" aria-describedby={aria['aria-describedby']}>
        <legend className="mb-2 p-0 font-semibold">{label}</legend>
        <div className={question.type === 'yes_no' ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2'}>
          {choices.map((choice, index) => (
            <label key={String(choice.value)} className={CHOICE}>
              <input
                type="radio"
                name={domId}
                id={index === 0 ? domId : undefined}
                checked={value === choice.value}
                onChange={() => onChange(choice.value)}
                className="size-5 shrink-0 accent-indigo"
              />
              <span className="break-words">{choice.label}</span>
            </label>
          ))}
        </div>
        <ErrorText id={domId} message={error} />
      </fieldset>
    );
  }

  const text = typeof value === 'string' ? value : '';
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={domId} className="font-semibold">
        {label}
      </label>
      {question.type === 'choice' ? (
        <select id={domId} value={text} onChange={(e) => onChange(e.target.value)} className={inputClass(!!error)} {...aria}>
          <option value="">Choisissez</option>
          {question.options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      ) : (
        <input
          id={domId}
          type={question.type === 'date' ? 'date' : 'text'}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass(!!error)}
          {...aria}
        />
      )}
      {question.type === 'date' && formatDate(text) ? (
        <span className="small text-ink-muted" data-testid="date-en-lettres">
          {formatDate(text)}
        </span>
      ) : null}
      <ErrorText id={domId} message={error} />
    </div>
  );
}

/**
 * « Votre demande est envoyée » — IDENTIQUE quel que soit le téléphone saisi
 * (§17.4) : rien ici ne dépend de ce que le serveur sait de ce numéro.
 *
 * Le geste le plus important est « M'envoyer ce lien sur WhatsApp » : sans
 * lui, le visiteur ne retrouvera jamais sa demande, et le serveur ne renvoie
 * jamais le lien une seconde fois.
 */
export function JoinSent({ form, sent }: { form: JoinForm; sent: Sent }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const review = form.admission_mode !== 'premier_paiement';
  const name = form.organisation.name.trim();
  const amount = sent.category?.amount_formatted ?? null;

  return (
    <>
      <section className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] bg-paid-soft px-4 py-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-paid text-on-indigo">
          <CheckIcon size={24} />
        </span>
        <h1 ref={headingRef} tabIndex={-1} className="title m-0 text-paid">
          Votre demande est envoyée
        </h1>
        <p className="m-0">
          Merci {sent.firstName}.{' '}
          {review ? (
            <>
              L’association va l’examiner et vous répondra sur WhatsApp, au{' '}
              <span className="tnum whitespace-nowrap">{spacedPhone(sent.phone)}</span>.
            </>
          ) : amount ? (
            <>
              Il reste à payer votre première cotisation : <span className="money">{amount}</span>.
            </>
          ) : (
            'Il reste à payer votre première cotisation.'
          )}
        </p>
      </section>

      {sent.memberUrl ? (
        <>
          <p className="m-0">
            Voici votre <b>lien personnel</b>. Gardez-le : c’est par lui que vous suivrez votre
            demande{review ? ', puis paierez votre cotisation.' : ' et paierez votre cotisation.'}
          </p>
          <div className="flex flex-col gap-3">
            <a
              href={whatsappLink(
                `Mon lien personnel${name ? ` pour ${name}` : ''} :\n${sent.memberUrl}`,
                sent.phone,
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-14 w-full items-center justify-center rounded-[var(--radius-md)] bg-indigo px-4 text-center text-[17px] font-bold text-on-indigo! no-underline"
            >
              M’envoyer ce lien sur WhatsApp
            </a>
            <a
              href={sent.memberUrl}
              className="flex min-h-14 w-full items-center justify-center rounded-[var(--radius-md)] border border-line-strong bg-surface-raised px-4 text-center text-[16px] font-semibold text-ink! no-underline"
            >
              {review ? 'Ouvrir ma page' : 'Ouvrir ma page pour payer'}
            </a>
          </div>
        </>
      ) : null}
    </>
  );
}
