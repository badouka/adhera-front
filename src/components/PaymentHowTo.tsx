'use client';

import { useRef } from 'react';
import type { Organisation } from '@/lib/types';
import { CopyButton } from './CopyButton';

function MerchantLine({ channel, value }: { channel: string; value: string }) {
  const numberRef = useRef<HTMLSpanElement>(null);

  return (
    <li className="flex min-h-[60px] items-center justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <span className="flex min-w-0 flex-col">
        <span className="small text-ink-muted">{channel}</span>
        <span ref={numberRef} className="tnum text-[18px] leading-6 font-bold break-words">
          {value}
        </span>
      </span>
      <CopyButton value={value} label={`Copier le numéro ${channel}`} selectRef={numberRef} />
    </li>
  );
}

/**
 * Où payer : une ligne par moyen configuré (Wave d'abord, puis Orange Money),
 * le numéro et « Copier », dans une seule carte (maquette, écran 9). Les
 * instructions libres de l'association suivent.
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
    <section className="flex flex-col gap-3" aria-label="Où payer">
      {channels.length > 0 ? (
        <ul className="m-0 flex list-none flex-col rounded-[var(--radius-md)] border border-line bg-surface-raised px-4 py-1">
          {channels.map((c) => (
            <MerchantLine key={c.channel} {...c} />
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
