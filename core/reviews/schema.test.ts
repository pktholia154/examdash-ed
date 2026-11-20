import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProductRatingSummary,
  makeProductKey,
  makeReviewDocId,
  ReviewSubmissionSchema,
  sanitizeReviewerDisplayName,
  sortAndFilterReviews,
  type ProductReviewDTO,
} from './schema';

const makeSampleReview = (overrides: Partial<ProductReviewDTO> = {}): ProductReviewDTO => ({
  id: 'books_B1_user1',
  uid: 'user1',
  contentType: 'books',
  itemId: 'B1',
  productKey: 'books:B1',
  rating: 5,
  title: 'Clear explanations',
  body: 'Very helpful MCQ explanations with chronological coverage of Modern History.',
  authorName: 'Aarav Sharma',
  verifiedPurchase: true,
  helpfulCount: 3,
  status: 'published',
  createdAt: '2026-11-18T10:00:00.000Z',
  updatedAt: '2026-11-18T10:00:00.000Z',
  ...overrides,
});

test('ReviewSubmissionSchema enforces blueprint boundaries and rejects invalid ratings/lengths', () => {
  const valid = ReviewSubmissionSchema.safeParse({
    rating: 4,
    title: 'Useful for revision',
    body: 'Well-structured question bank for quick exam revision.',
    authorName: 'Neha Verma',
  });
  assert.equal(valid.success, true);

  assert.equal(
    ReviewSubmissionSchema.safeParse({
      rating: 0,
      title: '',
      body: 'Long enough body text for validation.',
      authorName: 'Neha',
    }).success,
    false
  );

  assert.equal(
    ReviewSubmissionSchema.safeParse({
      rating: 6,
      title: '',
      body: 'Long enough body text for validation.',
      authorName: 'Neha',
    }).success,
    false
  );

  assert.equal(
    ReviewSubmissionSchema.safeParse({
      rating: 4.5,
      title: '',
      body: 'Long enough body text for validation.',
      authorName: 'Neha',
    }).success,
    false
  );

  assert.equal(
    ReviewSubmissionSchema.safeParse({
      rating: 5,
      title: '',
      body: 'Too short',
      authorName: 'Neha',
    }).success,
    false
  );

  assert.equal(
    ReviewSubmissionSchema.safeParse({
      rating: 5,
      title: 'A'.repeat(121),
      body: 'Long enough body text for validation.',
      authorName: 'Neha',
    }).success,
    false
  );
});

test('makeReviewDocId and makeProductKey produce deterministic Firestore-safe keys', () => {
  assert.equal(makeProductKey('books', 'B1'), 'books:B1');
  assert.equal(makeReviewDocId('books', 'B1', 'uid_123'), 'books_B1_uid_123');
  assert.match(makeReviewDocId('exams', 'E1', 'abc-XYZ_9'), /^[a-zA-Z0-9_-]{1,128}$/);
});

test('sanitizeReviewerDisplayName strips email addresses and angle brackets to prevent PII leaks', () => {
  assert.equal(sanitizeReviewerDisplayName('user@example.com'), 'Verified Learner');
  assert.equal(sanitizeReviewerDisplayName('  Rohan   Mehta  '), 'Rohan Mehta');
  assert.equal(sanitizeReviewerDisplayName('<b>Priya</b>'), 'bPriya/b');
  assert.equal(sanitizeReviewerDisplayName(''), 'Verified Learner');
});

test('computeProductRatingSummary returns 0 counts when empty and exact averages when genuine reviews exist', () => {
  const empty = computeProductRatingSummary('books', 'B1', []);
  assert.equal(empty.ratingCount, 0);
  assert.equal(empty.reviewCount, 0);
  assert.equal(empty.ratingValue, 0);
  assert.equal(empty.verifiedCount, 0);

  const reviews: ProductReviewDTO[] = [
    makeSampleReview({ id: 'books_B1_u1', uid: 'u1', rating: 5, verifiedPurchase: true }),
    makeSampleReview({ id: 'books_B1_u2', uid: 'u2', rating: 4, verifiedPurchase: false }),
    makeSampleReview({ id: 'books_B1_u3', uid: 'u3', rating: 5, verifiedPurchase: true }),
  ];

  const summary = computeProductRatingSummary('books', 'B1', reviews);
  assert.equal(summary.ratingCount, 3);
  assert.equal(summary.reviewCount, 3);
  assert.equal(summary.ratingValue, 4.7);
  assert.equal(summary.verifiedCount, 2);
  assert.deepEqual(summary.distribution, { 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 });
});

test('sortAndFilterReviews supports sorting, star filter, and verified-only filter', () => {
  const reviews: ProductReviewDTO[] = [
    makeSampleReview({
      id: 'books_B1_u1',
      rating: 3,
      helpfulCount: 10,
      verifiedPurchase: false,
      createdAt: '2026-11-10T10:00:00.000Z',
    }),
    makeSampleReview({
      id: 'books_B1_u2',
      rating: 5,
      helpfulCount: 2,
      verifiedPurchase: true,
      createdAt: '2026-11-19T10:00:00.000Z',
    }),
    makeSampleReview({
      id: 'books_B1_u3',
      rating: 4,
      helpfulCount: 5,
      verifiedPurchase: true,
      createdAt: '2026-11-15T10:00:00.000Z',
    }),
  ];

  assert.deepEqual(
    sortAndFilterReviews(reviews, { sortBy: 'recent' }).map((r) => r.id),
    ['books_B1_u2', 'books_B1_u3', 'books_B1_u1']
  );
  assert.deepEqual(
    sortAndFilterReviews(reviews, { sortBy: 'helpful' }).map((r) => r.id),
    ['books_B1_u1', 'books_B1_u3', 'books_B1_u2']
  );
  assert.deepEqual(
    sortAndFilterReviews(reviews, { sortBy: 'highest' }).map((r) => r.id),
    ['books_B1_u2', 'books_B1_u3', 'books_B1_u1']
  );
  assert.deepEqual(
    sortAndFilterReviews(reviews, { sortBy: 'lowest' }).map((r) => r.id),
    ['books_B1_u1', 'books_B1_u3', 'books_B1_u2']
  );
  assert.deepEqual(
    sortAndFilterReviews(reviews, { sortBy: 'recent', starFilter: 4 }).map((r) => r.id),
    ['books_B1_u3']
  );
  assert.deepEqual(
    sortAndFilterReviews(reviews, { sortBy: 'recent', verifiedOnly: true }).map((r) => r.id),
    ['books_B1_u2', 'books_B1_u3']
  );
});
