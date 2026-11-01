'use client';

import { useEffect, useRef, useState } from 'react';
import type { Dashboard } from '@/lib/bureau/types';
import { shortMonth } from '@/lib/dates';

type Month = Dashboard['evolution'][number];

const HEIGHT = 168;
const LABEL_BAND = 22;
const TOP = 8;
/** L'espace entre deux barres, et le rayon de leur extrémité. */
const GAP = 4;
const RADIUS = 4;

/** Une barre arrondie EN HAUT seulement, posée sur la ligne de base. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * L'encaissé des 12 derniers mois, en barres — dessiné à la main en SVG :
 * aucune bibliothèque de graphiques (la cible de 200 Ko gzip par route).
 *
 * - Les mois vides sont là, à 0 : les filtrer ferait paraître continue une
 *   période où rien n'est entré (piège 27).
 * - Le seul nombre lu est `collected`, pour la HAUTEUR ; tout ce qui s'affiche
 *   vient de `collected_formatted` et `label` (R1).
 * - Toucher (ou survoler, ou parcourir au clavier) une barre affiche son mois
 *   et son montant au-dessus du graphique. Par défaut : le mois le plus récent.
 */
export function EvolutionChart({ months }: { months: Month[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(328);
  const [selected, setSelected] = useState(months.length - 1);

  useEffect(() => {
    setSelected(months.length - 1);
  }, [months]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      if (box.clientWidth > 0) setWidth(box.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const max = Math.max(0, ...months.map((m) => m.collected));
  const slot = months.length > 0 ? width / months.length : width;
  const barWidth = Math.max(4, Math.min(48, slot - GAP));
  const plot = HEIGHT - LABEL_BAND - TOP;
  const current = months[selected] ?? months[months.length - 1];

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 min-h-7 font-semibold" aria-live="polite" data-testid="chart-readout">
        {current ? (
          <>
            <span className="capitalize">{current.label}</span> :{' '}
            <span className="money">{current.collected_formatted}</span>
          </>
        ) : null}
      </p>

      <div ref={boxRef} className="w-full min-w-0">
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="group"
          aria-label="Encaissé par mois, sur les 12 derniers mois"
          className="block max-w-full"
        >
          <line
            x1={0}
            x2={width}
            y1={TOP + plot + 0.5}
            y2={TOP + plot + 0.5}
            className="stroke-line-strong"
            strokeWidth={1}
          />
          {months.map((month, index) => {
            const h = max > 0 ? (month.collected / max) * plot : 0;
            const x = index * slot + (slot - barWidth) / 2;
            const active = index === selected;
            return (
              <g
                key={month.month}
                data-testid="bar"
                role="img"
                aria-label={`${month.label} : ${month.collected_formatted}`}
                tabIndex={0}
                onClick={() => setSelected(index)}
                onMouseEnter={() => setSelected(index)}
                onFocus={() => setSelected(index)}
                className="cursor-pointer outline-none focus-visible:[&>rect:first-child]:stroke-[var(--focus)]"
              >
                {/* La cible du toucher : toute la colonne, pas la seule barre. */}
                <rect
                  x={index * slot}
                  y={0}
                  width={slot}
                  height={HEIGHT}
                  fill="transparent"
                  strokeWidth={2}
                />
                {h > 0 ? (
                  <path
                    d={barPath(x, TOP + plot - h, barWidth, h)}
                    className={active ? 'fill-indigo' : 'fill-indigo/55'}
                  />
                ) : null}
                <text
                  x={index * slot + slot / 2}
                  y={HEIGHT - 6}
                  textAnchor="middle"
                  className={`text-[11px] ${active ? 'fill-ink font-bold' : 'fill-ink-muted'}`}
                >
                  {shortMonth(month.month)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {max === 0 ? (
        <p className="small m-0 text-ink-muted">Rien n’a été encaissé sur ces 12 mois.</p>
      ) : null}

      {/* La même série en tableau, pour un lecteur d'écran. */}
      <table className="sr-only">
        <caption>Encaissé par mois</caption>
        <tbody>
          {months.map((month) => (
            <tr key={month.month}>
              <th scope="row">{month.label}</th>
              <td>{month.collected_formatted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
