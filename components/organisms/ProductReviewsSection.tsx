'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Edit3,
  LogIn,
  MessageSquareText,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { useAppSession } from '@/components/providers/AppSessionProvider';
import { StarRatingDisplay } from '@/components/atoms/StarRatingDisplay';
import { StarRatingInput } from '@/components/molecules/StarRatingInput';
import {
  computeProductRatingSummary,
  REVIEW_LIMITS,
  ReviewSubmissionSchema,
  sanitizeReviewerDisplayName,
  sortAndFilterReviews,
  type ProductRatingSummary,
  type ProductReviewDTO,
  type ReviewSortOption,
  type StarRatingValue,
} from '@/core/reviews/schema';
import type { ContentTypeKey } from '@/lib/design-system/tokens';

export interface ProductReviewsSectionProps {
  readonly contentType: ContentTypeKey;
  readonly itemId: string;
  readonly itemTitle: string;
  readonly urlSlug: string;
  readonly initialReviews: readonly ProductReviewDTO[];
  readonly initialSummary: ProductRatingSummary;
}

const STAR_ROWS: readonly StarRatingValue[] = [5, 4, 3, 2, 1];

const SORT_OPTIONS: ReadonlyArray<{ readonly id: ReviewSortOption; readonly label: string }> = [
  { id: 'recent', label: 'Most Recent' },
  { id: 'helpful', label: 'Most Helpful' },
  { id: 'highest', label: 'Highest Rated' },
  { id: 'lowest', label: 'Lowest Rated' },
];

function formatReviewDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

/**
 * Genuine-Only Product Ratings & Reviews Section.
 *
 * - Renders server-fetched genuine reviews directly in SSR HTML (1:1 parity with JSON-LD).
 * - Never fabricates, mocks, or seeds placeholder reviews or ratings.
 * - Dynamically imports Firestore review mutation code only when a signed-in user interacts.
 */
