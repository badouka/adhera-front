/**
 * La carte de membre DESSINÉE EN PNG, dans le navigateur (F5 § 3) : le nom de
 * l'association, le nom du membre, son type, son numéro, sa pastille et le QR
 * de vérification. Aucune image n'est demandée à un tiers (R3) : le logo, servi
 * par un autre domaine, n'y est pas — il « salirait » le canevas.
 *
 * ⚠️ Ce module n'est chargé QU'AU TOUCHER de « Enregistrer ma carte dans mes
 * photos » (`import()`), comme la bibliothèque QR : il n'entre dans le premier
 * chargement d'aucune page (garde-fou à l'appui).
 *
 * Les couleurs sont lues dans les jetons de la page (`--ink`, `--paid`…) :
 * aucune couleur n'est écrite ici.
 */

import { formatDate } from '@/lib/dates';
import type { MemberCard } from '@/lib/types';
import { cardLines } from './MemberCardView';
import { makeQrMatrix } from './QrCode';

const WIDTH = 1080;
const PAD = 72;

type Palette = Record<
  'surface' | 'raised' | 'line' | 'ink' | 'muted' | 'paid' | 'paidSoft' | 'due' | 'dueSoft',
  string
>;

function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    surface: read('--surface', 'white'),
    raised: read('--surface-raised', 'white'),
    line: read('--line', 'silver'),
    ink: read('--ink', 'black'),
    muted: read('--ink-muted', 'dimgray'),
    paid: read('--paid', 'darkgreen'),
    paidSoft: read('--paid-soft', 'honeydew'),
    due: read('--due', 'saddlebrown'),
    dueSoft: read('--due-soft', 'cornsilk'),
  };
}

function fontFamily(): string {
  return getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
}

/** Coupe un texte en lignes qui tiennent dans `max` pixels. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Le texte de la pastille : le libellé du serveur, tel quel (§16.2). */
function standingText(card: MemberCard): { label: string; until: string } {
  const until = card.is_up_to_date ? formatDate(card.valid_until) : '';
  return { label: card.standing_label, until: until ? `Valable jusqu’au ${until}` : '' };
}

/** Le nom du fichier : `carte-aminata-diop.png`, sans accent ni espace. */
export function cardFileName(card: MemberCard): string {
  const slug = (text: string | null | undefined) =>
    (text ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const parts = [slug(card.first_name), slug(card.last_name)].filter(Boolean);
  const name = parts.length > 0 ? parts.join('-') : slug(card.display_name);
  return `carte-${name || 'membre'}.png`;
}

/** Dessine la carte et rend le PNG, et son adresse `data:` pour l'afficher. */
export async function drawCard(card: MemberCard): Promise<{ blob: Blob; dataUrl: string }> {
  const colors = palette();
  const family = fontFamily();
  const verifyUrl = card.verify_url?.trim() ?? '';
  const matrix = verifyUrl ? await makeQrMatrix(verifyUrl) : null;

  // Un premier canevas pour mesurer, puis le vrai, à la bonne hauteur.
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('Canvas indisponible');
  const inner = WIDTH - PAD * 2;
  probe.font = `700 46px ${family}`;
  const orgLines = card.organisation_name.trim() ? wrap(probe, card.organisation_name.trim(), inner) : [];
  probe.font = `700 72px ${family}`;
  const nameLines = wrap(probe, card.display_name, inner);
  const subline = [
    card.category_label?.trim() || null,
    card.member_number?.trim() ? `n° ${card.member_number.trim()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const standing = standingText(card);
  // §20.7 — les mêmes lignes que la carte à l'écran : « Spécialité : … ».
  probe.font = `600 38px ${family}`;
  const answerLines = cardLines(card).flatMap((line) => wrap(probe, `${line.label} : ${line.value}`, inner));
  const qrSize = 520;

  let height = PAD;
  height += orgLines.length * 58 + (orgLines.length ? 40 : 0);
  height += nameLines.length * 84 + 16;
  height += subline ? 56 : 0;
  height += answerLines.length ? answerLines.length * 50 + 8 : 0;
  height += 24 + 76 + (standing.until ? 56 : 0);
  height += matrix ? 40 + qrSize + 24 + 50 : 0;
  height += PAD;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');

  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, WIDTH, height);
  roundRect(ctx, 16, 16, WIDTH - 32, height - 32, 36);
  ctx.fillStyle = colors.raised;
  ctx.fill();
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const cx = WIDTH / 2;
  let y = PAD;

  if (orgLines.length) {
    ctx.fillStyle = colors.ink;
    ctx.font = `700 46px ${family}`;
    for (const line of orgLines) {
      ctx.fillText(line, cx, y);
      y += 58;
    }
    y += 16;
    ctx.fillStyle = colors.line;
    ctx.fillRect(PAD, y, inner, 3);
    y += 24;
  }

  ctx.fillStyle = colors.ink;
  ctx.font = `700 72px ${family}`;
  for (const line of nameLines) {
    ctx.fillText(line, cx, y);
    y += 84;
  }
  y += 16;

  if (subline) {
    ctx.fillStyle = colors.muted;
    ctx.font = `400 40px ${family}`;
    ctx.fillText(subline, cx, y);
    y += 56;
  }

  if (answerLines.length) {
    ctx.fillStyle = colors.ink;
    ctx.font = `600 38px ${family}`;
    for (const line of answerLines) {
      ctx.fillText(line, cx, y, inner);
      y += 50;
    }
    y += 8;
  }

  y += 24;
  ctx.font = `700 40px ${family}`;
  const pillW = Math.min(inner, ctx.measureText(standing.label).width + 80);
  roundRect(ctx, cx - pillW / 2, y, pillW, 76, 38);
  ctx.fillStyle = card.is_up_to_date ? colors.paidSoft : colors.dueSoft;
  ctx.fill();
  ctx.fillStyle = card.is_up_to_date ? colors.paid : colors.due;
  ctx.fillText(standing.label, cx, y + 16);
  y += 76;
  if (standing.until) {
    y += 16;
    ctx.fillStyle = colors.ink;
    ctx.font = `600 38px ${family}`;
    ctx.fillText(standing.until, cx, y);
    y += 40;
  }

  if (matrix) {
    y += 40;
    const quiet = 4;
    const cell = qrSize / (matrix.size + quiet * 2);
    const x0 = cx - qrSize / 2;
    ctx.fillStyle = 'white';
    ctx.fillRect(x0, y, qrSize, qrSize);
    ctx.fillStyle = colors.ink;
    for (const [, col, row] of matrix.path.matchAll(/M(\d+) (\d+)/g)) {
      ctx.fillRect(
        Math.floor(x0 + (Number(col) + quiet) * cell),
        Math.floor(y + (Number(row) + quiet) * cell),
        Math.ceil(cell),
        Math.ceil(cell),
      );
    }
    y += qrSize + 24;
    ctx.fillStyle = colors.muted;
    ctx.font = `400 34px ${family}`;
    ctx.fillText('Montrez ce code : il permet de vérifier votre adhésion.', cx, y, inner);
  }

  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG indisponible'))), 'image/png');
  });
  return { blob, dataUrl };
}
