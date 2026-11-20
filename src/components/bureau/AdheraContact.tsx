import { ADHERA_CONTACT } from '@/lib/adhera';
import { ChatIcon } from './Icons';

/**
 * F7 § 5 — écrire à Adhera (DIGISSOL) : le lien WhatsApp et l'adresse e-mail,
 * sous une phrase qui dit pourquoi (P3, B11). Réservé à l'espace du bureau :
 * côté membre, c'est toujours l'association qu'on contacte.
 */
export function AdheraContact({ className = '' }: { className?: string }) {
  return (
    <span className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${className}`} data-testid="adhera-contact">
      <a
        href={ADHERA_CONTACT.whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-2 font-semibold"
      >
        <ChatIcon size={20} />
        WhatsApp
      </a>
      <a href={`mailto:${ADHERA_CONTACT.email}`} className="inline-flex min-h-11 items-center font-semibold break-all">
        {ADHERA_CONTACT.email}
      </a>
    </span>
  );
}
