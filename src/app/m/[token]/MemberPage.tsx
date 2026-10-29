'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DeclarationForm } from '@/components/DeclarationForm';
import {
  InvalidLink,
  Loading,
  TechnicalError,
  Unavailable,
} from '@/components/Fallbacks';
import { CheckIcon, ClockIcon, DocumentIcon } from '@/components/Icons';
import { Pastille } from '@/components/Pastille';
import { PaymentHowTo } from '@/components/PaymentHowTo';
import { ReceiptList } from '@/components/ReceiptList';
import { Card, Shell } from '@/components/Shell';
import { fetchMember } from '@/lib/api';
import { formatDate, formatDateTime, isPast } from '@/lib/dates';
import { resolveMemberState, screenForError } from '@/lib/state';
import { resolveTenant } from '@/lib/tenant';
import type {
  Due,
  MemberPayload,
  Organisation,
  PaymentMethod,
  ScreenState,
} from '@/lib/types';

type Notice = { message: string; tone: 'paid' | 'info' };

/**
 * L'écran du membre, de bout en bout : résolution du tenant, chargement,
 * et rendu des états E1 à E9.
 *
 * R2 : tout se passe dans le navigateur. R5 : aucun cache, chaque visite
 * interroge l'API.
 */
export function MemberPage({ token }: { token: string }) {
  const [screen, setScreen] = useState<ScreenState>({ kind: 'loading' });
  const [tenant, setTenant] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    const slug = resolveTenant(window.location);
    setTenant(slug);

    // Un hôte hors `{slug}.adhera.africa` ne désigne aucune association.
    if (!slug) {
      setScreen({ kind: 'E1' });
      return () => controller.abort();
    }

    void (async () => {
      try {
        const payload = await fetchMember(token, slug, controller.signal);
        setScreen({ kind: 'ready', payload });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setScreen(screenForError(error));
      }
    })();

    return () => controller.abort();
  }, [token, attempt]);

  // Le focus suit l'information : succès de l'envoi, ou message du serveur.
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    setScreen({ kind: 'loading' });
    reload();
  }, [reload]);

  const onDeclared = useCallback(
    (message: string) => {
      setFormOpen(false);
      setNotice({ message, tone: 'paid' });
      reload();
    },
    [reload],
  );

  const onNeedsReload = useCallback(
    (message: string) => {
      setFormOpen(false);
      setNotice({ message, tone: 'info' });
      reload();
    },
    [reload],
  );

  if (screen.kind === 'loading') {
    return (
      <Shell>
        <Loading />
      </Shell>
    );
  }

  if (screen.kind === 'E1') {
    return (
      <Shell>
        <InvalidLink />
      </Shell>
    );
  }

  if (screen.kind === 'E8') {
    return (
      <Shell>
        <Unavailable />
      </Shell>
    );
  }

  if (screen.kind === 'E9') {
    return (
      <Shell>
        <TechnicalError rateLimited={screen.rateLimited} onRetry={retry} />
      </Shell>
    );
  }

  // Le tenant est forcément résolu ici : sans lui, on n'aurait pas appelé l'API.
  if (!tenant) {
    return (
      <Shell>
        <InvalidLink />
      </Shell>
    );
  }

  const { payload } = screen;
  const state = resolveMemberState(payload);

  return (
    <Shell organisationName={payload.organisation.name}>
      {notice ? (
        <p
          ref={noticeRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className={`m-0 rounded-[var(--radius-md)] p-4 font-semibold ${
            notice.tone === 'paid'
              ? 'bg-paid-soft text-paid'
              : 'bg-due-soft text-due'
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      <Greeting state={state} memberName={payload.member.name} />

      {state === 'E2' ? <UpToDate payload={payload} /> : null}
      {state === 'E4' ? <PendingDeclarationBlock payload={payload} /> : null}
      {state === 'E5' ? <AmountUnknown /> : null}
      {state === 'E6' ? <NothingDue /> : null}

      {state === 'E3' || state === 'E3b' ? (
        <DueBlock
          payload={payload}
          token={token}
          tenant={tenant}
          partial={state === 'E3b'}
          formOpen={formOpen}
          onOpenForm={() => {
            setNotice(null);
            setFormOpen(true);
          }}
          onCloseForm={() => setFormOpen(false)}
          onDeclared={onDeclared}
          onNeedsReload={onNeedsReload}
        />
      ) : null}

      {state === 'E2' || state === 'E4' ? (
        <ReceiptList
          receipts={payload.receipts}
          token={token}
          tenant={tenant}
        />
      ) : null}

      {state === 'E2' || state === 'E4' ? (
        <>
          <div className="grow" />
          <p className="small m-0 text-center text-ink-muted">
            Gardez ce lien : il vous servira pour vos prochaines cotisations.
          </p>
        </>
      ) : null}
    </Shell>
  );
}

function Greeting({
  state,
  memberName,
}: {
  state: ReturnType<typeof resolveMemberState>;
  memberName: string;
}) {
  const name = memberName.trim();
  const title = state === 'E4' ? (name ? `Merci, ${name}` : 'Merci') : name ? `Bonjour ${name}` : 'Bonjour';

  const subtitles: Record<typeof state, string> = {
    E2: 'Merci pour votre cotisation.',
    E3: 'Voici votre cotisation.',
    E3b: 'Votre acompte a bien été reçu.',
    E4: 'Votre confirmation est bien arrivée.',
    E5: 'Votre cotisation est en préparation.',
    E6: 'Rien à régler pour l’instant.',
  };

  return (
    <div className="flex flex-col gap-1">
      <h1 className="title m-0">{title}</h1>
      <p className="m-0 text-ink-muted">{subtitles[state]}</p>
    </div>
  );
}

/** E2 — à jour. */
function UpToDate({ payload }: { payload: MemberPayload }) {
  const until = formatDate(payload.standing.covered_until);

  return (
    <section className="flex flex-col items-start gap-[10px] rounded-[var(--radius-md)] bg-paid-soft px-4 py-5">
      <Pastille tone="paid" icon={<CheckIcon />}>
        À jour
      </Pastille>
      <p className="m-0 text-[20px] leading-7 font-bold">
        {until
          ? `Votre cotisation est réglée jusqu’au ${until}.`
          : 'Votre cotisation est à jour.'}
      </p>
    </section>
  );
}

/** E4 — déclaration en attente de validation. Pas de formulaire. */
function PendingDeclarationBlock({ payload }: { payload: MemberPayload }) {
  const pending = payload.pending_declaration;
  if (!pending) return null;

  const declaredOn = formatDateTime(pending.declared_at);

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-2">
          <span className="label text-ink-muted">PAIEMENT DÉCLARÉ</span>
          <Pastille tone="info" icon={<ClockIcon />}>
            En attente de validation
          </Pastille>
        </div>
        <div className="amount">{pending.amount_formatted}</div>
      </Card>

      <section className="flex items-start gap-3 px-1">
        <DocumentIcon className="shrink-0 text-ink-muted" />
        <p className="m-0">
          Votre confirmation de {pending.amount_formatted}
          {declaredOn ? `, envoyée le ${declaredOn},` : ''} est en cours de
          vérification par le bureau. Votre reçu apparaîtra sur cette page.
        </p>
      </section>
    </>
  );
}

/** E5 — le montant n'est pas encore fixé : le serveur refuserait la déclaration. */
function AmountUnknown() {
  return (
    <Card>
      <p className="m-0">
        Le montant de votre cotisation n’est pas encore fixé. Contactez le
        bureau de votre association.
      </p>
    </Card>
  );
}

/** E6 — ni dû, ni à jour. */
function NothingDue() {
  return (
    <Card>
      <p className="m-0">Aucune cotisation n’est réclamée pour le moment.</p>
    </Card>
  );
}

/** E3 / E3b — une cotisation est réclamable. */
function DueBlock({
  payload,
  token,
  tenant,
  partial,
  formOpen,
  onOpenForm,
  onCloseForm,
  onDeclared,
  onNeedsReload,
}: {
  payload: MemberPayload;
  token: string;
  tenant: string;
  partial: boolean;
  formOpen: boolean;
  onOpenForm: () => void;
  onCloseForm: () => void;
  onDeclared: (message: string) => void;
  onNeedsReload: (message: string) => void;
}) {
  const due = payload.due;
  if (!due) return null;

  // --late est réservé à E3 quand la fin de période est passée.
  const late = isPast(due.period_end);
  const periodStart = formatDate(due.period_start);
  const periodEnd = formatDate(due.period_end);

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-2">
          <span className="label text-ink-muted">
            {partial ? 'RESTE À PAYER' : 'À PAYER'}
          </span>
          <Pastille tone={late ? 'late' : 'due'}>
            {late ? 'En retard' : 'À régler'}
          </Pastille>
        </div>

        {/* R1 : jamais de montant recalculé, seulement le champ *_formatted. */}
        <div className="amount">{due.balance_formatted}</div>

        <p className="m-0">
          {late && periodStart ? (
            <>
              Attendue depuis le {periodStart}.
              <br />
            </>
          ) : null}
          {periodStart && periodEnd
            ? `Elle couvre la période du ${periodStart} au ${periodEnd}.`
            : null}
          {partial ? (
            <>
              <br />
              Votre cotisation sera à jour dès que le reste sera réglé.
            </>
          ) : null}
        </p>
      </Card>

      {partial ? <PartialBreakdown due={due} /> : null}

      <PaymentHowTo organisation={payload.organisation} />

      <ReceiptList receipts={payload.receipts} token={token} tenant={tenant} />

      <div className="grow" />

      {formOpen ? (
        <DeclarationForm
          token={token}
          tenant={tenant}
          balance={due.balance ?? 0}
          defaultMethod={defaultMethodFor(payload.organisation)}
          onDeclared={onDeclared}
          onNeedsReload={onNeedsReload}
          onCancel={onCloseForm}
        />
      ) : (
        <button
          type="button"
          onClick={onOpenForm}
          className="flex h-13 items-center justify-center rounded-[var(--radius-md)] bg-indigo text-[17px] font-bold text-on-indigo"
        >
          J’ai payé, je confirme
        </button>
      )}
    </>
  );
}

/** E3b — « Déjà réglé : X sur Y », détaillé comme la maquette Partiel. */
function PartialBreakdown({ due }: { due: Due }) {
  const periodStart = formatDate(due.period_start);
  const periodEnd = formatDate(due.period_end);

  return (
    <Card className="gap-2">
      <div className="flex justify-between gap-2">
        <span className="text-ink-muted">Cotisation</span>
        <span className="tnum">{due.amount_due_formatted}</span>
      </div>
      <div className="flex justify-between gap-2">
        <span className="text-ink-muted">Déjà réglé</span>
        <span className="tnum">{due.amount_paid_formatted}</span>
      </div>
      <div className="h-px bg-line" />
      <div className="flex justify-between gap-2 font-bold">
        <span>Reste à payer</span>
        <span className="tnum">{due.balance_formatted}</span>
      </div>
      {periodStart && periodEnd ? (
        <span className="small text-ink-muted">
          Période du {periodStart} au {periodEnd}
        </span>
      ) : null}
    </Card>
  );
}

/**
 * Le mode présélectionné suit ce que l'association accepte réellement : inutile
 * de proposer Orange Money d'abord si seul Wave est servi.
 */
function defaultMethodFor(organisation: Organisation): PaymentMethod {
  if (organisation.om_merchant_number) return 'om';
  if (organisation.wave_merchant_number) return 'wave';
  return 'om';
}
