'use client';

import { useEffect, useState } from 'react';

type Matrix = { size: number; path: string };

/** Les modules sombres, en un seul tracé : un carré d'un module par case. */
export function qrPath(size: number, isDark: (row: number, col: number) => boolean): string {
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return path;
}

/** Engendre la matrice : la bibliothèque n'est chargée qu'ici, à la demande. */
export async function makeQrMatrix(value: string): Promise<Matrix> {
  const { default: qrcode } = await import('qrcode-generator');
  // Type 0 : la plus petite version qui contient l'adresse. Niveau M : il
  // résiste à un écran rayé ou à une impression pâle.
  const qr = qrcode(0, 'M');
  qr.addData(value, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  return { size, path: qrPath(size, (r, c) => qr.isDark(r, c)) };
}

/**
 * Le QR code de `verify_url`, engendré DANS le navigateur : aucune image n'est
 * demandée à un tiers (R3), et il reste affichable hors connexion.
 *
 * Sombre sur blanc quelle que soit la page, avec sa zone de silence de quatre
 * modules : sans elle, un lecteur ne trouve pas les repères.
 */
export function QrCode({ value, size = 208 }: { value: string; size?: number }) {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setMatrix(null);
    setFailed(false);
    makeQrMatrix(value).then(
      (next) => {
        if (alive) setMatrix(next);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [value]);

  if (failed) return null;

  const quiet = 4;
  return (
    <div
      className="flex items-center justify-center rounded-[var(--radius-sm)] bg-surface-raised"
      style={{ width: size, height: size }}
      data-testid="qr-code"
    >
      {matrix ? (
        <svg
          role="img"
          aria-label="Code QR de vérification de l’adhésion"
          viewBox={`${-quiet} ${-quiet} ${matrix.size + quiet * 2} ${matrix.size + quiet * 2}`}
          width={size}
          height={size}
          shapeRendering="crispEdges"
          className="text-ink"
        >
          <rect
            x={-quiet}
            y={-quiet}
            width={matrix.size + quiet * 2}
            height={matrix.size + quiet * 2}
            className="fill-surface-raised"
          />
          <path d={matrix.path} fill="currentColor" />
        </svg>
      ) : (
        <span className="sr-only">Préparation du code QR…</span>
      )}
    </div>
  );
}
