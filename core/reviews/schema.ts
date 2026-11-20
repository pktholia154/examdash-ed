import { z } from 'zod';
import type { ContentTypeKey } from '@/lib/design-system/tokens';

/**
 * Synchronized verbatim with `firebase-blueprint.json` ProductReview constraints.
 */
export const REVIEW_LIMITS = {
  MIN_RATING: 1,
  MAX_RATING: 5,
  MAX_TITLE_LENGTH: 120,
  MIN_BODY_LENGTH: 10,
  MAX_BODY_LENGTH: 2000,
  MIN_AUTHOR_NAME_LENGTH: 2,
  MAX_AUTHOR_NAME_LENGTH: 80,
  MAX_ID_LENGTH: 128,
} as const;

export type StarRatingValue = 1 | 2 | 3 | 4 | 5;
export type ReviewSortOption = 'recent' | 'helpful' | 'highest' | 'lowest';

export const ReviewContentTypeSchema = z.enum(['books', 'exams', 'quizbooks']);

export const ReviewSubmissionSchema = z.object({
  rating: z
    .number()
    .int('Please select a whole star rating from 1 to 5.')
    .min(REVIEW_LIMITS.MIN_RATING, 'Please select a star rating from 1 to 5.')
    .max(REVIEW_LIMITS.MAX_RATING, 'Rating cannot exceed 5 stars.'),
  title: z
    .string()
    .trim()
    .max(
      REVIEW_LIMITS.MAX_TITLE_LENGTH,
      `Headline must be ${REVIEW_LIMITS.MAX_TITLE_LENGTH} characters or fewer.`
    ),
  body: z
    .string()
    .trim()
    .min(
      REVIEW_LIMITS.MIN_BODY_LENGTH,
      `Please share at least ${REVIEW_LIMITS.MIN_BODY_LENGTH} characters about your experience.`
    )
    .max(
      REVIEW_LIMITS.MAX_BODY_LENGTH,
      `Review must be ${REVIEW_LIMITS.MAX_BODY_LENGTH} characters or fewer.`
    ),
  authorName: z
    .string()
    .trim()
    .min(
      REVIEW_LIMITS.MIN_AUTHOR_NAME_LENGTH,
      `Display name must be at least ${REVIEW_LIMITS.MIN_AUTHOR_NAME_LENGTH} characters.`
    )
    .max(
      REVIEW_LIMITS.MAX_AUTHOR_NAME_LENGTH,
      `Display name must be ${REVIEW_LIMITS.MAX_AUTHOR_NAME_LENGTH} characters or fewer.`
    ),
});

export type ReviewSubmissionInput = z.infer<typeof ReviewSubmissionSchema>;

export interface ProductReviewDTO {
  readonly id: string;
  readonly uid: string;
  readonly contentType: ContentTypeKey;
  readonly itemId: string;
  readonly productKey: string;
  readonly rating: StarRatingValue;
  readonly title: string;
  readonly body: string;
  readonly authorName: string;
  readonly verifiedPurchase: boolean;
  readonly helpfulCount: number;
  readonly status: 'published';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProductRatingSummary {
  readonly contentType: ContentTypeKey;
  readonly itemId: string;
  readonly ratingValue: number;
  readonly ratingCount: number;
  readonly reviewCount: number;
  readonly verifiedCount: number;
  readonly distribution: Readonly<Record<StarRatingValue, number>>;
}

export function makeProductKey(contentType: ContentTypeKey, itemId: string): string {
  return `${contentType}:${itemId.trim()}`;
}

export function makeReviewDocId(
  contentType: ContentTypeKey,
  itemId: string,
  uid: string
): string {
  const cleanItem = itemId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanUid = uid.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${contentType}_${cleanItem}_${cleanUid}`.slice(0, REVIEW_LIMITS.MAX_ID_LENGTH);
}

/**
 * Sanitizes public reviewer display name and strictly strips any email addresses
 * so PII never leaks into public Firestore review documents or Schema.org markup.
 */
export function sanitizeReviewerDisplayName(
  displayName?: string | null,
  fallback = 'Verified Learner'
): string {
  const raw = (displayName ?? '').trim().replace(/\s+/g, ' ');
  if (!raw || raw.includes('@')) {
    return fallback;
  }
  const cleaned = raw.replace(/[<>]/g, '').trim();
  if (cleaned.length < REVIEW_LIMITS.MIN_AUTHOR_NAME_LENGTH) {
    return fallback;
  }
  return cleaned.slice(0, REVIEW_LIMITS.MAX_AUTHOR_NAME_LENGTH);
}

export function clampStarRating(value: number): StarRatingValue | null {
  if (!Number.isInteger(value) || value < 1 || value > 5) return null;
  return value as StarRatingValue;
}

/**
 * Computes exact, strictly genuine rating aggregate statistics from published user reviews.
 * Returns `ratingCount: 0` and `ratingValue: 0` when no real reviews exist — never fabricates defaults.
 */
export function computeProductRatingSummary(
  contentType: ContentTypeKey,
  itemId: string,
  reviews: readonly ProductReviewDTO[]
): ProductRatingSummary {
  const distribution: Record<StarRatingValue, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };

  let sum = 0;
  let count = 0;
  let verifiedCount = 0;

  for (const review of reviews) {
    if (review.status !== 'published') continue;
    const star = clampStarRating(review.rating);
    if (!star) continue;
    distribution[star] += 1;
    sum += star;
    count += 1;
    if (review.verifiedPurchase) {
      verifiedCount += 1;
    }
  }

  const ratingValue = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;

  return {
    contentType,
    itemId,
    ratingValue,
    ratingCount: count,
    reviewCount: count,
    verifiedCount,
    distribution,
  };
}

export function sortAndFilterReviews(
  reviews: readonly ProductReviewDTO[],
  options: {
    readonly sortBy: ReviewSortOption;
    readonly starFilter?: StarRatingValue | null;
    readonly verifiedOnly?: boolean;
  }
): ProductReviewDTO[] {
  const filtered = reviews.filter((r) => {
    if (r.status !== 'published') return false;
    if (options.starFilter && r.rating !== options.starFilter) return false;
    if (options.verifiedOnly && !r.verifiedPurchase) return false;
    return true;
  });

  return [...filtered].sort((a, b) => {
    if (options.sortBy === 'helpful') {
      if (b.helpfulCount !== a.helpfulCount) return b.helpfulCount - a.helpfulCount;
      return b.createdAt.localeCompare(a.createdAt);
    }
    if (options.sortBy === 'highest') {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return b.createdAt.localeCompare(a.createdAt);
    }
    if (options.sortBy === 'lowest') {
      if (a.rating !== b.rating) return a.rating - b.rating;
      return b.createdAt.localeCompare(a.createdAt);
    }
    // Default: most recent
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export const RATING_LABELS: Readonly<Record<StarRatingValue, string>> = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Very Good',
  5: 'Excellent',
};
