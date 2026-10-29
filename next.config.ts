import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * R3 — le jeton ne fuit pas.
 *
 * `connect-src` n'autorise que l'API d'EventFlow : aucun script tiers ne peut
 * exfiltrer l'URL. `script-src` doit garder 'unsafe-inline' parce que Next
 * injecte le bootstrap d'hydratation en ligne ; aucun HTML d'origine serveur
 * n'est jamais rendu (payment_instructions est rendu en TEXTE), donc la surface
 * XSS reste nulle. 'unsafe-eval' n'est concédé qu'au HMR du mode dev.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.eventflow.africa",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
