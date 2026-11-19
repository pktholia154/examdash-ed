import { revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { submitIndexNowUrls } from '@/lib/seo/indexnow';
import { getCanonicalBaseUrl } from '@/lib/seo/structured-data';

export const runtime = 'nodejs';

const ALLOWED_TAGS = new Set(['catalog-books', 'catalog-exams', 'sitemap']);

/**
 * Event-driven Cache-Tag invalidation + IndexNow notification endpoint (Pillars 2 & 4).
 * Protected by server-only `SEO_REVALIDATE_SECRET`.
 */
export async function POST(req: NextRequest) {
  const configuredSecret = process.env.SEO_REVALIDATE_SECRET?.trim() ?? '';
  if (!configuredSecret) {
    return NextResponse.json(
      { error: 'SEO_REVALIDATE_SECRET is not configured on this server.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const providedSecret = req.headers.get('x-revalidate-secret')?.trim() ?? '';
  if (!providedSecret || providedSecret !== configuredSecret) {
    return NextResponse.json(
      { error: 'Unauthorized.' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  let body: { tags?: unknown; urls?: unknown };
  try {
    body = (await req.json()) as { tags?: unknown; urls?: unknown };
  } catch {
    body = {};
  }

  const requestedTags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === 'string' && ALLOWED_TAGS.has(t))
    : ['catalog-books', 'catalog-exams', 'sitemap'];

  for (const tag of requestedTags) {
    revalidateTag(tag);
  }

  const urls = Array.isArray(body.urls)
    ? body.urls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    : [];

  const indexNow =
    urls.length > 0
      ? await submitIndexNowUrls(getCanonicalBaseUrl(), urls)
      : { submitted: false, urlCount: 0, reason: 'No URLs provided.' };

  return NextResponse.json(
    {
      revalidatedTags: requestedTags,
      indexNow,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    }
  );
}
