import type { MetadataRoute } from 'next';

/** R3 : rien de ce domaine n'a vocation à être indexé. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: '/' }] };
}
