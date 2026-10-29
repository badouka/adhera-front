/**
 * Icônes en SVG inline. Rien n'est chargé depuis un CDN (R3) et aucune
 * bibliothèque d'icônes n'alourdit le bundle.
 */

type IconProps = { className?: string; size?: number };

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
}

export function CheckIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2.25} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function ClockIcon({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

export function DownloadIcon({ className, size = 24 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

export function UploadIcon({ className, size = 20 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}

export function CopyIcon({ className, size = 18 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function BrokenLinkIcon({ className, size = 32 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function DocumentIcon({ className, size = 24 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

export function RetryIcon({ className, size = 20 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function AlertIcon({ className, size = 32 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v5" />
      <path d="M12 16.5h.01" />
    </svg>
  );
}

/** La pastille du logo Adhera, pour le pied de page. */
export function AdheraMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <circle cx="8" cy="8" r="8" fill="var(--indigo)" />
      <path
        d="M4.6 11.9 8 4.5l3.4 7.4"
        fill="none"
        stroke="var(--on-indigo)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.25 9.85h3.5"
        stroke="var(--on-indigo)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
