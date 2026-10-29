'use client';

import { useRef, useState } from 'react';
import { useBureau } from '@/components/bureau/BureauContext';
import { CategoriesPanel } from '@/components/bureau/CategoriesPanel';
import { ConfirmDialog } from '@/components/bureau/ConfirmDialog';
import { UploadIcon } from '@/components/Icons';
import {
  Button,
  buttonClass,
  Field,
  inputClass,
  Notice,
  PageTitle,
  Panel,
  Row,
} from '@/components/bureau/ui';
import { deleteLogo, isSessionError, updateSettings, uploadLogo } from '@/lib/bureau/api';
import { errorMessage, invalidFields } from '@/lib/bureau/messages';
import {
  MEMBER_TYPES_LABELS,
  MODE_COTISATION_LABELS,
  type Settings,
} from '@/lib/bureau/types';

const MAX_INSTRUCTIONS = 5000;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/jpeg', 'image/png'];

/** B11 — les réglages de l'association. */
export default function ReglagesPage() {
  return (
    <>
      <PageTitle title="Réglages" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <AssociationPanel />
        <div className="flex flex-col gap-4">
          <LogoPanel />
          <ModePanel />
        </div>
      </div>
      <CategoriesPanel />
    </>
  );
}

const SETTINGS_FIELD_ERRORS: Record<string, string> = {
  issuer_name: 'Indiquez le nom de l’association (255 caractères au plus).',
  om_merchant_number: 'Vérifiez le numéro marchand Orange Money.',
  wave_merchant_number: 'Vérifiez le numéro marchand Wave.',
  payment_instructions: `Les instructions ne doivent pas dépasser ${MAX_INSTRUCTIONS} caractères.`,
};

