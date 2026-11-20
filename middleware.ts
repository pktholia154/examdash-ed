import { NextRequest, NextResponse } from 'next/server';
import {
  buildCanonicalRedirectUrl,
  evaluateHostPolicy,
  normalizeHostname,
} from '@/lib/seo/host-policy';

const MARKETING_PARAMS = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'yclid',
  'mc_cid',
  'mc_eid',
]);

function hasMarketingParams(searchParams: URLSearchParams): boolean {
  for (const key of searchParams.keys()) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || MARKETING_PARAMS.has(lower)) {
      return true;
    }
  }
  return false;
}

function isClientRouterPartialRequest(req: NextRequest): boolean {
  return (
    req.headers.has('rsc') ||
    req.headers.has('next-router-prefetch') ||
    req.headers.has('next-router-segment-prefetch') ||
    req.headers.has('next-router-state-tree')
  );
}

function isPrivateOrNonIndexablePath(pathname: string): boolean {
  return (
    pathname.startsWith('/purchased') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/account') ||
    pathname.startsWith('/checkout') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signin') ||
    pathname.startsWith('/search') ||
    /^\/exams\/[^/]+\/attempt(\/|$)/.test(pathname)
  );
}

function isCanonicalPublicHtmlPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/books' ||
    pathname.startsWith('/books/') ||
    pathname === '/exams' ||
    pathname.startsWith('/exams/') ||
    pathname === '/privacy-policy' ||
    pathname === '/terms-of-service' ||
    pathname === '/refund-policy' ||
    pathname === '/license-agreement' ||
    pathname === '/contact-us'
  );
}

/**
 * Edge/Server Middleware enforcing Pillars 2 & 3:
 * - Single-hop 301 canonical host lock (`www` / mirror -> `https://<CANONICAL_HOST>`) with safe AI Studio preview noindex
 * - Single-hop 301 normalization for `?page=1` -> base path and uppercase `/books` or `/exams` hub paths
 * - Split Document vs. Client-Router (`RSC`) caching so wire payloads never poison canonical HTML cache entries
 * - Short edge TTL (`s-maxage=60`) on marketing query variants (`?utm_*`, `?gclid`, `?fbclid`) while preserving 200 OK
 * - Strict `private, no-cache, no-store` + `X-Robots-Tag: noindex, nofollow` on private/attempt routes
 */
export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // 0. Host canonicalization & mirror protection (evaluated first for single-hop redirects)
  const rawRequestHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const canonicalHost = normalizeHostname(
    process.env.CANONICAL_HOST || process.env.CANONICAL_APP_URL || 'exam-dash.com'
  );
  const enforceCanonicalHost =
    (process.env.ENFORCE_CANONICAL_HOST || '').trim().toLowerCase() === 'true';

  const hostAction = evaluateHostPolicy({
    requestHost: rawRequestHost,
    canonicalHost,
    enforceCanonicalHost,
  });

  if (hostAction === 'redirect') {
    const redirectUrl = buildCanonicalRedirectUrl(canonicalHost, pathname, searchParams);
    return NextResponse.redirect(redirectUrl, 301);
  }

  // 1. Serve standard IndexNow `/<key>.txt` location alongside `/indexnow-key.txt`
  const indexNowKey = process.env.INDEXNOW_KEY?.trim();
  if (indexNowKey && pathname === `/${indexNowKey}.txt`) {
    const rewriteRes = NextResponse.rewrite(new URL('/indexnow-key.txt', req.url));
    if (hostAction === 'noindex') {
      rewriteRes.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    return rewriteRes;
  }

  // 2. Normalize `?page=1` -> clean base path via single-hop 301 redirect
  if (searchParams.get('page') === '1') {
    const target = req.nextUrl.clone();
    target.searchParams.delete('page');
    return NextResponse.redirect(target, 301);
  }

  // 3. Enforce lowercase canonical path for hub routes (`/Books` -> `/books`, `/Exams` -> `/exams`)
  // Detail routes (`/books/[slug]`, `/exams/[slug]`) handle ID & casing redirects in a single hop.
  if (/^\/(?:books|exams)\/?$/i.test(pathname) && pathname !== pathname.toLowerCase()) {
    const target = req.nextUrl.clone();
    target.pathname = pathname.toLowerCase().replace(/\/+$/, '');
    return NextResponse.redirect(target, 301);
  }

  const response = NextResponse.next();

  if (hostAction === 'noindex') {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  // 4. Split Document vs. Client-Router Caching (Pillar 2)
  if (isClientRouterPartialRequest(req)) {
    response.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0');
    return response;
  }

  // 5. Private / interactive non-indexable paths
  if (isPrivateOrNonIndexablePath(pathname)) {
    response.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }

  // 6. Canonical Public HTML Document Requests
  if (isCanonicalPublicHtmlPath(pathname)) {
    if (hasMarketingParams(searchParams)) {
      // Preserve 200 OK attribution while preventing edge cache bloat
      response.headers.set(
        'Cache-Control',
        'public, max-age=0, s-maxage=60, stale-while-revalidate=60'
      );
    } else {
      response.headers.set(
        'Cache-Control',
        'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400'
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files, Next.js internals, API routes, OG thumbnails, and well-known files.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|sitemaps/|indexnow-key.txt|wasm/|\\.well-known/|.*opengraph-image|.*twitter-image|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?|css|js|wasm|json)$).*)',
  ],
};
