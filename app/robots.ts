import type { MetadataRoute } from 'next';
import { getCanonicalBaseUrl } from '@/lib/seo/structured-data';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getCanonicalBaseUrl();

  return {
    rules: [
      {
        userAgent: [
          'Googlebot',
          'Bingbot',
          'Applebot',
          'OAI-SearchBot',
          'ChatGPT-User',
          'Claude-SearchBot',
          'PerplexityBot',
          'Google-Extended',
        ],
        allow: '/',
        disallow: ['/admin', '/account', '/checkout', '/purchased', '/api/', '/search'],
      },
      {
        userAgent: ['GPTBot', 'ClaudeBot', 'CCBot', 'Bytespider'],
        disallow: '/',
      },
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/account', '/checkout', '/purchased', '/api/', '/search'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
