import { FIREBASE_CONFIG, FIRESTORE_DATABASE_ID } from './config';
import { decodeFirestoreValue } from './server-catalog';
import {
  clampStarRating,
  computeProductRatingSummary,
  makeProductKey,
  REVIEW_LIMITS,
  sanitizeReviewerDisplayName,
  type ProductRatingSummary,
  type ProductReviewDTO,
} from '@/core/reviews/schema';
import type { ContentTypeKey } from '@/lib/design-system/tokens';

interface FirestoreValue {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  nullValue?: null;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

interface FirestoreRunQueryRow {
  document?: {
    name?: string;
    fields?: Record<string, FirestoreValue>;
  };
}

function asString(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

function asNumber(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asContentType(val: unknown): ContentTypeKey | null {
  if (val === 'books' || val === 'exams' || val === 'quizbooks') return val;
  return null;
}

function projectPublishedReview(
  docId: string,
  fields: Record<string, FirestoreValue>
): ProductReviewDTO | null {
  const status = asString(decodeFirestoreValue(fields.status));
  if (status !== 'published') return null;

  const contentType = asContentType(decodeFirestoreValue(fields.contentType));
  const itemId = asString(decodeFirestoreValue(fields.itemId)).trim();
  const uid = asString(decodeFirestoreValue(fields.uid)).trim();
  const rawRating = Math.round(asNumber(decodeFirestoreValue(fields.rating), 0));
  const rating = clampStarRating(rawRating);
  const body = asString(decodeFirestoreValue(fields.body)).trim();

  if (!contentType || !itemId || !uid || !rating || body.length < REVIEW_LIMITS.MIN_BODY_LENGTH) {
    return null;
  }

  const createdAt =
    asString(decodeFirestoreValue(fields.createdAt)).trim() || new Date(0).toISOString();
  const updatedAt = asString(decodeFirestoreValue(fields.updatedAt)).trim() || createdAt;
  const title = asString(decodeFirestoreValue(fields.title))
    .trim()
    .slice(0, REVIEW_LIMITS.MAX_TITLE_LENGTH);
  const authorName = sanitizeReviewerDisplayName(
    asString(decodeFirestoreValue(fields.authorName)),
    'Verified Learner'
  );
  const verifiedPurchase = decodeFirestoreValue(fields.verifiedPurchase) === true;
  const helpfulCount = Math.max(0, Math.floor(asNumber(decodeFirestoreValue(fields.helpfulCount), 0)));

  return {
    id: asString(decodeFirestoreValue(fields.id), docId) || docId,
    uid,
    contentType,
    itemId,
    productKey: makeProductKey(contentType, itemId),
    rating,
    title,
    body: body.slice(0, REVIEW_LIMITS.MAX_BODY_LENGTH),
    authorName,
    verifiedPurchase,
    helpfulCount,
    status: 'published',
    createdAt,
    updatedAt,
  };
}

/**
 * Queries genuine published reviews via Firestore REST `:runQuery` using a single-field
 * equality filter (`status == 'published'`) — requires zero composite indexes and returns
 * an empty array when no genuine user reviews exist (never returns mock or demo data).
 */
export async function fetchAllPublishedReviews(): Promise<ProductReviewDTO[]> {
  const encodedDb = encodeURIComponent(FIRESTORE_DATABASE_ID);
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/${encodedDb}/documents:runQuery?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'productReviews' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'status' },
              op: 'EQUAL',
              value: { stringValue: 'published' },
            },
          },
          limit: 500,
        },
      }),
      next: { revalidate: 60, tags: ['catalog-reviews'] },
    });

    if (!response.ok) {
      return [];
    }

    const rows = (await response.json()) as FirestoreRunQueryRow[];
    if (!Array.isArray(rows)) return [];

    const reviews: ProductReviewDTO[] = [];
    for (const row of rows) {
      if (!row.document?.fields || !row.document.name) continue;
      const docId = row.document.name.split('/').pop() ?? '';
      const projected = projectPublishedReview(docId, row.document.fields);
      if (projected) reviews.push(projected);
    }

    return reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function fetchProductReviewsAndSummary(
  contentType: ContentTypeKey,
  itemId: string
): Promise<{
  readonly reviews: ProductReviewDTO[];
  readonly summary: ProductRatingSummary;
}> {
  const allReviews = await fetchAllPublishedReviews();
  const targetKey = makeProductKey(contentType, itemId);
  const productReviews = allReviews.filter((r) => r.productKey === targetKey);
  const summary = computeProductRatingSummary(contentType, itemId, productReviews);
  return { reviews: productReviews, summary };
}

export async function fetchCatalogRatingSummaries(): Promise<
  Readonly<Record<string, ProductRatingSummary>>
> {
  const allReviews = await fetchAllPublishedReviews();
  if (allReviews.length === 0) return {};

  const grouped = new Map<string, ProductReviewDTO[]>();
  for (const review of allReviews) {
    const list = grouped.get(review.productKey);
    if (list) {
      list.push(review);
    } else {
      grouped.set(review.productKey, [review]);
    }
  }

  const summaries: Record<string, ProductRatingSummary> = {};
  for (const [key, list] of grouped.entries()) {
    const first = list[0];
    if (!first) continue;
    summaries[key] = computeProductRatingSummary(first.contentType, first.itemId, list);
  }
  return summaries;
}
