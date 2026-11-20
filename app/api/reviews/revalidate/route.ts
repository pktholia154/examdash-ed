import { revalidatePath, revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { extractBearerToken, verifyFirebaseIdToken } from '@/lib/firebase/server-auth';

export const runtime = 'nodejs';

/**
 * Authenticated cache-tag revalidation endpoint triggered after a genuine signed-in user
 * submits, updates, deletes, or votes on a review so SSR HTML and JSON-LD refresh immediately.
 */
export async function POST(req: NextRequest) {
  const token = extractBearerToken(req);
  if (!token) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const user = await verifyFirebaseIdToken(token);
  if (!user || !user.emailVerified) {
    return NextResponse.json(
      { error: 'Verified user session required.' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  let body: { contentType?: unknown; urlSlug?: unknown } = {};
  try {
    body = (await req.json()) as { contentType?: unknown; urlSlug?: unknown };
  } catch {
    body = {};
  }

  revalidateTag('catalog-reviews');

  const contentType =
    body.contentType === 'books' || body.contentType === 'exams' ? body.contentType : null;
  const slug =
    typeof body.urlSlug === 'string' && /^[a-z0-9-]+$/i.test(body.urlSlug.trim())
      ? body.urlSlug.trim().toLowerCase()
      : null;

  if (contentType && slug) {
    revalidatePath(`/${contentType}/${slug}`);
  }

  return NextResponse.json(
    { revalidated: true },
    { status: 200, headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
  );
}
