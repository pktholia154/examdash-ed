import { NextRequest, NextResponse } from 'next/server';
import { getRazorpayKeySecret, verifyEntitlementProof } from '@/core/payments/razorpay';
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

    const rangeHeader = req.headers.get('range');
    if (rangeHeader) {
      upstreamHeaders.Range = rangeHeader;
    }

    if (mode === 'sample') {
      if (!bookPaths.samplePdfUrl) {
        return NextResponse.json({ error: 'Sample PDF is not available for this book.' }, { status: 404 });
      }
      targetUrl = resolveFirebaseStorageUrl(bookPaths.samplePdfUrl);
    } else {
      // True server-side access enforcement for Full Paid PDF
      const keySecret = getRazorpayKeySecret();
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

      if (!bookPaths.fullPdfStoragePath) {
        return NextResponse.json({ error: 'Full PDF file is not available for this book.' }, { status: 404 });
      }

      targetUrl = resolveFirebaseStorageUrl(bookPaths.fullPdfStoragePath);
      const hasEmbeddedDownloadToken = /[?&]token=[^&]+/i.test(targetUrl);
      if (!hasEmbeddedDownloadToken) {
        upstreamHeaders.Authorization = `Firebase ${token}`;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      // Always use `cache: 'no-store'` on upstream binary fetch to avoid Next.js 2MB Data Cache
      // errors on large PDF files; HTTP Cache-Control headers handle browser & CDN edge caching.
      let upstream = await fetch(targetUrl, {
        headers: upstreamHeaders,
        signal: controller.signal,
        cache: 'no-store',
      });

      // Fallback retry without Firebase Authorization header if upstream already uses public/signed URL
      if ((upstream.status === 401 || upstream.status === 403) && upstreamHeaders.Authorization) {
        const retryHeaders = { ...upstreamHeaders };
        delete retryHeaders.Authorization;
        upstream = await fetch(targetUrl, {
          headers: retryHeaders,
          signal: controller.signal,
          cache: 'no-store',
        });
      }

      clearTimeout(timeout);

      if (!upstream.ok && upstream.status !== 206) {
        return NextResponse.json(
          { error: `Unable to stream ${mode} PDF (upstream HTTP ${upstream.status}).` },
          { status: upstream.status === 401 || upstream.status === 403 ? upstream.status : 502 }
        );
      }

      const resHeaders = new Headers();
      resHeaders.set('Content-Type', 'application/pdf');
      resHeaders.set('Accept-Ranges', 'bytes');
      const contentLength = upstream.headers.get('content-length');
      const contentRange = upstream.headers.get('content-range');
      if (contentLength) resHeaders.set('Content-Length', contentLength);
      if (contentRange) resHeaders.set('Content-Range', contentRange);
      resHeaders.set(
        'Cache-Control',
        mode === 'sample'
          ? 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
          : 'private, no-store, max-age=0'
      );

      return new NextResponse(upstream.body, {
        status: upstream.status,
        headers: resHeaders,
      });
    } catch (err) {
      clearTimeout(timeout);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'PDF fetch aborted.' },
        { status: 504 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected PDF proxy error.' },
      { status: 500 }
    );
  }
}