export function ProductReviewsSection({
  contentType,
  itemId,
  itemTitle,
  urlSlug,
  initialReviews,
}: ProductReviewsSectionProps) {
  const { user, authBusy, signIn, isPurchased } = useAppSession();

  const [reviews, setReviews] = useState<ProductReviewDTO[]>(() => [...initialReviews]);
  const [sortBy, setSortBy] = useState<ReviewSortOption>('recent');
  const [starFilter, setStarFilter] = useState<StarRatingValue | null>(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const [composerOpen, setComposerOpen] = useState(false);
  const [rating, setRating] = useState<StarRatingValue | 0>(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [votedState, setVotedState] = useState<{
    uid: string | null;
    ids: ReadonlySet<string>;
  }>(() => ({ uid: null, ids: new Set() }));
  const [voteBusyId, setVoteBusyId] = useState<string | null>(null);

  const isFirebaseGoogleUser = Boolean(user);
  const userOwnsProduct = isPurchased(contentType, itemId);
  const currentUid = user ? user.uid : null;

  const votedIds: ReadonlySet<string> = useMemo(
    () => (currentUid && votedState.uid === currentUid ? votedState.ids : new Set()),
    [currentUid, votedState]
  );

  const summary = useMemo(
    () => computeProductRatingSummary(contentType, itemId, reviews),
    [contentType, itemId, reviews]
  );

  const ownReview = useMemo(
    () => (user ? reviews.find((r) => r.uid === user.uid) ?? null : null),
    [reviews, user]
  );

  const visibleReviews = useMemo(
    () =>
      sortAndFilterReviews(reviews, {
        sortBy,
        starFilter,
        verifiedOnly,
      }),
    [reviews, sortBy, starFilter, verifiedOnly]
  );

  const targetReviewIdsKey = useMemo(
    () =>
      currentUid
        ? reviews
            .filter((r) => r.uid !== currentUid)
            .map((r) => r.id)
            .join(',')
        : '',
    [currentUid, reviews]
  );

  // Hydrate helpful votes only for signed-in Google users when reviews exist
  useEffect(() => {
    if (!currentUid || !targetReviewIdsKey) {
      return;
    }

    let active = true;
    const targetIds = targetReviewIdsKey.split(',').filter(Boolean);

    void import('@/lib/firebase/reviews-client')
      .then((mod) => mod.fetchUserHelpfulVoteIds(targetIds))
      .then((ids) => {
        if (active) {
          setVotedState({ uid: currentUid, ids });
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [currentUid, targetReviewIdsKey]);

  function openComposer(prefill?: ProductReviewDTO | null) {
    setFormError(null);
    setStatusNotice(null);
    setConfirmDeleteOpen(false);
    if (prefill) {
      setRating(prefill.rating);
      setTitle(prefill.title);
      setBody(prefill.body);
      setAuthorName(prefill.authorName);
    } else {
      setRating(0);
      setTitle('');
      setBody('');
      setAuthorName(sanitizeReviewerDisplayName(user?.displayName, ''));
    }
    setComposerOpen(true);
  }

  async function handleStartReviewClick() {
    setFormError(null);
    setStatusNotice(null);

    if (!user) {
      const signedIn = await signIn();
      if (!signedIn) return;
      setAuthorName(sanitizeReviewerDisplayName(signedIn.displayName, ''));
      setComposerOpen(true);
      return;
    }

    openComposer(ownReview);
  }

  async function handleSubmitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setStatusNotice(null);

    if (!isFirebaseGoogleUser) {
      setFormError('Please sign in with a verified Google account to publish a genuine review.');
      return;
    }

    const validation = ReviewSubmissionSchema.safeParse({
      rating,
      title,
      body,
      authorName: authorName.trim() || sanitizeReviewerDisplayName(user?.displayName),
    });

    if (!validation.success) {
      setFormError(validation.error.issues[0]?.message ?? 'Please check your review inputs.');
      return;
    }

    setSubmitBusy(true);
    try {
      const mod = await import('@/lib/firebase/reviews-client');
      const saved = await mod.submitOrUpdateProductReview({
        contentType,
        itemId,
        urlSlug,
        input: validation.data,
      });

      setReviews((prev) => {
        const filtered = prev.filter((r) => r.id !== saved.id);
        return [saved, ...filtered];
      });
      setComposerOpen(false);
      setStatusNotice(
        ownReview
          ? 'Your review has been updated.'
          : 'Thank you — your genuine review has been published.'
      );
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Unable to save your review right now.';
      if (rawMsg.includes('Missing or insufficient permissions')) {
        setFormError(
          'Unable to save review due to database permissions. Please ensure your Google account email is verified and try again.'
        );
      } else {
        setFormError(rawMsg);
      }
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleDeleteOwnReview() {
    if (!isFirebaseGoogleUser || !ownReview) return;
    setDeleteBusy(true);
    setFormError(null);
    setStatusNotice(null);
    try {
      const mod = await import('@/lib/firebase/reviews-client');
      const deletedId = await mod.deleteProductReview({
        contentType,
        itemId,
        urlSlug,
      });
      setReviews((prev) => prev.filter((r) => r.id !== deletedId));
      setConfirmDeleteOpen(false);
      setComposerOpen(false);
      setStatusNotice('Your review has been removed.');
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Unable to delete your review.';
      setFormError(
        rawMsg.includes('Missing or insufficient permissions')
          ? 'Unable to delete review due to database permissions.'
          : rawMsg
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleToggleHelpful(review: ProductReviewDTO) {
    setFormError(null);
    if (!user) {
      await signIn();
      return;
    }
    if (!isFirebaseGoogleUser || review.uid === user.uid) return;

    const currentlyVoted = votedIds.has(review.id);
    setVoteBusyId(review.id);
    try {
      const mod = await import('@/lib/firebase/reviews-client');
      const result = await mod.toggleReviewHelpfulVote({
        reviewId: review.id,
        contentType,
        urlSlug,
        currentlyVoted,
      });

      setVotedState((prev) => {
        const base = prev.uid === currentUid ? prev.ids : new Set<string>();
        const next = new Set(base);
        if (result.voted) {
          next.add(review.id);
        } else {
          next.delete(review.id);
        }
        return { uid: currentUid, ids: next };
      });
      setReviews((prev) =>
        prev.map((item) =>
          item.id === review.id
            ? { ...item, helpfulCount: Math.max(0, item.helpfulCount + result.delta) }
            : item
        )
      );
    } catch {
      setFormError('Could not update helpful vote right now. Please try again.');
    } finally {
      setVoteBusyId(null);
    }
  }

  const productNoun = contentType === 'exams' ? 'exam pack' : 'book';

  return (
    <section
      id="reviews"
      aria-labelledby="product-reviews-heading"
      className="scroll-mt-24 space-y-6 border-t border-[var(--border-subtle)] pt-8"
    >
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2
            id="product-reviews-heading"
            className="text-lg font-bold text-[var(--text-primary)]"
          >
            Ratings &amp; Reviews
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            100% genuine reviews submitted by verified ExamDash learners.
          </p>
        </div>

        {(summary.ratingCount > 0 || composerOpen) && (
          <button
            type="button"
            disabled={authBusy}
            onClick={() => void handleStartReviewClick()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[var(--brand-ink)] bg-[var(--brand-ink)] px-4 text-xs font-semibold text-white transition-colors hover:bg-[var(--brand-ink-hover)] disabled:opacity-50"
          >
            {user ? (
              <>
                <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{ownReview ? 'Edit Your Review' : 'Write a Review'}</span>
              </>
            ) : (
              <>
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign in to Review</span>
              </>
            )}
          </button>
        )}
      </div>

      {statusNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-hover)] px-4 py-3 text-xs font-medium text-[var(--text-primary)]"
        >
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            aria-label="Dismiss notice"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {formError && !composerOpen && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700"
        >
          {formError}
        </p>
      )}

      {/* Interactive Review Composer */}
      {composerOpen && isFirebaseGoogleUser && (
        <form
          onSubmit={(e) => void handleSubmitReview(e)}
          className="space-y-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-canvas)] p-5"
          aria-label={ownReview ? 'Edit your review' : 'Write a review'}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                {ownReview ? `Update your review for ${itemTitle}` : `Review ${itemTitle}`}
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                {userOwnsProduct ? (
                  <span className="inline-flex items-center gap-1 font-medium text-[var(--text-primary)]">
                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Verified Purchase — your review will carry a Verified Purchase mark.
                  </span>
                ) : (
                  'Share honest feedback from your sample preview or study experience.'
                )}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setComposerOpen(false);
                setFormError(null);
              }}
              aria-label="Close review form"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="review-star-rating"
              className="block text-xs font-semibold text-[var(--text-primary)]"
            >
              Overall Rating <span className="text-[var(--text-muted)]">(required)</span>
            </label>
            <StarRatingInput value={rating} onChange={setRating} disabled={submitBusy} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="review-author-name"
                className="block text-xs font-semibold text-[var(--text-primary)]"
              >
                Public Display Name
              </label>
              <input
                id="review-author-name"
                type="text"
                required
                minLength={REVIEW_LIMITS.MIN_AUTHOR_NAME_LENGTH}
                maxLength={REVIEW_LIMITS.MAX_AUTHOR_NAME_LENGTH}
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="Your name (email is never shown)"
                disabled={submitBusy}
                className="h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-ink)] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="review-headline"
                className="block text-xs font-semibold text-[var(--text-primary)]"
              >
                Review Headline <span className="font-normal text-[var(--text-muted)]">(optional)</span>
              </label>
              <input
                id="review-headline"
                type="text"
                maxLength={REVIEW_LIMITS.MAX_TITLE_LENGTH}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Summarize your experience"
                disabled={submitBusy}
                className="h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-ink)] focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label
                htmlFor="review-body"
                className="block text-xs font-semibold text-[var(--text-primary)]"
              >
                Your Review <span className="text-[var(--text-muted)]">(min 10 characters)</span>
              </label>
              <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                {body.trim().length} / {REVIEW_LIMITS.MAX_BODY_LENGTH}
              </span>
            </div>
            <textarea
              id="review-body"
              required
              rows={4}
              minLength={REVIEW_LIMITS.MIN_BODY_LENGTH}
              maxLength={REVIEW_LIMITS.MAX_BODY_LENGTH}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={`What stood out about this ${productNoun}? Mention question quality, clarity, syllabus coverage, or difficulty level.`}
              disabled={submitBusy}
              className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] p-3 text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-ink)] focus:outline-none"
            />
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
            >
              {formError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={submitBusy}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--brand-ink)] px-5 text-xs font-semibold text-white transition-colors hover:bg-[var(--brand-ink-hover)] disabled:opacity-50"
              >
                {submitBusy
                  ? 'Publishing...'
                  : ownReview
                    ? 'Save Updated Review'
                    : 'Publish Genuine Review'}
              </button>

              <button
                type="button"
                disabled={submitBusy}
                onClick={() => {
                  setComposerOpen(false);
                  setFormError(null);
                }}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-[var(--border-strong)] px-4 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
              >
                Cancel
              </button>
            </div>

            {ownReview && (
              <div>
                {!confirmDeleteOpen ? (
                  <button
                    type="button"
                    disabled={submitBusy || deleteBusy}
                    onClick={() => setConfirmDeleteOpen(true)}
                    className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-red-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Delete review</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">Confirm delete?</span>
                    <button
                      type="button"
                      disabled={deleteBusy}
                      onClick={() => void handleDeleteOwnReview()}
                      className="inline-flex h-9 items-center rounded-md bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      {deleteBusy ? 'Deleting...' : 'Yes, Delete'}
                    </button>
                    <button
                      type="button"
                      disabled={deleteBusy}
                      onClick={() => setConfirmDeleteOpen(false)}
                      className="inline-flex h-9 items-center rounded-md border border-[var(--border-strong)] px-3 text-xs font-medium text-[var(--text-primary)]"
                    >
                      Keep
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </form>
      )}

      {/* Honest Empty State when 0 genuine reviews exist */}
      {summary.ratingCount === 0 ? (
        <div
          data-testid="reviews-empty-state"
          className="flex flex-col items-start justify-between gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-6 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)]">
              <MessageSquareText className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                No learner reviews yet
              </p>
              <p className="max-w-xl text-xs leading-relaxed text-[var(--text-secondary)]">
                ExamDash never uses placeholder or demo ratings. Be the first verified learner to
                rate this {productNoun} and help fellow aspirants evaluate its depth and clarity.
              </p>
            </div>
          </div>

          {!composerOpen && (
            <button
              type="button"
              disabled={authBusy}
              onClick={() => void handleStartReviewClick()}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--brand-ink)] bg-[var(--brand-ink)] px-4 text-xs font-semibold text-white transition-colors hover:bg-[var(--brand-ink-hover)] disabled:opacity-50"
            >
              {user ? (
                <>
                  <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Be the first to review</span>
                </>
              ) : (
                <>
                  <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sign in to Review</span>
                </>
              )}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Aggregate Rating Breakdown (Monochrome Editorial Grid) */}
          <div className="grid grid-cols-1 gap-6 rounded-xl border border-[var(--border-subtle)] p-5 sm:grid-cols-[180px_1fr] sm:items-center">
            <div className="space-y-1.5 sm:border-r sm:border-[var(--border-subtle)] sm:pr-6">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono-tabular text-4xl font-bold tracking-tight text-[var(--text-primary)]">
                  {summary.ratingValue.toFixed(1)}
                </span>
                <span className="font-mono-tabular text-xs text-[var(--text-muted)]">/ 5</span>
              </div>
              <StarRatingDisplay rating={summary.ratingValue} size="md" />
              <p className="text-xs text-[var(--text-secondary)]">
                {summary.reviewCount} genuine {summary.reviewCount === 1 ? 'review' : 'reviews'}
              </p>
              {summary.verifiedCount > 0 && (
                <p className="text-[11px] text-[var(--text-muted)]">
                  {summary.verifiedCount} verified{' '}
                  {summary.verifiedCount === 1 ? 'purchase' : 'purchases'}
                </p>
              )}
            </div>

            <div className="space-y-1.5" role="group" aria-label="Filter reviews by star rating">
              {STAR_ROWS.map((star) => {
                const count = summary.distribution[star];
                const pct = summary.ratingCount > 0 ? Math.round((count / summary.ratingCount) * 100) : 0;
                const isActive = starFilter === star;
                return (
                  <button
                    key={star}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setStarFilter((prev) => (prev === star ? null : star))}
                    className={`flex w-full items-center gap-3 rounded-md px-2 py-1 text-left transition-colors ${
                      isActive
                        ? 'bg-[var(--surface-hover)] font-semibold text-[var(--text-primary)]'
                        : 'hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    <span className="font-mono-tabular w-9 shrink-0 text-xs text-[var(--text-secondary)]">
                      {star} ★
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                      <div
                        className="h-full rounded-full bg-[var(--text-primary)] transition-all duration-200"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="font-mono-tabular w-10 shrink-0 text-right text-xs text-[var(--text-muted)]">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* High-Density Sort & Filter Chips */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sort reviews">
              {SORT_OPTIONS.map((opt) => {
                const active = sortBy === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSortBy(opt.id)}
                    className={`inline-flex h-9 items-center rounded-lg border px-3 text-xs font-medium transition-colors ${
                      active
                        ? 'border-[var(--brand-ink)] bg-[var(--brand-ink)] text-white'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-canvas)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {summary.verifiedCount > 0 && (
                <button
                  type="button"
                  aria-pressed={verifiedOnly}
                  onClick={() => setVerifiedOnly((prev) => !prev)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                    verifiedOnly
                      ? 'border-[var(--brand-ink)] bg-[var(--surface-hover)] text-[var(--text-primary)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Verified Purchases</span>
                </button>
              )}

              {starFilter !== null && (
                <button
                  type="button"
                  onClick={() => setStarFilter(null)}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--border-strong)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                >
                  <span>{starFilter} ★ only</span>
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* Genuine Reviews List */}
          {visibleReviews.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-subtle)] p-6 text-center text-xs text-[var(--text-secondary)]">
              No reviews match your current filter.{' '}
              <button
                type="button"
                onClick={() => {
                  setStarFilter(null);
                  setVerifiedOnly(false);
                }}
                className="font-semibold text-[var(--text-primary)] underline"
              >
                Reset filters
              </button>
            </div>
          ) : (
            <ol className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
              {visibleReviews.map((review) => {
                const isOwn = Boolean(user && review.uid === user.uid);
                const hasVoted = votedIds.has(review.id);
                const formattedDate = formatReviewDate(review.createdAt);
                return (
                  <li
                    key={review.id}
                    id={`review-${review.id}`}
                    className="space-y-2.5 py-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StarRatingDisplay rating={review.rating} size="sm" />
                          {review.title && (
                            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                              {review.title}
                            </h3>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--text-muted)]">
                          <span className="font-medium text-[var(--text-secondary)]">
                            {review.authorName}
                          </span>
                          {review.verifiedPurchase && (
                            <span className="inline-flex items-center gap-1 font-medium text-[var(--text-primary)]">
                              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Verified Purchase</span>
                            </span>
                          )}
                          {formattedDate && (
                            <time dateTime={review.createdAt}>{formattedDate}</time>
                          )}
                          {isOwn && (
                            <span className="font-medium text-[var(--text-primary)]">· You</span>
                          )}
                        </div>
                      </div>

                      {isOwn && isFirebaseGoogleUser && (
                        <button
                          type="button"
                          onClick={() => openComposer(review)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                        >
                          <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                      )}
                    </div>

                    <p className="max-w-prose whitespace-pre-line text-sm leading-relaxed text-[var(--text-secondary)]">
                      {review.body}
                    </p>

                    <div className="flex items-center gap-3 pt-1">
                      {!isOwn ? (
                        <button
                          type="button"
                          disabled={voteBusyId === review.id}
                          aria-pressed={hasVoted}
                          onClick={() => void handleToggleHelpful(review)}
                          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors disabled:opacity-50 ${
                            hasVoted
                              ? 'border-[var(--brand-ink)] bg-[var(--surface-hover)] text-[var(--text-primary)]'
                              : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            Helpful{review.helpfulCount > 0 ? ` (${review.helpfulCount})` : ''}
                          </span>
                        </button>
                      ) : (
                        review.helpfulCount > 0 && (
                          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                            <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>
                              {review.helpfulCount}{' '}
                              {review.helpfulCount === 1 ? 'person found' : 'people found'} this
                              helpful
                            </span>
                          </span>
                        )
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
