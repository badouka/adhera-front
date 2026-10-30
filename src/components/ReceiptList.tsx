import { receiptUrl } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import type { Receipt } from '@/lib/types';
import { DownloadIcon } from './Icons';

/**
 * Les reçus émis par le bureau. Une liste vide ne rend RIEN : pas de
 * « Aucun reçu » anxiogène.
 *
 * Le lien est un `<a>` : un fetch ne conviendrait pas (le serveur répond
 * `Content-Disposition: attachment`) et un lien ne peut pas porter l'en-tête
 * de tenant, qui passe donc en query. `rel="noreferrer"` empêche la fuite du
 * jeton par l'en-tête Referer (R3).
 */
export function ReceiptList({
  receipts,
  token,
  tenant,
}: {
  receipts: Receipt[];
  token: string;
  tenant: string;
}) {
  if (receipts.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="heading m-0">Mes reçus</h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {receipts.map((receipt) => (
          <li key={receipt.id}>
            <a
              href={receiptUrl(token, tenant, receipt.id)}
              rel="noreferrer"
              className="flex min-h-14 items-center gap-3 rounded-[var(--radius-md)] border border-line bg-surface-raised px-3 py-2 text-ink no-underline"
            >
              <DownloadIcon className="shrink-0 text-indigo" />
              <span className="flex min-w-0 grow flex-col">
                <span className="font-semibold tnum">
                  Cotisation de <span className="money">{receipt.amount_formatted}</span>
                </span>
                <span className="small text-ink-muted">
                  Reçu {receipt.reference} du {formatDateTime(receipt.issued_at)}
                </span>
                <span className="small font-semibold text-indigo">
                  Télécharger
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
