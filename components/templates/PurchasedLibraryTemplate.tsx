'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  FileText,
  Library,
  Loader2,
  LogIn,
  Play,
  Receipt,
  RefreshCw,
  Search,
  ShoppingBag,
} from 'lucide-react';
import { TopHeader } from '@/components/organisms/TopHeader';
import { OfflineBanner } from '@/components/organisms/OfflineBanner';
import { CartDrawer } from '@/components/organisms/CartDrawer';
import { SiteFooter } from '@/components/organisms/SiteFooter';
import { MonogramThumbnail } from '@/components/atoms/MonogramThumbnail';
import { DynamicMarkdownReader, DynamicPdfReader } from '@/components/readers/DynamicReaders';
import { useAppSession } from '@/components/providers/AppSessionProvider';
import { formatPrice } from '@/lib/design-system/formatters';
import {
  flattenPurchasedExamSets,
  formatDurationClock,
  type ExamAttemptSummary,
} from '@/core/exam/engine';
import { loadAllExamAttemptSummaries } from '@/core/exam/storage';
import type { NormalizedExamSet } from '@/core/exam/schema';
import type {
  PublicBookDTO,
  PublicExamPackDTO,
  PurchasedItem,
  ReaderFormat,
} from '@/lib/design-system/types';

export interface PurchasedLibraryTemplateProps {
  readonly books: readonly PublicBookDTO[];
  readonly exams: readonly PublicExamPackDTO[];
}

type LibraryFilter = 'all' | 'books' | 'exams' | 'receipts';

