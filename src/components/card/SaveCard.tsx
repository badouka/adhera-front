'use client';

import { useEffect, useRef, useState } from 'react';
import { isInAppBrowser } from '@/lib/install';
import type { MemberCard } from '@/lib/types';

type Shown = { dataUrl: string; name: string } | null;

/** Le partage de fichiers, quand le téléphone le permet (Android, iOS récents). */
function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true;
  } catch {
    return false;
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * « Enregistrer ma carte dans mes photos » (F5 § 3), à la place de « Garder
 * sur mon téléphone » : l'installation perdait l'utilisateur.
 *
 * La carte est dessinée en PNG dans le navigateur — le code de dessin n'est
 * chargé qu'au toucher —, puis :
 * 1. dans le navigateur intégré de WhatsApp (ou de Facebook, d'Instagram), où
 *    le partage et le téléchargement échouent souvent : l'image en plein
 *    écran, « Appuyez longuement sur l'image, puis Enregistrer » ;
 * 2. sinon, le partage du téléphone (`navigator.share({ files })`) ;
 * 3. à défaut, un téléchargement `carte-{prenom}-{nom}.png`.
 */
export function SaveCard({ card }: { card: MemberCard }) {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Shown>(null);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (shown) closeRef.current?.focus();
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShown(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown]);

  async function save() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { drawCard, cardFileName } = await import('./cardImage');
      const { blob, dataUrl } = await drawCard(card);
      const name = cardFileName(card);

      if (isInAppBrowser(navigator.userAgent)) {
        setShown({ dataUrl, name });
        return;
      }

      const file = new File([blob], name, { type: 'image/png' });
      if (canShareFile(file)) {
        try {
          await navigator.share({ files: [file], title: 'Ma carte de membre' });
          return;
        } catch (cause) {
          // Le membre a refermé le partage : rien à faire de plus.
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
        }
      }
      download(blob, name);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className="flex min-h-14 w-full items-center justify-center rounded-[var(--radius-md)] bg-indigo px-4 py-2 text-center text-[17px] leading-[22px] font-semibold text-on-indigo disabled:opacity-60"
      >
        {busy ? 'Préparation de l’image…' : 'Enregistrer ma carte dans mes photos'}
      </button>
      <p className="small m-0 text-center text-ink-muted">
        Vous la retrouverez dans votre galerie, même sans connexion. Le code dit
        toujours si vous êtes à jour au moment où on le lit.
      </p>
      {failed ? (
        <p role="alert" className="small m-0 text-center font-semibold text-late">
          L’image n’a pas pu être préparée. Faites une capture d’écran de la carte.
        </p>
      ) : null}

      {shown ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Ma carte, à enregistrer"
          className="fixed inset-0 z-50 flex flex-col items-center gap-4 overflow-auto bg-ink p-4 text-on-indigo"
          data-testid="card-image"
        >
          <p className="heading m-0 text-center">
            Appuyez longuement sur l’image, puis Enregistrer
          </p>
          <img
            src={shown.dataUrl}
            alt="Ma carte de membre"
            className="h-auto w-full max-w-[420px] rounded-[var(--radius-md)]"
          />
          <button
            ref={closeRef}
            type="button"
            onClick={() => setShown(null)}
            className="min-h-12 rounded-[var(--radius-md)] border border-on-indigo bg-transparent px-6 font-semibold text-on-indigo"
          >
            Fermer
          </button>
        </div>
      ) : null}
    </>
  );
}
