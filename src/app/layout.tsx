import type { Metadata, Viewport } from 'next';
import { Public_Sans } from 'next/font/google';
import './globals.css';

/**
 * R3 : la police est téléchargée AU BUILD par next/font et servie par l'app.
 * Aucun appel à Google au runtime, donc aucun tiers à qui l'URL pourrait fuir.
 */
const publicSans = Public_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '600', '700'],
  variable: '--font-public-sans',
  display: 'swap',
});

/**
 * Le titre reste neutre : il apparaît dans l'historique du téléphone et dans
 * les aperçus de partage, il ne doit nommer ni l'association ni le membre.
 */
export const metadata: Metadata = {
  title: 'Ma cotisation',
  description: 'Votre cotisation et vos reçus.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={publicSans.variable}>
      <body>{children}</body>
    </html>
  );
}
