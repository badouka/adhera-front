'use client';

import { useState } from 'react';

/**
 * §21.3 — une photo servie par un lien signé de 60 minutes. Au-delà, l'API rend
 * `403 invalid_signature` : plutôt qu'une image cassée, l'écran dit quoi faire.
 * Le lien ne se met pas en cache, il se redemande en relisant la page.
 */
export function SignedPhoto({
  src,
  alt,
  size,
  className,
  testId,
}: {
  src: string;
  alt: string;
  size: number;
  className: string;
  testId: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  if (broken === src) {
    return (
      <span
        className="small inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-line p-2 text-center text-ink-muted"
        style={{ width: size, minHeight: size }}
        data-testid={`${testId}-expired`}
      >
        Photo indisponible : rechargez la page.
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      style={{ width: size, height: size }}
      className={className}
      onError={() => setBroken(src)}
      data-testid={testId}
    />
  );
}
