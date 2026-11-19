import { NextRequest, NextResponse } from 'next/server';
import { verifyEntitlementProof } from '@/core/payments/razorpay';
import {
  extractBearerToken,
  fetchServerBookFilePaths,
  resolveFirebaseStorageUrl,
  verifyFirebaseIdToken,
} from '@/lib/firebase/server-auth';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const mode = req.nextUrl.searchParams.get('mode') === 'full' ? 'full' : 'sample';

    const bookPaths = await fetchServerBookFilePaths(id);
    if (!bookPaths) {
      return NextResponse.json({ error: 'Book not found.' }, { status: 404 });
    }

    let targetUrl: string | null = null;
    const upstreamHeaders: Record<string, string> = {};

    if (mode === 'sample') {
      if (!bookPaths.sampleMarkdownUrl) {
        return NextResponse.json(
          { error: 'Sample Markdown is not available for this book.' },
          { status: 404 }
        );
      }
      targetUrl = resolveFirebaseStorageUrl(bookPaths.sampleMarkdownUrl);
    } else {
      const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? '';
      const token = extractBearerToken(req);
      const entitlementProof = req.headers.get('x-entitlement-proof')?.trim() ?? '';

      if (!token) {
        return NextResponse.json({ error: 'Sign in with Google to access full books.' }, { status: 401 });
      }
      const verifiedUser = await verifyFirebaseIdToken(token);
      if (!verifiedUser) {
        return NextResponse.json({ error: 'Session expired. Please sign in again.' }, { status: 401 });
      }

      const proofCheck = verifyEntitlementProof(
        entitlementProof,
        { uid: verifiedUser.uid, itemId: bookPaths.id, contentType: 'books' },
        keySecret
      );
      if (!proofCheck.valid) {
        return NextResponse.json(
          { error: 'Full edition requires a verified purchase of this book.' },
          { status: 403 }
        );
      }

      if (!bookPaths.fullMarkdownStoragePath) {
        return NextResponse.json(
          { error: 'Full Markdown file is not available for this book.' },
          { status: 404 }
        );
      }

      targetUrl = resolveFirebaseStorageUrl(bookPaths.fullMarkdownStoragePath);
      if (!verifiedUser.isReviewerSession) {
        upstreamHeaders.Authorization = `Firebase ${token}`;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const upstream = await fetch(targetUrl, {
        headers: upstreamHeaders,
        signal: controller.signal,
        cache: mode === 'sample' ? 'force-cache' : 'no-store',
      });
      clearTimeout(timeout);

      if (!upstream.ok) {
        return NextResponse.json(
          { error: `Unable to load ${mode} Markdown (upstream HTTP ${upstream.status}).` },
          { status: upstream.status === 401 || upstream.status === 403 ? upstream.status : 502 }
        );
      }

      const markdown = await upstream.text();
      return NextResponse.json(
        {
          bookId: bookPaths.id,
          title: bookPaths.title,
          mode,
          markdown,
          assetBaseUrl: targetUrl,
        },
        {
          headers: {
            'Cache-Control':
              mode === 'sample' ? 'public, max-age=300' : 'private, no-store, max-age=0',
          },
        }
      );
    } catch (err) {
      clearTimeout(timeout);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Markdown request timed out.' },
        { status: 504 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected Markdown proxy error.' },
      { status: 500 }
    );
  }
}
