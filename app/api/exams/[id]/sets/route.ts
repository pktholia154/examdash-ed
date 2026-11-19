import { NextRequest, NextResponse } from 'next/server';
import { verifyEntitlementProof } from '@/core/payments/razorpay';
import {
  CANONICAL_SAMPLE_EXAM_SET,
  normalizeExamSetsPayload,
  type NormalizedExamSet,
} from '@/core/exam/schema';
import {
  extractBearerToken,
  fetchServerExamFilePaths,
  resolveFirebaseStorageUrl,
  verifyFirebaseIdToken,
} from '@/lib/firebase/server-auth';

export const runtime = 'nodejs';

async function fetchJsonFromStorage(
  storagePathOrUrl: string,
  firebaseToken?: string | null,
  cacheMode: RequestCache = 'no-store'
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; message: string }> {
  const targetUrl = resolveFirebaseStorageUrl(storagePathOrUrl);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (firebaseToken) {
    headers.Authorization = `Firebase ${firebaseToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const upstream = await fetch(targetUrl, {
      headers,
      signal: controller.signal,
      cache: cacheMode,
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      return {
        ok: false,
        status: upstream.status,
        message: `Upstream storage HTTP ${upstream.status}`,
      };
    }

    const raw = await upstream.json();
    return { ok: true, data: raw };
  } catch (error) {
    clearTimeout(timeout);
    return {
      ok: false,
      status: 504,
      message: error instanceof Error ? error.message : 'Storage request timed out.',
    };
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const mode = req.nextUrl.searchParams.get('mode') === 'full' ? 'full' : 'sample';

    const examPaths = await fetchServerExamFilePaths(id);
    if (!examPaths) {
      return NextResponse.json({ error: 'Exam pack not found.' }, { status: 404 });
    }

    const token = extractBearerToken(req);

    if (mode === 'sample') {
      // Try loading real sampleJsonStoragePath from Firebase Storage first (with user token if signed in)
      if (examPaths.sampleJsonStoragePath) {
        const result = await fetchJsonFromStorage(
          examPaths.sampleJsonStoragePath,
          token,
          token ? 'no-store' : 'force-cache'
        );
        if (result.ok) {
          const parsedSets = normalizeExamSetsPayload(result.data);
          if (parsedSets.length > 0) {
            return NextResponse.json(
              {
                examPackId: examPaths.id,
                title: examPaths.title,
                mode: 'sample',
                source: 'firebase-storage',
                sets: [parsedSets[0]],
              },
              {
                headers: {
                  'Cache-Control': token ? 'private, no-store' : 'public, max-age=300',
                },
              }
            );
          }
        }
      }

      // Resilient public sample preview fallback (Pillar 2 canonical multi-pattern set)
      // when Firebase Storage blocks anonymous access on sampleJsonStoragePath
      const fallbackSet: NormalizedExamSet = {
        ...CANONICAL_SAMPLE_EXAM_SET,
        title: examPaths.firstMockTitle || CANONICAL_SAMPLE_EXAM_SET.title,
      };

      return NextResponse.json(
        {
          examPackId: examPaths.id,
          title: examPaths.title,
          mode: 'sample',
          source: 'canonical-sample',
          storageNotice: examPaths.sampleJsonStoragePath
            ? 'Loaded interactive multi-pattern sample preview (sign in to load private Firebase Storage sample if restricted).'
            : null,
          sets: [fallbackSet],
        },
        {
          headers: {
            'Cache-Control': 'private, no-store',
          },
        }
      );
    }

    // --- FULL PAID MULTI-SET JSON ACCESS (STRICT SERVER ENFORCEMENT) ---
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? '';
    const entitlementProof = req.headers.get('x-entitlement-proof')?.trim() ?? '';

    if (!token) {
      return NextResponse.json(
        { error: 'Sign in with Google to access your purchased exam sets.' },
        { status: 401 }
      );
    }

    const verifiedUser = await verifyFirebaseIdToken(token);
    if (!verifiedUser) {
      return NextResponse.json(
        { error: 'Your Google session expired. Please sign in again.' },
        { status: 401 }
      );
    }

    const proofCheck = verifyEntitlementProof(
      entitlementProof,
      { uid: verifiedUser.uid, itemId: examPaths.id, contentType: 'exams' },
      keySecret
    );
    if (!proofCheck.valid) {
      return NextResponse.json(
        { error: 'Full mock test sets require a verified purchase of this exam pack.' },
        { status: 403 }
      );
    }

    if (!examPaths.fullJsonStoragePath) {
      return NextResponse.json(
        { error: 'Full exam pack JSON is not configured for this pack yet.' },
        { status: 404 }
      );
    }

    const fullResult = await fetchJsonFromStorage(examPaths.fullJsonStoragePath, token, 'no-store');
    if (!fullResult.ok) {
      return NextResponse.json(
        {
          error: `Unable to load full exam sets (${fullResult.message}).`,
        },
        { status: fullResult.status === 401 || fullResult.status === 403 ? fullResult.status : 502 }
      );
    }

    const sets = normalizeExamSetsPayload(fullResult.data);
    if (sets.length === 0) {
      return NextResponse.json(
        { error: 'Full exam JSON file did not contain any valid exam sets.' },
        { status: 422 }
      );
    }

    return NextResponse.json(
      {
        examPackId: examPaths.id,
        title: examPaths.title,
        mode: 'full',
        source: 'firebase-storage',
        sets,
      },
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected exam sets proxy error.' },
      { status: 500 }
    );
  }
}
