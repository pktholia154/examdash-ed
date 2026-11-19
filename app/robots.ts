import type { MetadataRoute } from 'next';
import { getCanonicalBaseUrl } from '@/lib/seo/structured-data';

export const dynamic = 'force-dynamic';

const DISALLOWED_PATHS = [
  '/admin',
  '/account',
  '/checkout',
  '/login',
  '/signin',
  '/purchased',
  '/api/',
  '/search',
  '/exams/*/attempt',
  '/*?q=*',
  '/*?sort=*',
  '/*?filter=*',
  '/*?order=*',
];

const ALLOWED_PUBLIC_PATHS = ['/', '/_next/static/', '/_next/image/'];

/**
 * Granular robots.txt governance (Pillar 3 & Pillar 4):
 * - Explicitly allows core search engines and AI search/citation fetchers
 * - Explicitly allows static rendering assets (`/_next/static/`, `/_next/image/`) for WRS
 * - Independently disallows AI model-training scrapers
 * - Blocks private, checkout, CBT attempt, and parameter crawl-trap URLs
 */
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
        allow: ALLOWED_PUBLIC_PATHS,
        disallow: DISALLOWED_PATHS,
      },
      {
        userAgent: [
          'GPTBot',
          'ClaudeBot',
          'CCBot',
          'Bytespider',
          '__usage_ai-training',
        ],
        disallow: '/',
      },
      {
        userAgent: '*',
        allow: ALLOWED_PUBLIC_PATHS,
        disallow: DISALLOWED_PATHS,
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
