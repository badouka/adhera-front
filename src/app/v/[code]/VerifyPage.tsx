'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loading, TechnicalError } from '@/components/Fallbacks';
import { AlertIcon, CheckIcon } from '@/components/Icons';
import { Shell } from '@/components/Shell';
import { ApiError, fetchVerification } from '@/lib/api';
import { formatDate, formatDateTime, formatInstant } from '@/lib/dates';
import { resolveTenant } from '@/lib/tenant';
import type { Verification, VerificationStanding } from '@/lib/types';

type Screen =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; rateLimited: boolean }
  | { kind: 'ready'; value: Verification; asked: string | null };

export const NOT_FOUND_TEXT =
  'Aucun membre ne correspond à ce code. Vérifiez que vous avez scanné le bon document.';

/** Le seul pied de page de la plateforme sur un écran tourné vers un tiers. */
function VerifiedBy() {
  return <span>Vérification assurée par Adhera</span>;
}

/**
 * `/v/{code}` — la page qu'ouvre le QR de la carte ou de l'attestation (F4 § 2),
 * sur le téléphone d'un banquier, d'un employeur, d'un consulat. Sans compte.
 *
 * ⚠️ UN SEUL cas d'erreur : le 404 (§16.5). Un code inconnu, un candidat, un
 * autre tenant et l'option éteinte rendent le même corps — l'écran n'en
 * distingue aucun. Un hôte qui ne désigne aucune association dit la même chose.
 */
export function VerifyPage({ code }: { code: string }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const tenant = resolveTenant(window.location);
    const asked = new URLSearchParams(window.location.search).get('attestation')?.trim() || null;

    if (!tenant) {
      setScreen({ kind: 'not-found' });
      return () => controller.abort();
    }

    void (async () => {
      try {
        const value = await fetchVerification(code, tenant, asked, controller.signal);
        setScreen({ kind: 'ready', value, asked });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof ApiError && error.status === 404) {
          setScreen({ kind: 'not-found' });
          return;
        }
        setScreen({
          kind: 'error',
          rateLimited: error instanceof ApiError && error.status === 429,
        });
      }
    })();

    return () => controller.abort();
  }, [code, attempt]);

  const retry = useCallback(() => {
    setScreen({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  if (screen.kind === 'loading') {
    return (
      <Shell footer={<VerifiedBy />}>
        <Loading />
      </Shell>
    );
  }

  if (screen.kind === 'not-found') {
    return (
      <Shell footer={<VerifiedBy />}>
        <div className="flex grow flex-col items-center gap-4 px-2 pt-10 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-late-soft text-late">
            <AlertIcon />
          </span>
          <p className="title m-0 max-w-[320px]" data-testid="verify-not-found">
            {NOT_FOUND_TEXT}
          </p>
        </div>
      </Shell>
    );
  }

  if (screen.kind === 'error') {
    return (
      <Shell footer={<VerifiedBy />}>
        <TechnicalError rateLimited={screen.rateLimited} onRetry={retry} />
      </Shell>
    );
  }

  const { value, asked } = screen;
  return (
    <Shell
      organisationName={value.organisation.name}
      logoUrl={value.organisation.logo_url}
      footer={<VerifiedBy />}
    >
      <Verdict standing={value.standing} validUntil={value.valid_until} />
      <MemberLines member={value.member} />
      {asked ? <AttestationLine attestation={value.attestation} /> : null}
      <p className="small m-0 text-ink-muted" data-testid="verify-checked-at">
        Vérifié le {formatInstant(value.checked_at, { zoneName: true })}
      </p>
    </Shell>
  );
}

const VERDICTS: Record<VerificationStanding, { tone: string; text: string }> = {
  up_to_date: { tone: 'bg-paid-soft text-paid', text: 'Membre à jour de sa cotisation' },
  not_up_to_date: { tone: 'bg-due-soft text-due', text: 'Membre — cotisation non à jour' },
  former: {
    tone: 'border border-line bg-surface text-ink-muted',
    text: 'N’est plus membre de l’association',
  },
};

/** Le verdict, d'après `standing` : un identifiant testé, jamais affiché tel quel. */
function Verdict({
  standing,
  validUntil,
}: {
  standing: VerificationStanding;
  validUntil: string | null;
}) {
  // Un identifiant inconnu ne s'affiche pas comme un « à jour ».
  const verdict = VERDICTS[standing] ?? VERDICTS.not_up_to_date;
  const until = standing === 'up_to_date' ? formatDate(validUntil) : '';
  return (
    <section
      data-testid="verify-verdict"
      data-standing={standing}
      className={`flex flex-col gap-1 rounded-[var(--radius-md)] px-4 py-5 ${verdict.tone}`}
    >
      <p className="m-0 flex items-center gap-2 text-[22px] leading-7 font-bold">
        {standing === 'up_to_date' ? <CheckIcon size={22} /> : null}
        {verdict.text}
      </p>
      {until ? <p className="m-0 text-[18px] font-semibold">jusqu’au {until}</p> : null}
    </section>
  );
}

function MemberLines({ member }: { member: Verification['member'] }) {
  const number = member.member_number?.trim();
  const since = formatDate(member.member_since);
  const category = member.category_label?.trim();
  return (
    <section className="flex flex-col gap-1">
      {/* §21 — la photo, et elle seule : elle dit que le porteur est bien celui que la carte désigne. */}
      {member.photo_url ? (
        <img
          src={member.photo_url}
          alt={`Photo de ${member.display_name}`}
          width={120}
          height={120}
          referrerPolicy="no-referrer"
          className="mb-2 size-[120px] rounded-[var(--radius-md)] border border-line object-cover"
          data-testid="verify-photo"
        />
      ) : null}
      <p className="m-0 text-[24px] leading-8 font-bold break-words">{member.display_name}</p>
      {category ? <p className="m-0 text-ink-muted">{category}</p> : null}
      {number ? <p className="m-0 tnum">N° {number}</p> : null}
      {since ? <p className="m-0">Membre depuis le {since}</p> : null}
    </section>
  );
}

function AttestationLine({ attestation }: { attestation: Verification['attestation'] }) {
  if (!attestation) {
    return (
      <p
        className="m-0 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4"
        data-testid="verify-attestation"
      >
        Aucune attestation ne correspond à cette référence pour ce membre.
      </p>
    );
  }
  const issued = formatDateTime(attestation.issued_at);
  const until = formatDate(attestation.valid_until);
  return (
    <section
      className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4"
      data-testid="verify-attestation"
    >
      <p className="m-0">
        Attestation <span className="font-semibold break-all">{attestation.reference}</span>
        {issued ? `, délivrée le ${issued}` : ''}
      </p>
      {attestation.is_valid ? (
        until ? <p className="m-0 font-semibold text-paid">valable jusqu’au {until}</p> : null
      ) : (
        <p className="m-0 font-bold text-late" data-testid="verify-attestation-invalid">
          Cette attestation n’est plus valide
        </p>
      )}
    </section>
  );
}