function AssociationPanel() {
  const { settings, setSettings } = useBureau();
  const [name, setName] = useState(settings.issuer_name ?? '');
  const [om, setOm] = useState(settings.om_merchant_number ?? '');
  const [wave, setWave] = useState(settings.wave_merchant_number ?? '');
  const [instructions, setInstructions] = useState(settings.payment_instructions ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setSaved(false);
    setFormError(null);
    const next: Record<string, string> = {};
    if (name.trim() === '') next.issuer_name = 'Indiquez le nom de l’association.';
    if (instructions.length > MAX_INSTRUCTIONS) {
      next.payment_instructions = SETTINGS_FIELD_ERRORS.payment_instructions as string;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      const updated = await updateSettings({
        issuer_name: name.trim(),
        om_merchant_number: om.trim() || null,
        wave_merchant_number: wave.trim() || null,
        // Texte libre : envoyé tel quel, retours à la ligne compris.
        payment_instructions: instructions.trim() === '' ? null : instructions,
      });
      setSettings(updated);
      setSaved(true);
    } catch (cause) {
      if (isSessionError(cause)) return;
      const mapped: Record<string, string> = {};
      for (const field of invalidFields(cause)) {
        if (SETTINGS_FIELD_ERRORS[field]) mapped[field] = SETTINGS_FIELD_ERRORS[field] as string;
      }
      if (Object.keys(mapped).length > 0) setErrors(mapped);
      else setFormError(errorMessage(cause, 'Les réglages n’ont pas pu être enregistrés.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Association">
      <form className="m-0 flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field label="Nom de l’association" required error={errors.issuer_name} hint="Il figure sur les reçus et sur la page de chaque membre.">
          {(props) => (
            <input {...props} maxLength={255} value={name} onChange={(e) => setName(e.target.value)} className={inputClass(!!errors.issuer_name)} />
          )}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Numéro marchand Orange Money" optional error={errors.om_merchant_number}>
            {(props) => (
              <input {...props} inputMode="tel" maxLength={32} value={om} onChange={(e) => setOm(e.target.value)} className={inputClass(!!errors.om_merchant_number, 'tnum')} />
            )}
          </Field>
          <Field label="Numéro marchand Wave" optional error={errors.wave_merchant_number}>
            {(props) => (
              <input {...props} inputMode="tel" maxLength={32} value={wave} onChange={(e) => setWave(e.target.value)} className={inputClass(!!errors.wave_merchant_number, 'tnum')} />
            )}
          </Field>
        </div>
        <Field
          label="Instructions de paiement"
          optional
          error={errors.payment_instructions}
          hint={`Affichées telles quelles sur la page de chaque membre. ${instructions.length} / ${MAX_INSTRUCTIONS} caractères.`}
        >
          {(props) => (
            <textarea {...props} rows={6} maxLength={MAX_INSTRUCTIONS} value={instructions} onChange={(e) => setInstructions(e.target.value)} className={inputClass(!!errors.payment_instructions, 'py-2')} />
          )}
        </Field>

        {saved ? <Notice tone="paid">Réglages enregistrés.</Notice> : null}
        {formError ? <Notice tone="late">{formError}</Notice> : null}

        <div className="flex justify-end">
          <Button tone="primary" type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer les réglages'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function LogoPanel() {
  const { settings, setSettings } = useBureau();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(task: () => Promise<Settings>, done: string, failure: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setSettings(await task());
      setNotice(done);
      setConfirmRemove(false);
    } catch (cause) {
      if (isSessionError(cause)) return;
      setError(errorMessage(cause, failure));
    } finally {
      setBusy(false);
    }
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setError('Le logo doit être une image JPEG ou PNG.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('Le logo ne doit pas dépasser 2 Mo.');
      return;
    }
    void run(() => uploadLogo(file), 'Logo enregistré.', 'Le logo n’a pas pu être envoyé.');
  }

  return (
    <Panel title="Logo">
      {settings.logo_url ? (
        <div className="flex items-center justify-center rounded-[var(--radius-sm)] border border-line bg-surface p-4">
          {/* URL versionnée par son contenu : relue, jamais recomposée (§3). */}
          <img
            src={settings.logo_url}
            alt="Logo actuel de l’association"
            referrerPolicy="no-referrer"
            className="max-h-32 max-w-full object-contain"
          />
        </div>
      ) : (
        <p className="m-0 text-ink-muted">Aucun logo pour l’instant.</p>
      )}

      <p className="small m-0 text-ink-muted">
        Préférez un monogramme ou un symbole, sans le nom écrit : le reçu
        imprime déjà le nom de l’association à côté du logo. JPEG ou PNG, 2 Mo
        au plus.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={LOGO_TYPES.join(',')}
        onChange={onFile}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={buttonClass('secondary')}>
          <UploadIcon size={18} />
          {busy ? 'Envoi…' : settings.logo_url ? 'Remplacer le logo' : 'Envoyer un logo'}
        </button>
        {settings.logo_url ? (
          <Button tone="ghost" disabled={busy} onClick={() => setConfirmRemove(true)}>
            Retirer le logo
          </Button>
        ) : null}
      </div>

      {notice ? <Notice tone="paid">{notice}</Notice> : null}
      {error && !confirmRemove ? <Notice tone="late">{error}</Notice> : null}

      {confirmRemove ? (
        <ConfirmDialog
          title="Retirer le logo ?"
          confirmLabel="Retirer le logo"
          confirmTone="danger"
          busy={busy}
          error={error}
          onConfirm={() => run(deleteLogo, 'Logo retiré.', 'Le logo n’a pas pu être retiré.')}
          onCancel={() => {
            setConfirmRemove(false);
            setError(null);
          }}
        >
          <p className="m-0">
            Les prochains reçus n’auront plus de logo. Vous pourrez en envoyer
            un autre à tout moment.
          </p>
        </ConfirmDialog>
      ) : null}
    </Panel>
  );
}

/** `mode_cotisation` et `member_types` sont fixés par DIGISSOL : lecture seule. */
function ModePanel() {
  const { settings } = useBureau();
  return (
    <Panel title="Cotisation">
      <dl className="m-0 flex flex-col gap-2">
        <Row label="Mode de cotisation">
          {MODE_COTISATION_LABELS[settings.mode_cotisation] ?? settings.mode_cotisation}
        </Row>
        <Row label="Membres">
          {MEMBER_TYPES_LABELS[settings.member_types] ?? settings.member_types}
        </Row>
      </dl>
      <p className="small m-0 text-ink-muted">
        Ces deux réglages ont été fixés à l’ouverture du compte. Pour les
        changer, contactez DIGISSOL.
      </p>
    </Panel>
  );
}
