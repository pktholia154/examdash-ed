'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  FileText,
  Library,
  Loader2,
  Lock,
  Play,
  ShoppingCart,
} from 'lucide-react';
import { TopHeader } from '@/components/organisms/TopHeader';
import { OfflineBanner } from '@/components/organisms/OfflineBanner';
import { CartDrawer } from '@/components/organisms/CartDrawer';
import { SiteFooter } from '@/components/organisms/SiteFooter';
import { MonogramThumbnail } from '@/components/atoms/MonogramThumbnail';
import { PriceDisplay } from '@/components/atoms/PriceDisplay';
import { DynamicMarkdownReader, DynamicPdfReader } from '@/components/readers/DynamicReaders';
import { useAppSession } from '@/components/providers/AppSessionProvider';
import { getContentTypeConfig } from '@/lib/design-system/content-types';
import { loadAllExamAttemptSummaries } from '@/core/exam/storage';
import { formatDurationClock, type ExamAttemptSummary } from '@/core/exam/engine';
import type { PublicBookDTO, PublicExamPackDTO, ReaderFormat } from '@/lib/design-system/types';

export interface DetailPageTemplateProps {
  readonly item: PublicBookDTO | PublicExamPackDTO;
}

export function DetailPageTemplate({ item }: DetailPageTemplateProps) {
  const router = useRouter();
  const {
    user,
    authReady,
    authBusy,
    cartItems,
    cartTotals,
    cartOpen,
    setCartOpen,
    purchasedItems,
    checkoutBusy,
    checkoutError,
    signIn,
    signOut,
    addToCart,
    removeFromCart,
    updateCartQuantity,
    clearCart,
    isInCart,
    getPurchase,
    checkoutCart,
    buyItemNow,
    saveReadingProgress,
    getReadingProgress,
  } = useAppSession();

  const [activeReader, setActiveReader] = useState<{
    format: ReaderFormat;
    mode: 'sample' | 'full';
  } | null>(null);
  const [attemptSummaries, setAttemptSummaries] = useState<Record<string, ExamAttemptSummary>>({});

  useEffect(() => {
    if (item.contentType !== 'exams') return;
    let active = true;
    const refresh = () => {
      void loadAllExamAttemptSummaries().then((list) => {
        if (!active) return;
        const next: Record<string, ExamAttemptSummary> = {};
        for (const s of list) {
          if (s.examPackId === item.id) {
            next[`${s.examSetId}::${s.mode}`] = s;
          }
        }
        setAttemptSummaries(next);
      });
    };
    refresh();
    window.addEventListener('examdash:attempt-updated', refresh);
    return () => {
      active = false;
      window.removeEventListener('examdash:attempt-updated', refresh);
    };
  }, [item.contentType, item.id]);

  const config = getContentTypeConfig(item.contentType);
  const added = isInCart(item.contentType, item.id);
  const purchaseRecord = getPurchase(item.contentType, item.id);
  const owned = purchaseRecord !== null;

  const isBook = item.contentType === 'books';
  const isExam = item.contentType === 'exams';
  const hasSamplePdf = isBook && Boolean(item.samplePdfUrl);
  const hasSampleMarkdown = isBook && Boolean(item.sampleMarkdownUrl);

  const firstSampleMock = useMemo(() => {
    if (!isExam) return null;
    return item.mocktestTitles[0] ?? {
      id: 'exam_set_1',
      title: `${item.title} — Sample Mock Test 01`,
      duration: 60,
      totalQuestions: 4,
      totalMarks: 12,
    };
  }, [isExam, item]);

  const sampleAttempt = firstSampleMock
    ? attemptSummaries[`${firstSampleMock.id}::sample`] ??
      attemptSummaries['exam_set_1::sample'] ??
      null
    : null;

  const handleBuyNow = async () => {
    const receipt = await buyItemNow(item);
    if (receipt) {
      setActiveReader(null);
      router.push(`/purchased?order=${encodeURIComponent(receipt.orderId)}`);
    }
  };

  const handleCartCheckout = async () => {
    const receipt = await checkoutCart();
    if (receipt) {
      router.push(`/purchased?order=${encodeURIComponent(receipt.orderId)}`);
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

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Link href="/" className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Home</span>
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={`/#${item.contentType}`} className="hover:text-[var(--text-primary)]">
            {config.label}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="truncate text-[var(--text-primary)]">{item.title}</span>
        </nav>

        <article className="grid grid-cols-1 gap-8 md:grid-cols-[auto_1fr] md:items-start">
          <MonogramThumbnail title={item.title} contentType={item.contentType} size="hero" />

          <div className="space-y-6">
            {/* Title & Unboxed Metadata */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--text-muted)]">
                {[
                  config.singularLabel,
                  item.type,
                  item.language,
                  owned ? 'Purchased · Full Edition Unlocked' : 'Free Sample Available',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <h1 className="text-balance text-2xl font-bold leading-tight text-[var(--text-primary)] sm:text-3xl">
                {item.title}
              </h1>
              {(item.authorName || item.publisher) && (
                <p className="text-sm text-[var(--text-secondary)]">
                  {item.authorName ? `By ${item.authorName}` : ''}
                  {item.authorName && item.publisher ? ' · ' : ''}
                  {item.publisher ? `Published by ${item.publisher}` : ''}
                </p>
              )}
            </div>

            {/* Contiguous Price + Actions Block DIRECTLY BEFORE OVERVIEW */}
            {owned ? (
              <section
                aria-label="Full edition access"
                className="space-y-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                    <CheckCircle2 className="h-4 w-4 text-[var(--semantic-discount)]" aria-hidden="true" />
                    <span>Purchased — Full Edition Unlocked</span>
                  </div>
                  <Link
                    href="/purchased"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] underline underline-offset-4 hover:opacity-75"
                  >
                    <Library className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Manage in Purchased Library</span>
                  </Link>
                </div>

                {isBook && (
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setActiveReader({ format: 'pdf', mode: 'full' })}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-4 py-2.5 text-sm font-medium text-white whitespace-nowrap transition-colors hover:bg-[var(--brand-ink-hover)]"
                    >
                      <FileText className="h-4 w-4" aria-hidden="true" />
                      <span>Read Full PDF</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveReader({ format: 'markdown', mode: 'full' })}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      <BookOpen className="h-4 w-4" aria-hidden="true" />
                      <span>Read Full Markdown</span>
                    </button>
                  </div>
                )}

                {!isBook && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-[var(--text-secondary)]">
                      All {item.totalMocktest} mock test sets are unlocked below and flattened in your Purchased Library.
                    </p>
                    <Link
                      href="/purchased"
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-4 py-2 text-sm font-medium text-white whitespace-nowrap transition-colors hover:bg-[var(--brand-ink-hover)]"
                    >
                      <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                      <span>Open All Sets in Purchased</span>
                    </Link>
                  </div>
                )}
              </section>
            ) : (
              <section
                aria-label="Preview and purchase actions"
                className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
                  <div>
                    <PriceDisplay
                      buyPrice={item.buyPrice}
                      listPrice={item.listPrice}
                      currency={item.currency}
                      size="lg"
                    />
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {isBook
                        ? 'Preview free samples below. Full PDF & Markdown unlock in Purchased after checkout.'
                        : 'Instant access to all mock tests in Purchased after Razorpay checkout.'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleBuyNow()}
                    disabled={checkoutBusy}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-5 py-2.5 text-sm font-medium text-white whitespace-nowrap transition-colors hover:bg-[var(--brand-ink-hover)] disabled:opacity-60"
                  >
                    {checkoutBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <CreditCard className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>{checkoutBusy ? 'Starting Razorpay...' : 'Buy Full Edition'}</span>
                  </button>
                </div>

                {/* Required Action Row BEFORE Overview: Books (Sample PDF, Sample Markdown) / Exams (Free Sample Test) + Add to cart */}
                <div className="flex flex-wrap items-center gap-2.5">
                  {isBook && (
                    <>
                      <button
                        type="button"
                        onClick={() => setActiveReader({ format: 'pdf', mode: 'sample' })}
                        disabled={!hasSamplePdf}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <FileText className="h-4 w-4" aria-hidden="true" />
                        <span>Sample PDF</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveReader({ format: 'markdown', mode: 'sample' })}
                        disabled={!hasSampleMarkdown}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <BookOpen className="h-4 w-4" aria-hidden="true" />
                        <span>Sample Markdown</span>
                      </button>
                    </>
                  )}

                  {isExam && firstSampleMock && (
                    <Link
                      href={`/exams/${item.urlSlug}/attempt?mode=sample&set=${encodeURIComponent(firstSampleMock.id)}`}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      {sampleAttempt?.phase === 'submitted' ? (
                        <>
                          <BarChart3 className="h-4 w-4" aria-hidden="true" />
                          <span>
                            View Sample Report ({sampleAttempt.score}/{sampleAttempt.maxMarks})
                          </span>
                        </>
                      ) : sampleAttempt?.phase === 'in_progress' ? (
                        <>
                          <Play className="h-4 w-4" aria-hidden="true" />
                          <span>
                            Resume Free Sample ({formatDurationClock(sampleAttempt.remainingMs)})
                          </span>
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4" aria-hidden="true" />
                          <span>Try Free Sample Test</span>
                        </>
                      )}
                    </Link>
                  )}

                  <button
                    type="button"
                    onClick={() => void addToCart(item)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--brand-ink)] bg-[var(--surface-canvas)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--brand-ink)] hover:text-white"
                  >
                    {added ? (
                      <>
                        <Check className="h-4 w-4" aria-hidden="true" />
                        <span>Add another to cart</span>
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                        <span>Add to cart</span>
                      </>
                    )}
                  </button>
                </div>

                {checkoutError && (
                  <p
                    role="alert"
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
                  >
                    {checkoutError}
                  </p>
                )}
              </section>
            )}

            {/* Overview Section (strictly AFTER sample & cart buttons) */}
            <section aria-labelledby="detail-overview-heading" className="space-y-2">
              <h2 id="detail-overview-heading" className="text-base font-bold text-[var(--text-primary)]">
                Overview
              </h2>
              <p className="max-w-prose text-sm leading-relaxed text-[var(--text-secondary)]">
                {item.fullDescription || item.seoDescription}
              </p>
              {item.tags.length > 0 && (
                <p className="pt-1 text-xs text-[var(--text-muted)]">
                  Topics: {item.tags.join(' · ')}
                </p>
              )}
            </section>

            {/* Clear Sample vs Full Distinction Summary for Books */}
            {isBook && (
              <section
                aria-labelledby="edition-clarity-heading"
                className="border-t border-[var(--border-subtle)] pt-5"
              >
                <h2
                  id="edition-clarity-heading"
                  className="text-sm font-bold text-[var(--text-primary)]"
                >
                  What is included
                </h2>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                    <p className="text-xs font-semibold text-[var(--text-primary)]">
                      Free Sample Preview (Here)
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                      Inspect sample PDF pages and sample reflowable Markdown chapters directly on this page before purchasing.
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] p-4">
                    <p className="text-xs font-semibold text-[var(--text-primary)]">
                      Full Edition (Purchased Library)
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                      Unlocks complete PDF and full Markdown chapters with offline reading and cross-device progress sync after Razorpay checkout.
                    </p>
                  </div>
                </div>
              </section>
            )}

            {item.contentType === 'exams' && item.mocktestTitles.length > 0 && (
              <section
                aria-labelledby="exam-syllabus-heading"
                className="border-t border-[var(--border-subtle)] pt-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="exam-syllabus-heading" className="text-base font-bold text-[var(--text-primary)]">
                    Included Mock Tests ({item.totalMocktest})
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    {owned
                      ? 'All mock test sets are unlocked for unlimited attempts'
                      : 'Test 1 is open as a free CBT sample · Full pack unlocks all sets'}
                  </p>
                </div>
                <ul className="mt-3 divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)]">
                  {item.mocktestTitles.map((mock, idx) => {
                    const isFirstSample = idx === 0;
                    const launchMode = owned ? 'full' : 'sample';
                    const summary =
                      attemptSummaries[`${mock.id}::${launchMode}`] ??
                      (isFirstSample ? sampleAttempt : null);

                    return (
                      <li
                        key={mock.id}
                        className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-xs font-medium text-[var(--text-muted)]">
                            Set {String(idx + 1).padStart(2, '0')}
                            {isFirstSample && !owned ? ' · Free Sample Test' : ''}
                            {owned ? ' · Unlocked' : ''}
                            {summary?.phase === 'submitted' && summary.score !== null
                              ? ` · Score ${summary.score}/${summary.maxMarks} (${summary.accuracy ?? 0}% accuracy)`
                              : summary?.phase === 'in_progress'
                                ? ` · In Progress (${summary.answeredCount}/${summary.totalQuestions} answered)`
                                : ''}
                          </p>
                          <p className="font-semibold text-[var(--text-primary)]">{mock.title}</p>
                          <p className="font-mono-tabular text-xs text-[var(--text-muted)]">
                            {mock.totalQuestions} Qs · {mock.totalMarks} Marks · {mock.duration} min
                          </p>
                        </div>

                        <div className="shrink-0">
                          {owned || isFirstSample ? (
                            <Link
                              href={`/exams/${item.urlSlug}/attempt?mode=${launchMode}&set=${encodeURIComponent(mock.id)}`}
                              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                                isFirstSample && !owned
                                  ? 'bg-[var(--brand-ink)] text-white hover:bg-[var(--brand-ink-hover)]'
                                  : 'border border-[var(--border-strong)] bg-[var(--surface-canvas)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                              }`}
                            >
                              {summary?.phase === 'submitted' ? (
                                <>
                                  <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>View Report</span>
                                </>
                              ) : summary?.phase === 'in_progress' ? (
                                <>
                                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Resume Test</span>
                                </>
                              ) : (
                                <>
                                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>{isFirstSample && !owned ? 'Start Sample' : 'Start Test'}</span>
                                </>
                              )}
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Buy Pack to Unlock</span>
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        </article>
      </main>

      <SiteFooter />

      <CartDrawer
        open={cartOpen}
        items={cartItems}
        totals={cartTotals}
        isSignedIn={Boolean(user)}
        checkoutBusy={checkoutBusy}
        checkoutError={checkoutError}
        onClose={() => setCartOpen(false)}
        onUpdateQuantity={(id, qty) => void updateCartQuantity(id, qty)}
        onRemoveItem={(id) => void removeFromCart(id)}
        onClearCart={() => void clearCart()}
        onSignIn={() => void signIn()}
        onCheckout={() => void handleCartCheckout()}
      />

      {/* Inline PDF Viewer (Sample or Full without leaving page) */}
      {isBook && activeReader?.format === 'pdf' && (
        <DynamicPdfReader
          bookId={item.id}
          bookTitle={item.title}
          mode={activeReader.mode}
          buyPrice={item.buyPrice}
          currency={item.currency}
          userEmail={user?.email ?? null}
          entitlementProof={purchaseRecord?.entitlementProof ?? null}
          getAuthToken={user ? () => user.getIdToken() : null}
          initialProgress={getReadingProgress(item.id, 'pdf')}
          isInCart={added}
          checkoutBusy={checkoutBusy}
          onSaveProgress={(rec) => void saveReadingProgress(rec)}
          onAddToCart={() => void addToCart(item)}
          onBuyNow={() => void handleBuyNow()}
          onClose={() => setActiveReader(null)}
        />
      )}

      {/* Inline Markdown Viewer (Sample or Full without leaving page) */}
      {isBook && activeReader?.format === 'markdown' && (
        <DynamicMarkdownReader
          bookId={item.id}
          bookTitle={item.title}
          mode={activeReader.mode}
          buyPrice={item.buyPrice}
          currency={item.currency}
          entitlementProof={purchaseRecord?.entitlementProof ?? null}
          getAuthToken={user ? () => user.getIdToken() : null}
          initialProgress={getReadingProgress(item.id, 'markdown')}
          isInCart={added}
          checkoutBusy={checkoutBusy}
          onSaveProgress={(rec) => void saveReadingProgress(rec)}
          onAddToCart={() => void addToCart(item)}
          onBuyNow={() => void handleBuyNow()}
          onClose={() => setActiveReader(null)}
        />
      )}
    </div>
  );
}
