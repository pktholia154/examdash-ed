'use client';

import {
  deleteDoc,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import { handleFirestoreError, OperationType } from '@/lib/firebase/errors';
import {
  makeProductKey,
  makeReviewDocId,
  REVIEW_LIMITS,
  ReviewSubmissionSchema,
  sanitizeReviewerDisplayName,
  type ProductReviewDTO,
  type ReviewSubmissionInput,
  type StarRatingValue,
} from '@/core/reviews/schema';
import type { ContentTypeKey } from '@/lib/design-system/tokens';

async function triggerServerReviewRevalidation(
  idToken: string,
  contentType: ContentTypeKey,
  urlSlug: string
): Promise<void> {
  try {
    await fetch('/api/reviews/revalidate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ contentType, urlSlug }),
      cache: 'no-store',
    });
  } catch {
    // Non-blocking background cache refresh; SSR ISR will also refresh within 60s
  }
}

async function checkRemoteVerifiedPurchase(
  uid: string,
  contentType: ContentTypeKey,
  itemId: string
): Promise<boolean> {
  const purchaseDocId = `${contentType}_${itemId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const purchaseRef = doc(db, 'users', uid, 'purchases', purchaseDocId);
  try {
    const snap = await getDoc(purchaseRef);
    return snap.exists();
  } catch {
    return false;
  }
}

/**
 * Submits a brand-new genuine user review or updates the authenticated user's existing review
 * at deterministic doc ID `/productReviews/${contentType}_${itemId}_${uid}`.
 */
export async function submitOrUpdateProductReview(params: {
  readonly contentType: ContentTypeKey;
  readonly itemId: string;
  readonly urlSlug: string;
  readonly input: ReviewSubmissionInput;
}): Promise<ProductReviewDTO> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    throw new Error('Please sign in with a verified Google account to submit a genuine review.');
  }

  const parsed = ReviewSubmissionSchema.safeParse({
    rating: params.input.rating,
    title: params.input.title.trim().slice(0, REVIEW_LIMITS.MAX_TITLE_LENGTH),
    body: params.input.body.trim().slice(0, REVIEW_LIMITS.MAX_BODY_LENGTH),
    authorName: sanitizeReviewerDisplayName(params.input.authorName),
  });

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? 'Please check your review inputs.';
    throw new Error(firstIssue);
  }

  const { rating, title, body, authorName } = parsed.data;
  const reviewId = makeReviewDocId(params.contentType, params.itemId, currentUser.uid);
  const productKey = makeProductKey(params.contentType, params.itemId);
  const reviewPath = `productReviews/${reviewId}`;
  const reviewRef = doc(db, 'productReviews', reviewId);

  const [existingSnap, verifiedPurchase] = await Promise.all([
    getDoc(reviewRef).catch((err) =>
      handleFirestoreError(err, OperationType.GET, reviewPath, currentUser)
    ),
    checkRemoteVerifiedPurchase(currentUser.uid, params.contentType, params.itemId),
  ]);

  const nowIso = new Date().toISOString();

  if (existingSnap.exists()) {
    const prev = existingSnap.data();
    try {
      await updateDoc(reviewRef, {
        rating,
        title,
        body,
        authorName,
        verifiedPurchase,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, reviewPath, currentUser);
    }

    const idToken = await currentUser.getIdToken();
    void triggerServerReviewRevalidation(idToken, params.contentType, params.urlSlug);

    const prevCreated =
      prev.createdAt && typeof prev.createdAt.toDate === 'function'
        ? prev.createdAt.toDate().toISOString()
        : nowIso;

    return {
      id: reviewId,
      uid: currentUser.uid,
      contentType: params.contentType,
      itemId: params.itemId,
      productKey,
      rating: rating as StarRatingValue,
      title,
      body,
      authorName,
      verifiedPurchase,
      helpfulCount: typeof prev.helpfulCount === 'number' ? prev.helpfulCount : 0,
      status: 'published',
      createdAt: prevCreated,
      updatedAt: nowIso,
    };
  }

  try {
    await setDoc(reviewRef, {
      id: reviewId,
      uid: currentUser.uid,
      contentType: params.contentType,
      itemId: params.itemId,
      productKey,
      rating,
      title,
      body,
      authorName,
      verifiedPurchase,
      helpfulCount: 0,
      status: 'published',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, reviewPath, currentUser);
  }

  const idToken = await currentUser.getIdToken();
  void triggerServerReviewRevalidation(idToken, params.contentType, params.urlSlug);

  return {
    id: reviewId,
    uid: currentUser.uid,
    contentType: params.contentType,
    itemId: params.itemId,
    productKey,
    rating: rating as StarRatingValue,
    title,
    body,
    authorName,
    verifiedPurchase,
    helpfulCount: 0,
    status: 'published',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * Permanently deletes the signed-in user's own review document.
 */
export async function deleteProductReview(params: {
  readonly contentType: ContentTypeKey;
  readonly itemId: string;
  readonly urlSlug: string;
}): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    throw new Error('Please sign in with a verified Google account to delete your review.');
  }

  const reviewId = makeReviewDocId(params.contentType, params.itemId, currentUser.uid);
  const reviewPath = `productReviews/${reviewId}`;

  try {
    await deleteDoc(doc(db, 'productReviews', reviewId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, reviewPath, currentUser);
  }

  const idToken = await currentUser.getIdToken();
  void triggerServerReviewRevalidation(idToken, params.contentType, params.urlSlug);

  return reviewId;
}

/**
 * Checks which of the given review IDs the currently authenticated user has marked as helpful.
 */
export async function fetchUserHelpfulVoteIds(
  reviewIds: readonly string[]
): Promise<ReadonlySet<string>> {
  const currentUser = auth.currentUser;
  if (!currentUser || reviewIds.length === 0) return new Set();

  const voted = new Set<string>();
  await Promise.allSettled(
    reviewIds.map(async (reviewId) => {
      const voteRef = doc(db, 'productReviews', reviewId, 'helpfulVotes', currentUser.uid);
      const snap = await getDoc(voteRef);
      if (snap.exists()) {
        voted.add(reviewId);
      }
    })
  );
  return voted;
}

/**
 * Atomically toggles a verified user's helpful vote on another user's review using a Firestore
 * WriteBatch (strictly paired with `existsAfter`/`getAfter` rules).
 */
export async function toggleReviewHelpfulVote(params: {
  readonly reviewId: string;
  readonly contentType: ContentTypeKey;
  readonly urlSlug: string;
  readonly currentlyVoted: boolean;
}): Promise<{ readonly voted: boolean; readonly delta: 1 | -1 }> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    throw new Error('Please sign in with a verified Google account to mark reviews as helpful.');
  }

  const reviewRef = doc(db, 'productReviews', params.reviewId);
  const voteRef = doc(db, 'productReviews', params.reviewId, 'helpfulVotes', currentUser.uid);
  const batchPath = `productReviews/${params.reviewId}/helpfulVotes/${currentUser.uid}`;

  const batch = writeBatch(db);
  if (params.currentlyVoted) {
    batch.delete(voteRef);
    batch.update(reviewRef, { helpfulCount: increment(-1) });
  } else {
    batch.set(voteRef, {
      uid: currentUser.uid,
      reviewId: params.reviewId,
      createdAt: serverTimestamp(),
    });
    batch.update(reviewRef, { helpfulCount: increment(1) });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, batchPath, currentUser);
  }

  const idToken = await currentUser.getIdToken();
  void triggerServerReviewRevalidation(idToken, params.contentType, params.urlSlug);

  return params.currentlyVoted ? { voted: false, delta: -1 } : { voted: true, delta: 1 };
}
