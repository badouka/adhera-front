import type { Metadata } from 'next';
import { BureauFrame } from '@/components/bureau/BureauFrame';

/**
 * R5 : rien n'est mis en cache. `force-dynamic` vaut pour tout `/bureau`.
 *
 * Ce layout reste un composant serveur pour porter `metadata` (titre neutre,
 * `noindex, nofollow`) ; la garde de session, la navigation et la bannière de
 * mode vivent dans `<BureauFrame>`, composant client. Aucun fetch ici.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Espace du bureau',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function BureauLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <BureauFrame>{children}</BureauFrame>;
}