export function PurchasedLibraryTemplate({ books, exams }: PurchasedLibraryTemplateProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirmedOrderId = searchParams.get('order');

  const {
    user,
    authReady,
    authBusy,
    authError,
    cartItems,
    cartTotals,
    cartOpen,
    setCartOpen,
    purchasedItems,
    purchasesLoading,
    checkoutBusy,
    checkoutError,
    lastOrderReceipt,
    pendingOrder,
    reconcileBusy,
    reconcileMessage,
    signIn,
    signOut,
    removeFromCart,
    updateCartQuantity,
    clearCart,
    checkoutCart,
    reconcileOrder,
    dismissPendingOrder,
    saveReadingProgress,
    getReadingProgress,
  } = useAppSession();

  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [manualOrderId, setManualOrderId] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loadedFullSetsByPack, setLoadedFullSetsByPack] = useState<
    Record<string, NormalizedExamSet[]>
  >({});
  const [hydratingExamPacks, setHydratingExamPacks] = useState(false);
  const [attemptSummaryMap, setAttemptSummaryMap] = useState<Record<string, ExamAttemptSummary>>(
    {}
  );

  const [activeFullReader, setActiveFullReader] = useState<{
    purchase: PurchasedItem;
    format: ReaderFormat;
    buyPrice: number;
    currency: string;
  } | null>(null);

  const bookMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const examMap = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams]);

  const purchasedBooks = useMemo(
    () => purchasedItems.filter((p) => p.contentType === 'books'),
    [purchasedItems]
  );
  const purchasedExams = useMemo(
    () => purchasedItems.filter((p) => p.contentType === 'exams'),
    [purchasedItems]
  );

  // Load local IndexedDB attempt summaries so every flattened exam set displays live Resume/Score
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadAllExamAttemptSummaries().then((list) => {
        if (!active) return;
        const map: Record<string, ExamAttemptSummary> = {};
        for (const item of list) {
          const key = `${item.examPackId}::${item.examSetId}`;
          const prev = map[key];
          // Prefer full mode summary over sample summary, or newer timestamp
          if (
            !prev ||
            (item.mode === 'full' && prev.mode !== 'full') ||
            (item.mode === prev.mode && item.updatedAtMs > prev.updatedAtMs)
          ) {
            map[key] = item;
          }
        }
        setAttemptSummaryMap(map);
      });
    };
    refresh();
    window.addEventListener('examdash:attempt-updated', refresh);
    return () => {
      active = false;
      window.removeEventListener('examdash:attempt-updated', refresh);
    };
  }, []);

  // Fetch & flatten full multi-set JSON arrays for all purchased exam packs via server proxy
  const purchasedExamSignature = useMemo(
    () => purchasedExams.map((p) => `${p.itemId}:${p.entitlementProof.slice(0, 12)}`).join('|'),
    [purchasedExams]
  );

  useEffect(() => {
    if (!user || purchasedExams.length === 0) return;
    let cancelled = false;

    async function hydrateFullExamSets() {
      setHydratingExamPacks(true);
      try {
        const token = await user!.getIdToken();
        const results = await Promise.allSettled(
          purchasedExams.map(async (purchase) => {
            const res = await fetch(
              `/api/exams/${encodeURIComponent(purchase.itemId)}/sets?mode=full`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  'x-entitlement-proof': purchase.entitlementProof,
                },
                cache: 'no-store',
              }
            );
            if (!res.ok) return null;
            const payload = (await res.json()) as { sets?: NormalizedExamSet[] };
            if (!Array.isArray(payload.sets) || payload.sets.length === 0) return null;
            return { packId: purchase.itemId, sets: payload.sets };
          })
        );

        if (cancelled) return;
        const nextMap: Record<string, NormalizedExamSet[]> = {};
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) {
            nextMap[r.value.packId] = r.value.sets;
          }
        }
        if (Object.keys(nextMap).length > 0) {
          setLoadedFullSetsByPack((prev) => ({ ...prev, ...nextMap }));
        }
      } finally {
        if (!cancelled) setHydratingExamPacks(false);
      }
    }

    void hydrateFullExamSets();
    return () => {
      cancelled = true;
    };
  }, [purchasedExamSignature, purchasedExams, user]);

  // Flatten ALL exam sets from every purchased exam pack into individual playable rows
  const flattenedExamSets = useMemo(
    () =>
      flattenPurchasedExamSets(
        purchasedExams,
        examMap,
        loadedFullSetsByPack,
        attemptSummaryMap
      ),
    [attemptSummaryMap, examMap, loadedFullSetsByPack, purchasedExams]
  );

  const filteredBooks = useMemo(() => {
    if (filter === 'exams' || filter === 'receipts') return [];
    const q = searchQuery.trim().toLowerCase();
    return purchasedBooks.filter((item) => {
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.razorpayOrderId.toLowerCase().includes(q) ||
        item.razorpayPaymentId.toLowerCase().includes(q) ||
        item.itemId.toLowerCase().includes(q)
      );
    });
  }, [filter, purchasedBooks, searchQuery]);

  const filteredExamSets = useMemo(() => {
    if (filter === 'books' || filter === 'receipts') return [];
    const q = searchQuery.trim().toLowerCase();
    return flattenedExamSets.filter((set) => {
      if (!q) return true;
      return (
        set.setTitle.toLowerCase().includes(q) ||
        set.examPackTitle.toLowerCase().includes(q) ||
        set.examSetId.toLowerCase().includes(q)
      );
    });
  }, [filter, flattenedExamSets, searchQuery]);

  const filteredReceipts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return purchasedItems.filter((item) => {
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.razorpayOrderId.toLowerCase().includes(q) ||
        item.razorpayPaymentId.toLowerCase().includes(q)
      );
    });
  }, [purchasedItems, searchQuery]);

  const hasVisibleContent =
    filter === 'receipts'
      ? true
      : filteredBooks.length > 0 || filteredExamSets.length > 0;

  const handleCopyText = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopiedId(text);
        window.setTimeout(() => setCopiedId((curr) => (curr === text ? null : curr)), 1800);
      });
    }
  };

  const handleManualReconcile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = manualOrderId.trim();
    if (!trimmed) return;
    const res = await reconcileOrder(trimmed);
    if (res?.status === 'completed') {
      setManualOrderId('');
      router.replace(`/purchased?order=${encodeURIComponent(res.orderId)}`);
    }
  };

  const handleCartCheckout = async () => {
    const receipt = await checkoutCart();
    if (receipt) {
      router.push(`/purchased?order=${encodeURIComponent(receipt.orderId)}`);
    }
  };

  const handlePendingReconcile = async () => {
    const res = await reconcileOrder();
    if (res?.status === 'completed') {
      setCartOpen(false);
      router.replace(`/purchased?order=${encodeURIComponent(res.orderId)}`);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--surface-canvas)]">
      <TopHeader
        userName={user?.displayName ?? user?.email ?? null}
        userPhotoUrl={user?.photoURL ?? null}
        authReady={authReady}
        authBusy={authBusy}
        cartCount={cartTotals.itemCount}
        purchasedCount={purchasedItems.length}
        onSignIn={() => void signIn()}
        onSignOut={() => void signOut()}
        onOpenCart={() => setCartOpen(true)}
      />

      <OfflineBanner />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        {/* Page Heading */}
        <section
          aria-labelledby="purchased-heading"
          className="space-y-2 border-b border-[var(--border-subtle)] pb-5"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--text-muted)]">
                Full Editions · Flattened Exam Sets · Synced Progress
              </p>
              <h1
                id="purchased-heading"
                className="text-balance text-hero font-bold text-[var(--text-primary)]"
              >
                Purchased Library
              </h1>
            </div>

            {user && (
              <div className="font-mono-tabular flex items-center gap-4 text-xs text-[var(--text-secondary)]">
                <span>{purchasedBooks.length} Books</span>
                <span aria-hidden="true">·</span>
                <span>{flattenedExamSets.length} Unlocked Mock Sets</span>
              </div>
            )}
          </div>
        </section>

        {/* Order Confirmation Banner after Razorpay Payment */}
        {(confirmedOrderId || lastOrderReceipt) && user && (
          <section
            role="status"
            aria-label="Order confirmation"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-5 py-4"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2
                className="mt-0.5 h-5 w-5 shrink-0 text-[var(--semantic-discount)]"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  Payment Verified — Full Editions &amp; All Mock Sets Unlocked
                </p>
                <p className="font-mono-tabular mt-0.5 text-xs text-[var(--text-secondary)]">
                  Order {confirmedOrderId || lastOrderReceipt?.orderId}
                  {lastOrderReceipt?.paymentId ? ` · Payment ${lastOrderReceipt.paymentId}` : ''}
                </p>
              </div>
            </div>
            <span className="text-xs font-medium text-[var(--text-muted)]">
              Ready to attempt or read below
            </span>
          </section>
        )}

        {/* Interrupted Razorpay Payment Auto-Recovery Banner */}
        {pendingOrder && user && (
          <section
            role="status"
            aria-label="Pending Razorpay payment verification"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-5 py-4"
          >
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Pending Razorpay Order Detected
              </p>
              <p className="font-mono-tabular text-xs text-[var(--text-secondary)]">
                Order {pendingOrder.orderId}
                {pendingOrder.amountSubunits > 0
                  ? ` · ${formatPrice(pendingOrder.amountSubunits / 100, pendingOrder.currency)}`
                  : ''}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                If money was debited via UPI or card before the screen refreshed, verify now to unlock immediately.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handlePendingReconcile()}
                disabled={reconcileBusy}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[var(--brand-ink)] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--brand-ink-hover)] disabled:opacity-60"
              >
                {reconcileBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{reconcileBusy ? 'Verifying...' : 'Verify & Unlock'}</span>
              </button>
              <button
                type="button"
                onClick={dismissPendingOrder}
                disabled={reconcileBusy}
                className="min-h-[40px] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
              >
                Dismiss
              </button>
            </div>
          </section>
        )}

        {reconcileMessage && user && (
          <p
            role="status"
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-4 py-2.5 text-xs text-[var(--text-secondary)]"
          >
            {reconcileMessage}
          </p>
        )}

        {authError && (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800"
          >
            {authError}
          </p>
        )}

        {/* Unauthenticated Gate (Google Sign-In Only) */}
        {authReady && !user && (
          <section className="mx-auto flex max-w-lg flex-col items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] text-[var(--text-primary)]">
              <Library className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-lg font-bold text-[var(--text-primary)]">
              Sign in with Google to open your Purchased Library
            </h2>
            <p className="mt-2 max-w-md text-sm text-[var(--text-secondary)]">
              Access your full PDF books, full reflowable Markdown editions, and every flattened
              online exam mock test set across all devices.
            </p>
            <button
              type="button"
              onClick={() => void signIn()}
              disabled={authBusy}
              className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-ink-hover)] disabled:opacity-60"
            >
              <LogIn className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{authBusy ? 'Signing in...' : 'Sign in with Google'}</span>
            </button>
            <Link
              href="/login?redirect=/purchased"
              rel="nofollow"
              className="mt-3 text-xs text-[var(--text-muted)] underline-offset-4 transition-colors hover:text-[var(--text-primary)] hover:underline"
            >
              Partner / verification email sign-in
            </Link>
          </section>
        )}

        {/* Authenticated Purchased Library Controls & Flattened Lists */}
        {user && (
          <>
            {/* Filter Tabs & Search Bar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div
                role="tablist"
                aria-label="Filter purchased items"
                className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-subtle)] p-1"
              >
                {(
                  [
                    {
                      key: 'all',
                      label: `All (${purchasedBooks.length + flattenedExamSets.length})`,
                    },
                    { key: 'exams', label: `Mock Tests (${flattenedExamSets.length})` },
                    { key: 'books', label: `Books (${purchasedBooks.length})` },
                    { key: 'receipts', label: `Receipts (${purchasedItems.length})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === tab.key}
                    onClick={() => setFilter(tab.key)}
                    className={`min-h-[38px] rounded-md px-3.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      filter === tab.key
                        ? 'bg-[var(--surface-canvas)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:max-w-xs">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
                  aria-hidden="true"
                />
                <label htmlFor="purchased-search" className="sr-only">
                  Search purchased items and mock sets
                </label>
                <input
                  id="purchased-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search books or mock test sets..."
                  className="h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)] pr-3 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                />
              </div>
            </div>

            {purchasesLoading && purchasedItems.length === 0 ? (
              <div className="space-y-3">
                {[1, 2].map((n) => (
                  <div
                    key={n}
                    className="h-32 animate-pulse rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]"
                  />
                ))}
              </div>
            ) : !hasVisibleContent ? (
              <section className="flex flex-col items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-6 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] text-[var(--text-muted)]">
                  <ShoppingBag className="h-5 w-5" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-base font-bold text-[var(--text-primary)]">
                  {purchasedItems.length === 0
                    ? 'No purchased items yet'
                    : 'No matching items in your library'}
                </h2>
                <p className="mt-1.5 max-w-md text-sm text-[var(--text-secondary)]">
                  {purchasedItems.length === 0
                    ? 'Try free sample mock tests or book previews on any catalog page, then unlock full editions via Razorpay.'
                    : 'Try clearing your search query or switching the category filter.'}
                </p>
                <Link
                  href="/"
                  className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--brand-ink-hover)]"
                >
                  <span>Browse Catalog</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </section>
            ) : (
              <div className="space-y-8">
                {/* 1. FLATTENED EXAM SETS (Every set from every purchased fullJsonStoragePath listed separately) */}
                {filteredExamSets.length > 0 && (
                  <section aria-labelledby="flattened-exams-heading" className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <ClipboardCheck className="h-4 w-4 text-[var(--text-primary)]" aria-hidden="true" />
                        <h2
                          id="flattened-exams-heading"
                          className="text-base font-bold text-[var(--text-primary)]"
                        >
                          Unlocked Mock Test Sets ({filteredExamSets.length})
                        </h2>
                      </div>
                      {hydratingExamPacks && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          <span>Syncing full sets...</span>
                        </span>
                      )}
                    </div>

                    <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)]">
                      {filteredExamSets.map((set) => {
                        const summary = set.attemptSummary;
                        const isSubmitted = summary?.phase === 'submitted';
                        const isInProgress = summary?.phase === 'in_progress';

                        return (
                          <li
                            key={set.key}
                            className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
                          >
                            <div className="flex min-w-0 items-start gap-3.5">
                              <MonogramThumbnail
                                title={set.setTitle}
                                contentType="exams"
                                size="list"
                              />
                              <div className="min-w-0 space-y-1">
                                <p className="text-xs font-medium text-[var(--text-muted)]">
                                  <Link
                                    href={`/exams/${set.examPackSlug}`}
                                    className="hover:underline"
                                  >
                                    {set.examPackTitle}
                                  </Link>
                                  {' · '}Set {String(set.setNumber).padStart(2, '0')}
                                  {set.sectionalTiming ? ' · Sectional Timing' : ''}
                                  {set.calculator ? ` · ${set.calculator} calc` : ''}
                                </p>

                                <h3 className="text-sm font-bold text-[var(--text-primary)] sm:text-base">
                                  {set.setTitle}
                                </h3>

                                <div className="font-mono-tabular flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                                  <span>{set.totalQuestions} Qs</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{set.totalMarks} Marks</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="h-3 w-3" aria-hidden="true" />
                                    {set.duration} min
                                  </span>

                                  {isSubmitted && summary && summary.score !== null && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-semibold text-emerald-700">
                                        Score: {summary.score}/{summary.maxMarks} ({summary.accuracy ?? 0}%)
                                      </span>
                                    </>
                                  )}

                                  {isInProgress && summary && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-semibold text-amber-800">
                                        In Progress ({summary.answeredCount}/{summary.totalQuestions} ·{' '}
                                        {formatDurationClock(summary.remainingMs)} left)
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              <Link
                                href={`/exams/${set.examPackSlug}/attempt?mode=full&set=${encodeURIComponent(set.examSetId)}`}
                                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-[var(--brand-ink)] px-4 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[var(--brand-ink-hover)]"
                              >
                                {isSubmitted ? (
                                  <>
                                    <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>View Analytics & Retake</span>
                                  </>
                                ) : isInProgress ? (
                                  <>
                                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>Resume Test</span>
                                  </>
                                ) : (
                                  <>
                                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>Attempt Test</span>
                                  </>
                                )}
                              </Link>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {/* 2. PURCHASED BOOKS (Full PDF & Markdown Editions) */}
                {filteredBooks.length > 0 && (
                  <section aria-labelledby="purchased-books-heading" className="space-y-3">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-[var(--text-primary)]" aria-hidden="true" />
                      <h2
                        id="purchased-books-heading"
                        className="text-base font-bold text-[var(--text-primary)]"
                      >
                        Full Edition Books ({filteredBooks.length})
                      </h2>
                    </div>

                    <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)]">
                      {filteredBooks.map((purchase) => {
                        const catalogBook = bookMap.get(purchase.itemId);
                        const pdfProgress = getReadingProgress(purchase.itemId, 'pdf');
                        const mdProgress = getReadingProgress(purchase.itemId, 'markdown');
                        const purchasedDateLabel = new Date(
                          purchase.purchasedAt
                        ).toLocaleDateString('en-IN', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        });

                        return (
                          <li key={purchase.id} className="p-4 sm:p-5">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                              <MonogramThumbnail
                                title={purchase.title}
                                contentType="books"
                                size="list"
                              />

                              <div className="min-w-0 flex-1 space-y-3">
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-[var(--text-muted)]">
                                    Full Book Edition · Unlocked · Purchased {purchasedDateLabel}
                                  </p>
                                  <h3 className="mt-0.5 text-base font-bold text-[var(--text-primary)]">
                                    <Link
                                      href={`/books/${purchase.urlSlug}`}
                                      className="hover:underline"
                                    >
                                      {purchase.title}
                                    </Link>
                                  </h3>
                                  <p className="font-mono-tabular mt-0.5 text-xs text-[var(--text-muted)]">
                                    Paid {formatPrice(purchase.amountPaid, purchase.currency)} · Order{' '}
                                    {purchase.razorpayOrderId}
                                    {purchase.razorpayPaymentId
                                      ? ` · Payment ${purchase.razorpayPaymentId}`
                                      : ''}
                                  </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-2.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setActiveFullReader({
                                        purchase,
                                        format: 'pdf',
                                        buyPrice: catalogBook?.buyPrice ?? purchase.amountPaid,
                                        currency: catalogBook?.currency ?? purchase.currency,
                                      })
                                    }
                                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-4 py-2 text-sm font-medium text-white whitespace-nowrap transition-colors hover:bg-[var(--brand-ink-hover)]"
                                  >
                                    <FileText className="h-4 w-4" aria-hidden="true" />
                                    <span>
                                      {pdfProgress && pdfProgress.pageIndex > 0
                                        ? `Resume Full PDF (p.${pdfProgress.pageIndex + 1})`
                                        : 'Read Full PDF'}
                                    </span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      setActiveFullReader({
                                        purchase,
                                        format: 'markdown',
                                        buyPrice: catalogBook?.buyPrice ?? purchase.amountPaid,
                                        currency: catalogBook?.currency ?? purchase.currency,
                                      })
                                    }
                                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--surface-hover)]"
                                  >
                                    <BookOpen className="h-4 w-4" aria-hidden="true" />
                                    <span>
                                      {mdProgress && mdProgress.progressPercent > 0
                                        ? `Resume Full Markdown (${mdProgress.progressPercent}%)`
                                        : 'Read Full Markdown'}
                                    </span>
                                  </button>
                                </div>

                                {(pdfProgress || mdProgress) && (
                                  <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
                                    {pdfProgress && (
                                      <span className="font-mono-tabular">
                                        PDF progress: {pdfProgress.progressPercent}% (Page{' '}
                                        {pdfProgress.pageIndex + 1}
                                        {pdfProgress.totalPages > 0
                                          ? `/${pdfProgress.totalPages}`
                                          : ''}
                                        )
                                      </span>
                                    )}
                                    {mdProgress && (
                                      <span className="font-mono-tabular">
                                        Markdown progress: {mdProgress.progressPercent}%
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {/* 3. RAZORPAY PAYMENT RECEIPTS & ORDER RECOVERY */}
                {filter === 'receipts' && (
                  <section aria-labelledby="receipts-heading" className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Receipt className="h-4 w-4 text-[var(--text-primary)]" aria-hidden="true" />
                          <h2
                            id="receipts-heading"
                            className="text-base font-bold text-[var(--text-primary)]"
                          >
                            Razorpay Payment Receipts ({filteredReceipts.length})
                          </h2>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                          <Link
                            href="/refund-policy"
                            className="underline underline-offset-4 hover:text-[var(--text-primary)]"
                          >
                            Refund Policy
                          </Link>
                          <Link
                            href="/contact-us"
                            className="underline underline-offset-4 hover:text-[var(--text-primary)]"
                          >
                            Billing Support
                          </Link>
                        </div>
                      </div>

                      {filteredReceipts.length === 0 ? (
                        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-6 text-center text-sm text-[var(--text-secondary)]">
                          No completed Razorpay receipts found for this account yet.
                        </div>
                      ) : (
                        <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)]">
                          {filteredReceipts.map((purchase) => {
                            const purchasedDateLabel = new Date(
                              purchase.purchasedAt
                            ).toLocaleString('en-IN', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            });
                            return (
                              <li
                                key={purchase.id}
                                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
                              >
                                <div className="min-w-0 space-y-1">
                                  <p className="text-xs font-medium text-[var(--text-muted)]">
                                    {purchase.contentType === 'exams'
                                      ? 'Online Exam Pack'
                                      : 'Full Book Edition'}{' '}
                                    · Verified · {purchasedDateLabel}
                                  </p>
                                  <h3 className="text-sm font-bold text-[var(--text-primary)] sm:text-base">
                                    {purchase.title}
                                  </h3>
                                  <div className="font-mono-tabular flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                                    <span>Order: {purchase.razorpayOrderId}</span>
                                    {purchase.razorpayPaymentId && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span>Payment: {purchase.razorpayPaymentId}</span>
                                      </>
                                    )}
                                  </div>
                                </div>

                                <div className="flex shrink-0 flex-wrap items-center gap-3">
                                  <span className="font-mono-tabular text-sm font-bold text-[var(--text-primary)]">
                                    {formatPrice(purchase.amountPaid, purchase.currency)}
                                  </span>
                                  {purchase.razorpayPaymentId && (
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(purchase.razorpayPaymentId)}
                                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                                    >
                                      {copiedId === purchase.razorpayPaymentId ? (
                                        <>
                                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                          <span>Copied ID</span>
                                        </>
                                      ) : (
                                        <>
                                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                          <span>Copy Payment ID</span>
                                        </>
                                      )}
                                    </button>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    {/* Manual Order Verification / Recovery Tool */}
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-5 space-y-3">
                      <div className="space-y-1">
                        <h3 className="text-sm font-bold text-[var(--text-primary)]">
                          Verify or Recover a Razorpay Order
                        </h3>
                        <p className="text-xs text-[var(--text-secondary)]">
                          If your payment was debited via UPI, card, or netbanking but the browser closed before unlocking, enter your Razorpay Order ID (starts with <code className="font-mono-tabular">order_</code>) to verify directly with Razorpay.
                        </p>
                      </div>

                      <form
                        onSubmit={(e) => void handleManualReconcile(e)}
                        className="flex flex-col gap-2 sm:flex-row"
                      >
                        <label htmlFor="manual-razorpay-order-id" className="sr-only">
                          Razorpay Order ID
                        </label>
                        <input
                          id="manual-razorpay-order-id"
                          type="text"
                          value={manualOrderId}
                          onChange={(e) => setManualOrderId(e.target.value)}
                          placeholder="e.g. order_Q1a2B3c4D5e6F7"
                          className="font-mono-tabular h-11 flex-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--brand-ink)] focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={reconcileBusy || manualOrderId.trim().length < 6}
                          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[var(--brand-ink)] px-5 text-xs font-semibold text-white transition-colors hover:bg-[var(--brand-ink-hover)] disabled:opacity-50"
                        >
                          {reconcileBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          <span>{reconcileBusy ? 'Verifying...' : 'Verify Order'}</span>
                        </button>
                      </form>
                    </div>
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <SiteFooter />

      <CartDrawer
        open={cartOpen}
        items={cartItems}
        totals={cartTotals}
        isSignedIn={Boolean(user)}
        checkoutBusy={checkoutBusy}
        checkoutError={checkoutError}
        pendingOrder={pendingOrder}
        reconcileBusy={reconcileBusy}
        reconcileMessage={reconcileMessage}
        onClose={() => setCartOpen(false)}
        onUpdateQuantity={(id, qty) => void updateCartQuantity(id, qty)}
        onRemoveItem={(id) => void removeFromCart(id)}
        onClearCart={() => void clearCart()}
        onSignIn={() => void signIn()}
        onCheckout={() => void handleCartCheckout()}
        onReconcilePendingOrder={() => void handlePendingReconcile()}
      />

      {/* Full Paid PDF Reader */}
      {activeFullReader?.format === 'pdf' && (
        <DynamicPdfReader
          bookId={activeFullReader.purchase.itemId}
          bookTitle={activeFullReader.purchase.title}
          mode="full"
          buyPrice={activeFullReader.buyPrice}
          currency={activeFullReader.currency}
          userEmail={user?.email ?? null}
          entitlementProof={activeFullReader.purchase.entitlementProof}
          getAuthToken={user ? () => user.getIdToken() : null}
          initialProgress={getReadingProgress(activeFullReader.purchase.itemId, 'pdf')}
          isInCart={false}
          checkoutBusy={false}
          onSaveProgress={(rec) => void saveReadingProgress(rec)}
          onClose={() => setActiveFullReader(null)}
        />
      )}

      {/* Full Paid Markdown Reader */}
      {activeFullReader?.format === 'markdown' && (
        <DynamicMarkdownReader
          bookId={activeFullReader.purchase.itemId}
          bookTitle={activeFullReader.purchase.title}
          mode="full"
          buyPrice={activeFullReader.buyPrice}
          currency={activeFullReader.currency}
          entitlementProof={activeFullReader.purchase.entitlementProof}
          getAuthToken={user ? () => user.getIdToken() : null}
          initialProgress={getReadingProgress(activeFullReader.purchase.itemId, 'markdown')}
          isInCart={false}
          checkoutBusy={false}
          onSaveProgress={(rec) => void saveReadingProgress(rec)}
          onClose={() => setActiveFullReader(null)}
        />
      )}
    </div>
  );
}
