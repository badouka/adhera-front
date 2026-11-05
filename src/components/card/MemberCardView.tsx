import { SignedPhoto } from '@/components/SignedPhoto';
import { formatDate } from '@/lib/dates';
import type { CardLine, MemberCard } from '@/lib/types';
import { QrCode } from './QrCode';

/**
 * La carte de membre (F4 § 1.2) : un objet qu'on présente à un guichet. Grande,
 * lisible, sur fond clair.
 *
 * ⚠️ Elle porte le nom de L'ASSOCIATION, jamais celui du prestataire : aucune
 * mention de la plateforme dans ce composant (vérifié par un test).
 *
 * Les mentions facultatives DISPARAISSENT quand le serveur ne les sert pas :
 * jamais de « N° — », jamais de « depuis le — », jamais de logo de repli.
 */
export function MemberCardView({ card }: { card: MemberCard }) {
  const organisation = card.organisation_name.trim();
  const logo = card.logo_url;
  const number = card.member_number?.trim() ?? '';
  const since = formatDate(card.member_since);
  const category = card.category_label?.trim() ?? '';
  // `valid_until` est nul pour un exonéré, qui est pourtant à jour : le repère
  // est `is_up_to_date`, et la date ne s'ajoute que si elle existe (§16.2).
  const until = card.is_up_to_date ? formatDate(card.valid_until) : '';
  const verifyUrl = card.verify_url?.trim() ?? '';
  const lines = cardLines(card);

  return (
    <section
      aria-label="Ma carte de membre"
      data-testid="member-card"
      className="flex flex-col items-center gap-4 rounded-[var(--radius-md)] border border-line bg-surface-raised px-5 pt-5 pb-6 text-center text-ink"
    >
      {logo || organisation ? (
        <div className="flex w-full flex-col items-center gap-2 border-b border-line pb-4">
          {logo ? (
            // Le nom est écrit dessous : le logo est décoratif.
            <img
              src={logo}
              alt=""
              width={64}
              height={64}
              referrerPolicy="no-referrer"
              className="size-16 rounded-[var(--radius-sm)] object-contain"
              data-testid="card-logo"
            />
          ) : null}
          {organisation ? (
            <p className="title m-0 text-balance" data-testid="card-organisation">
              {organisation}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col items-center gap-1">
        {card.photo_url ? (
          // §21.2 — carrée et ré-encodée par le serveur : aucun recadrage ici.
          <SignedPhoto
            src={card.photo_url}
            alt={`Photo de ${card.display_name}`}
            size={128}
            className="mb-2 rounded-[var(--radius-md)] border border-line object-cover"
            testId="card-photo"
          />
        ) : null}
        <p className="m-0 text-[28px] leading-[34px] font-bold break-words">{card.display_name}</p>
        {category ? <p className="m-0 text-[18px] text-ink-muted">{category}</p> : null}
        {lines.length > 0 ? (
          <dl className="m-0 mt-1 flex flex-col items-center gap-1" data-testid="card-lines">
            {lines.map((line) => (
              <div key={line.label} className="flex flex-col items-center">
                <dt className="small text-ink-muted">{line.label}</dt>
                <dd className="m-0 text-[17px] font-semibold break-words">{line.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {number || since ? (
        <div className="flex flex-col items-center gap-[2px] text-[17px]">
          {number ? (
            <p className="m-0 font-semibold tnum" data-testid="card-number">
              N° {number}
            </p>
          ) : null}
          {since ? (
            <p className="m-0" data-testid="card-since">
              Membre depuis le {since}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col items-center gap-2">
        {/* Le libellé du serveur, tel quel : deux « à jour » se contrediraient. */}
        <span
          data-testid="card-standing"
          data-tone={card.is_up_to_date ? 'paid' : 'due'}
          className={`inline-flex items-center rounded-full px-4 py-[6px] text-[17px] font-bold ${
            card.is_up_to_date ? 'bg-paid-soft text-paid' : 'bg-due-soft text-due'
          }`}
        >
          {card.standing_label}
        </span>
        {until ? (
          <p className="m-0 font-semibold" data-testid="card-valid-until">
            Valable jusqu’au {until}
          </p>
        ) : null}
      </div>

      {verifyUrl ? (
        <div className="flex flex-col items-center gap-2">
          <QrCode value={verifyUrl} />
          <p className="small m-0 max-w-[260px] text-ink-muted">
            Montrez ce code : il permet de vérifier votre adhésion.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * §20.7 — les lignes de la carte, sous le type de membre : deux au plus, et
 * seulement celles qui portent une réponse. Le serveur les borne déjà ; l'écran
 * ne montre jamais une ligne vide (« Spécialité : » sans valeur).
 */
export function cardLines(card: MemberCard): CardLine[] {
  return (card.lines ?? [])
    .filter((line) => line.label?.trim() && line.value?.trim())
    .slice(0, 2);
}
