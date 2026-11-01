'use client';

import { useState } from 'react';
import { DownloadIcon } from '@/components/Icons';
import {
  downloadMembersExport,
  downloadPaymentsExport,
  isSessionError,
  type DownloadedFile,
  type PeriodQuery,
} from '@/lib/bureau/api';
import { errorMessage } from '@/lib/bureau/messages';
import { todayInDakar } from '@/lib/dates';
import { saveBlob } from './Documents';
import { buttonClass } from './ui';

/**
 * Un export Excel. Les routes exigent le Bearer : le fichier est tiré par
 * `fetch`, lu en BLOB (jamais en JSON, piège 29), puis remis au navigateur.
 *
 * Le nom vient du `Content-Disposition`, exposé en CORS depuis S3d ; le nom
 * composé ici ne sert qu'en repli, si l'en-tête manque.
 */
function ExportButton({
  label,
  fallbackName,
  run,
}: {
  label: string;
  fallbackName: string;
  run: () => Promise<DownloadedFile>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const file = await run();
      saveBlob(file.blob, file.filename ?? fallbackName);
    } catch (cause) {
      if (!isSessionError(cause)) {
        setError(errorMessage(cause, 'Le fichier n’a pas pu être préparé.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={buttonClass('secondary', 'min-h-12 w-full sm:w-auto')}
      >
        <DownloadIcon size={18} />
        {busy ? 'Préparation du fichier…' : label}
      </button>
      {error ? (
        <span role="alert" className="small font-semibold text-late">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Les deux exports du tableau de bord, sur la période affichée. */
export function ExportButtons({
  query,
  period,
}: {
  /** Les bornes envoyées au tableau de bord : les mêmes pour le journal. */
  query: PeriodQuery;
  /** Les bornes servies, pour nommer le fichier. */
  period: { from: string; to: string } | null;
}) {
  const today = todayInDakar();
  const window_ = period ? `${period.from}_${period.to}` : today;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <ExportButton
        label="Registre des membres (Excel)"
        fallbackName={`registre-membres-${today}.xlsx`}
        run={downloadMembersExport}
      />
      <ExportButton
        label="Versements de la période (Excel)"
        fallbackName={`versements-${window_}.xlsx`}
        run={() => downloadPaymentsExport(query)}
      />
    </div>
  );
}
