'use client';

import { useEffect, useState } from 'react';
import { BureauApiError } from '@/lib/bureau/api/core';
import { createCategory, deleteCategory, listCategories, updateCategory } from '@/lib/bureau/api/categories';
import { isSessionError } from '@/lib/bureau/api/core';
import { fieldMessages } from '@/lib/api';
import { errorMessage } from '@/lib/bureau/messages';
import {
  CATEGORY_MODES,
  type Category,
  type CategoryInput,
  type CategoryMode,
} from '@/lib/bureau/types';
import { parseAmount } from '@/lib/validation';
import { Pastille } from '@/components/Pastille';
import { ConfirmDialog, Recap } from './ConfirmDialog';
import { PlusIcon } from './Icons';
import { Button, EmptyState, Field, inputClass, Notice, Panel } from './ui';

/**
 * Les modes proposés à la création. `bareme` n'y est pas : le produit ne sait
 * pas en dériver un montant (`is_calculable` serait faux, §4).
 */
const CREATABLE_MODES: ReadonlyArray<Exclude<CategoryMode, 'bareme'>> = [
  'forfait',
  'minimum',
  'exonere',
];

type InUse = { category: Category; members: number | null; dues: number | null };

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** B11 — les catégories : liste, ajout, modification, désactivation. */
export function CategoriesPanel() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [inUse, setInUse] = useState<InUse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    listCategories(controller.signal)
      .then(setCategories)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (isSessionError(cause)) return;
        setLoadError(errorMessage(cause, 'Les types de membres n’ont pas pu être chargés.'));
      });
    return () => controller.abort();
  }, [attempt]);

  function replace(next: Category) {
    setCategories((prev) =>
      prev ? (prev.some((c) => c.id === next.id) ? prev.map((c) => (c.id === next.id ? next : c)) : [...prev, next]) : [next],
    );
  }

  async function setActive(category: Category, active: boolean) {
    setBusy(true);
    setError(null);
    try {
      const next = await updateCategory(category.id, { is_active: active });
      replace(next);
      setInUse(null);
      setNotice(active ? `« ${next.label} » est réactivée.` : `« ${next.label} » est désactivée : elle ne se propose plus aux nouveaux membres.`);
    } catch (cause) {
      if (isSessionError(cause)) return;
      setError(errorMessage(cause, 'Le type de membre n’a pas pu être modifié.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCategory(deleting.id);
      setCategories((prev) => prev?.filter((c) => c.id !== deleting.id) ?? null);
      setNotice(`« ${deleting.label} » est supprimée.`);
      setDeleting(null);
    } catch (cause) {
      if (isSessionError(cause)) return;
      if (cause instanceof BureauApiError && cause.code === 'category_in_use') {
        // Le refus dit POURQUOI : on propose aussitôt la sortie prévue.
        setInUse({
          category: deleting,
          members: count(cause.body.members),
          dues: count(cause.body.dues),
        });
        setDeleting(null);
      } else {
        setError(errorMessage(cause, 'Le type de membre n’a pas pu être supprimé.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Types de membres"
      actions={
        editing === 'new' ? null : (
          <Button onClick={() => setEditing('new')}>
            <PlusIcon />
            Ajouter un type de membre
          </Button>
        )
      }
    >
      {notice ? (
        <Notice tone="paid">
          <span>{notice}</span>
          <span>
            <Button tone="ghost" className="px-0" onClick={() => setNotice(null)}>
              Fermer
            </Button>
          </span>
        </Notice>
      ) : null}

      {inUse ? (
        <Notice tone="due" role="alert">
          <span>
            « {inUse.category.label} » ne peut pas être supprimée : elle est
            utilisée
            {inUse.members !== null ? ` par ${plural(inUse.members, 'membre', 'membres')}` : ''}
            {inUse.dues !== null ? ` et ${plural(inUse.dues, 'cotisation', 'cotisations')}` : ''}.
            Désactivez-la : elle ne sera plus proposée, et l’historique reste intact.
          </span>
          <span className="flex flex-wrap gap-2">
            <Button tone="primary" disabled={busy} onClick={() => setActive(inUse.category, false)}>
              Désactiver à la place
            </Button>
            <Button tone="ghost" onClick={() => setInUse(null)}>
              Annuler
            </Button>
          </span>
        </Notice>
      ) : null}

      {error && !deleting ? (
        <p role="alert" className="m-0 font-semibold text-late">
          {error}
        </p>
      ) : null}

      {loadError ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-late">{loadError}</span>
          <Button onClick={() => setAttempt((n) => n + 1)}>Réessayer</Button>
        </div>
      ) : null}

      {categories === null && !loadError ? (
        <p className="small m-0 text-ink-muted">Chargement des types de membres…</p>
      ) : null}

      {categories && categories.length === 0 && editing !== 'new' ? (
        <EmptyState>Aucun type de membre. Ajoutez-en un pour fixer le montant des cotisations.</EmptyState>
      ) : null}

      {editing === 'new' ? (
        <CategoryForm
          onCancel={() => setEditing(null)}
          onSaved={(category) => {
            replace(category);
            setEditing(null);
            setNotice(`« ${category.label} » est ajoutée.`);
          }}
        />
      ) : null}

      {categories && categories.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {categories.map((category) =>
            editing !== 'new' && editing?.id === category.id ? (
              <li key={category.id} className="rounded-[var(--radius-sm)] border border-indigo p-3">
                <CategoryForm
                  initial={category}
                  onCancel={() => setEditing(null)}
                  onSaved={(next) => {
                    replace(next);
                    setEditing(null);
                    setNotice(`« ${next.label} » est modifiée.`);
                  }}
                />
              </li>
            ) : (
              <li
                key={category.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-line p-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-semibold break-words">{category.label}</span>
                  <span className="small tnum text-ink-muted">
                    {CATEGORY_MODES[category.mode] ?? category.mode}
                    {category.amount_formatted ? (
                      <>
                        {' — '}
                        <span className="money">{category.amount_formatted}</span>
                      </>
                    ) : null}
                  </span>
                  {category.is_public === false && category.is_active ? (
                    <span className="small text-ink-muted">Non proposé sur la page « Adhérer »</span>
                  ) : null}
                  {category.is_calculable ? null : (
                    <span className="small font-semibold text-due">
                      Montant non calculable : aucune cotisation ne peut s’ouvrir sur ce type de membre.
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {category.is_active ? null : <Pastille tone="due">Désactivée</Pastille>}
                  <Button tone="ghost" className="min-h-10 px-2" onClick={() => setEditing(category)}>
                    Modifier
                  </Button>
                  <Button
                    tone="ghost"
                    className="min-h-10 px-2"
                    disabled={busy}
                    onClick={() => setActive(category, !category.is_active)}
                  >
                    {category.is_active ? 'Désactiver' : 'Réactiver'}
                  </Button>
                  <Button
                    tone="ghost"
                    className="min-h-10 px-2 text-late!"
                    onClick={() => {
                      setError(null);
                      setInUse(null);
                      setDeleting(category);
                    }}
                  >
                    Supprimer
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Supprimer ce type de membre ?"
          confirmLabel="Supprimer ce type de membre"
          confirmTone="danger"
          busy={busy}
          error={error}
          onConfirm={remove}
          onCancel={() => {
            setDeleting(null);
            setError(null);
          }}
        >
          <Recap
            rows={[
              { label: 'Type de membre', value: deleting.label },
              { label: 'Montant', value: deleting.amount_formatted ?? '—' },
            ]}
          />
          <p className="m-0">
            Un type de membre porté par des membres ne peut pas être supprimé :
            il pourra être désactivé à la place.
          </p>
        </ConfirmDialog>
      ) : null}
    </Panel>
  );
}

/** Les champs du formulaire : un `422` s'y range, avec le message de l'API tel quel. */
const CATEGORY_FIELDS = ['label', 'mode', 'amount', 'sort_order', 'is_public'] as const;

function CategoryForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Category;
  onSaved: (category: Category) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  // Une catégorie existante en `bareme` garde son mode : on ne le propose
  // simplement pas à la création.
  const [mode, setMode] = useState<CategoryMode>(initial?.mode ?? 'forfait');
  // R1 : le seul nombre brut manipulé est la valeur du champ.
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 0));
  // §17.10 — décochée par défaut sur une exonérée (personne ne se déclare
  // membre d'honneur), cochée sinon ; envoyée TELLE QU'AFFICHÉE.
  const [isPublic, setIsPublic] = useState(initial?.is_public ?? (initial?.mode ?? 'forfait') !== 'exonere');
  const [publicTouched, setPublicTouched] = useState(initial?.is_public !== undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsAmount = mode === 'forfait' || mode === 'minimum';
  const modes: CategoryMode[] =
    initial?.mode === 'bareme' ? [...CREATABLE_MODES, 'bareme'] : [...CREATABLE_MODES];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);

    const next: Record<string, string> = {};
    if (label.trim() === '') next.label = 'Indiquez le nom du type de membre.';
    const value = needsAmount ? parseAmount(amount) : null;
    if (needsAmount && (value === null || value < 1)) {
      next.amount = 'Indiquez le montant de la cotisation, en chiffres.';
    }
    const order = Number(sortOrder);
    if (sortOrder.trim() !== '' && !Number.isInteger(order)) {
      next.sort_order = 'L’ordre doit être un nombre entier.';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const input: CategoryInput = {
      label: label.trim(),
      mode: mode as CategoryInput['mode'],
      amount: needsAmount ? value : null,
      sort_order: sortOrder.trim() === '' ? 0 : order,
      is_public: isPublic,
    };

    setBusy(true);
    try {
      onSaved(initial ? await updateCategory(initial.id, input) : await createCategory(input));
    } catch (cause) {
      if (isSessionError(cause)) return;
      const messages = fieldMessages(cause);
      const mapped: Record<string, string> = {};
      for (const field of CATEGORY_FIELDS) if (messages[field]) mapped[field] = messages[field];
      if (Object.keys(mapped).length > 0) setErrors(mapped);
      else setFormError(errorMessage(cause, 'Le type de membre n’a pas pu être enregistré.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="m-0 flex flex-col gap-3" onSubmit={submit} noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nom" required error={errors.label}>
          {(props) => (
            <input {...props} maxLength={255} value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass(!!errors.label)} />
          )}
        </Field>
        <Field label="Mode de calcul" required error={errors.mode}>
          {(props) => (
            <select
              {...props}
              value={mode}
              onChange={(e) => {
                const next = e.target.value as CategoryMode;
                setMode(next);
                if (!publicTouched) setIsPublic(next !== 'exonere');
              }}
              className={inputClass(!!errors.mode)}
            >
              {modes.map((m) => (
                <option key={m} value={m}>
                  {CATEGORY_MODES[m]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {needsAmount ? (
          <Field
            label={mode === 'minimum' ? 'Montant minimum' : 'Montant'}
            required
            error={errors.amount}
            hint="En FCFA, en chiffres, sans espaces."
          >
            {(props) => (
              <input
                {...props}
                inputMode="numeric"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                className={inputClass(!!errors.amount, 'tnum')}
              />
            )}
          </Field>
        ) : null}
        <Field label="Ordre d’affichage" optional error={errors.sort_order}>
          {(props) => (
            <input {...props} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value.replace(/[^\d-]/g, ''))} className={inputClass(!!errors.sort_order)} />
          )}
        </Field>
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => {
            setIsPublic(e.target.checked);
            setPublicTouched(true);
          }}
          className="mt-[2px] size-5 shrink-0 accent-indigo"
        />
        <span className="flex flex-col">
          <b>Proposé sur la page « Adhérer »</b>
          <span className="small text-ink-muted">
            Décoché, ce type de membre reste utilisable par le bureau, mais ne se demande pas en
            ligne.
          </span>
        </span>
      </label>
      {errors.is_public ? <span className="small font-semibold text-late">{errors.is_public}</span> : null}
      {formError ? (
        <p role="alert" className="m-0 rounded-[var(--radius-sm)] bg-late-soft p-3 font-semibold text-late">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button tone="ghost" onClick={onCancel} disabled={busy}>
          Annuler
        </Button>
        <Button tone="primary" type="submit" disabled={busy}>
          {busy ? 'Enregistrement…' : initial ? 'Enregistrer ce type de membre' : 'Ajouter ce type de membre'}
        </Button>
      </div>
    </form>
  );
}
