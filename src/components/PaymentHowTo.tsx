'use client';

import { useRef } from 'react';
import type { Organisation } from '@/lib/types';
import { CopyButton } from './CopyButton';

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="small flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-soft font-bold text-indigo"
      >
        {n}
      </span>
      <div className="flex min-w-0 grow flex-col gap-2">{children}</div>
    </li>
  );
}

function MerchantNumber({ channel, value }: { channel: string; value: string }) {
  const numberRef = useRef<HTMLSpanElement>(null);

  return (
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-line bg-surface-raised py-2 pr-2 pl-3">
      <span className="flex min-w-0 flex-col">
        <span className="label text-ink-muted">{channel.toUpperCase()}</span>
        <span ref={numberRef} className="tnum font-bold break-words">
          {value}
        </span>
      </span>
      <CopyButton
        value={value}
        label={`Copier le numéro ${channel}`}
        selectRef={numberRef}
      />
    </div>
  );
}

/**
 * « Comment payer » : chaque numéro marchand servi (OM, Wave, ou les deux) et
 * les instructions libres de l'association.
 *
 * `payment_instructions` est du TEXTE : rendu tel quel, avec ses retours à la
 * ligne, jamais en HTML.
 */
export function PaymentHowTo({ organisation }: { organisation: Organisation }) {
  const channels: Array<{ channel: string; value: string }> = [];
  if (organisation.om_merchant_number) {
    channels.push({
      channel: 'Orange Money',
      value: organisation.om_merchant_number,
    });
  }
  if (organisation.wave_merchant_number) {
    channels.push({ channel: 'Wave', value: organisation.wave_merchant_number });
  }

  const instructions = organisation.payment_instructions?.trim();

  if (channels.length === 0 && !instructions) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="heading m-0">Comment payer</h2>

      {channels.length > 0 ? (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          <Step n={1}>
            <span>
              {channels.length > 1
                ? 'Envoyez le montant à l’un de ces numéros :'
                : `Envoyez le montant par ${channels[0]?.channel} au numéro de l’association :`}
            </span>
            {channels.map((c) => (
              <MerchantNumber key={c.channel} {...c} />
            ))}
          </Step>
          <Step n={2}>
            <span>
              Gardez le SMS de confirmation : il contient la référence de la
              transaction.
            </span>
          </Step>
          <Step n={3}>
            <span>
              Confirmez votre paiement ici. Votre reçu arrivera sur cette page.
            </span>
          </Step>
        </ol>
      ) : null}

      {instructions ? (
        <div className="rounded-[var(--radius-md)] border border-line bg-surface-raised p-4">
          <h3 className="label m-0 pb-2 text-ink-muted">
            INSTRUCTIONS DE L’ASSOCIATION
          </h3>
          <p className="m-0 whitespace-pre-line break-words">{instructions}</p>
        </div>
      ) : null}
    </section>
  );
}
