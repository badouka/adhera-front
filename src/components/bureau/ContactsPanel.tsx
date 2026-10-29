'use client';

import { useState } from 'react';
import { createContact, deleteContact, isSessionError } from '@/lib/bureau/api';
import { errorMessage, invalidFields } from '@/lib/bureau/messages';
import { CONTACT_ROLES, type Contact, type ContactRole } from '@/lib/bureau/types';
import { ConfirmDialog, Recap } from './ConfirmDialog';
import { PlusIcon } from './Icons';
import { Button, EmptyState, Field, inputClass, Panel } from './ui';

const ROLE_LABEL = Object.fromEntries(CONTACT_ROLES.map((r) => [r.value, r.label])) as Record<
  ContactRole,
  string
>;

const FIELD_ERRORS: Record<string, string> = {
  name: 'Indiquez le nom du contact.',
  role: 'Choisissez le rôle du contact.',
  role_title: 'Vérifiez la fonction (255 caractères au plus).',
  phone: 'Vérifiez le numéro de téléphone.',
  email: 'Vérifiez l’adresse e-mail.',
};

/**
 * Les contacts rattachés — réservés aux membres `organisation` : l'écran ne
 * rend ce bloc QUE pour eux (sur une personne, l'API répondrait
 * `member_is_not_an_organisation`).
 */
export function ContactsPanel({
  memberId,
  contacts,
  onChange,
}: {
  memberId: string;
  contacts: Contact[];
  onChange: (next: Contact[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!removing || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteContact(memberId, removing.id);
      onChange(contacts.filter((c) => c.id !== removing.id));
      setRemoving(null);
    } catch (cause) {
      if (isSessionError(cause)) return;
      setError(errorMessage(cause, 'Le contact n’a pas pu être retiré.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Contacts"
      actions={
        adding ? null : (
          <Button onClick={() => setAdding(true)}>
            <PlusIcon />
            Ajouter un contact
          </Button>
        )
      }
    >
      {contacts.length === 0 && !adding ? (
        <EmptyState>Aucun contact rattaché à cette organisation.</EmptyState>
      ) : null}

      {contacts.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-[var(--radius-sm)] border border-line p-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="font-semibold break-words">{contact.name}</span>
                <span className="small text-ink-muted">
                  {[ROLE_LABEL[contact.role] ?? contact.role, contact.role_title]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {contact.phone ? <span className="small tnum">{contact.phone}</span> : null}
                {contact.email ? <span className="small break-all">{contact.email}</span> : null}
              </div>
              <Button tone="ghost" className="min-h-10 px-2" onClick={() => setRemoving(contact)}>
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <ContactForm
          memberId={memberId}
          onCancel={() => setAdding(false)}
          onCreated={(contact) => {
            onChange([...contacts, contact]);
            setAdding(false);
          }}
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          title="Retirer ce contact ?"
          confirmLabel="Retirer le contact"
          confirmTone="danger"
          busy={busy}
          error={error}
          onConfirm={remove}
          onCancel={() => {
            setRemoving(null);
            setError(null);
          }}
        >
          <Recap
            rows={[
              { label: 'Contact', value: removing.name },
              { label: 'Rôle', value: ROLE_LABEL[removing.role] ?? removing.role },
            ]}
          />
        </ConfirmDialog>
      ) : null}
    </Panel>
  );
}

function ContactForm({
  memberId,
  onCreated,
  onCancel,
}: {
  memberId: string;
  onCreated: (contact: Contact) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<ContactRole>('principal');
  const [roleTitle, setRoleTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    if (name.trim() === '') {
      setErrors({ name: FIELD_ERRORS.name as string });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onCreated(
        await createContact(memberId, {
          name: name.trim(),
          role,
          role_title: roleTitle.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
        }),
      );
    } catch (cause) {
      if (isSessionError(cause)) return;
      const mapped: Record<string, string> = {};
      for (const field of invalidFields(cause)) {
        if (FIELD_ERRORS[field]) mapped[field] = FIELD_ERRORS[field] as string;
      }
      if (Object.keys(mapped).length > 0) setErrors(mapped);
      else setFormError(errorMessage(cause, 'Le contact n’a pas pu être ajouté.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="m-0 flex flex-col gap-3 border-t border-line pt-3" onSubmit={submit} noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nom" required error={errors.name}>
          {(props) => (
            <input {...props} maxLength={255} value={name} onChange={(e) => setName(e.target.value)} className={inputClass(!!errors.name)} />
          )}
        </Field>
        <Field label="Rôle" required error={errors.role}>
          {(props) => (
            <select {...props} value={role} onChange={(e) => setRole(e.target.value as ContactRole)} className={inputClass(!!errors.role)}>
              {CONTACT_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Fonction" optional error={errors.role_title} hint="Par exemple « Directrice administrative ».">
          {(props) => (
            <input {...props} maxLength={255} value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} className={inputClass(!!errors.role_title)} />
          )}
        </Field>
        <Field label="Téléphone" optional error={errors.phone}>
          {(props) => (
            <input {...props} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass(!!errors.phone)} />
          )}
        </Field>
        <Field label="E-mail" optional error={errors.email}>
          {(props) => (
            <input {...props} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass(!!errors.email)} />
          )}
        </Field>
      </div>
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
          {busy ? 'Enregistrement…' : 'Ajouter le contact'}
        </Button>
      </div>
    </form>
  );
}
