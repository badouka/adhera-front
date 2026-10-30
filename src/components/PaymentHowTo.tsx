'use client';

import { useRef } from 'react';
import type { Organisation } from '@/lib/types';
import { CopyButton } from './CopyButton';

function MerchantCard({ channel, value }: { channel: string; value: string }) {
  const numberRef = useRef<HTMLSpanElement>(null);

  return (
    <li className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-line bg-surface-raised p-4">
      <span className="flex flex-col">
        <span className="label text-ink-muted">{channel.toUpperCase()}</span>
        <span ref={numberRef} className="tnum text-[26px] leading-8 font-bold break-words">
          {value}
        </span>
      </span>
      <CopyButton
        value={value}
        label={`Copier le numéro ${channel}`}
        selectRef={numberRef}
        large
      />
    </li>
  );
}

/**
 * « Comment payer » : une carte par moyen configuré (Wave d'abord, puis Orange
 * Money), le numéro en grand et un large bouton « Copier ». Les instructions
 * libres de l'association suivent.
 *
 * `payment_instructions` est du TEXTE : rendu tel quel, avec ses retours à la
 * ligne, jamais en HTML.
 */
export function PaymentHowTo({ organisation }: { organisation: Organisation }) {
  const channels: Array<{ channel: string; value: string }> = [];
  if (organisation.wave_merchant_number) {
    channels.push({ channel: 'Wave', value: organisation.wave_merchant_number });
  }
  if (organisation.om_merchant_number) {
    channels.push({
      channel: 'Orange Money',
      value: organisation.om_merchant_number,
    });
  }

  const instructions = organisation.payment_instructions?.trim();

  if (channels.length === 0 && !instructions) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="heading m-0">Comment payer</h2>

      {channels.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {channels.map((c) => (
            <MerchantCard key={c.channel} {...c} />
          ))}
        </ul>
      ) : null}

      {instructions ? (
        <p className="m-0 whitespace-pre-line break-words text-ink-muted">
          {instructions}
        </p>
      ) : null}
    </section>
  );
}
