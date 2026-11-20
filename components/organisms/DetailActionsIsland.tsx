'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  FileText,
  Library,
  Loader2,
  Play,
  ShoppingCart,
} from 'lucide-react';
import { PriceDisplay } from '@/components/atoms/PriceDisplay';
import { DynamicMarkdownReader, DynamicPdfReader } from '@/components/readers/DynamicReaders';
import { useAppSession } from '@/components/providers/AppSessionProvider';
import type { ExamAttemptSummary } from '@/core/exam/engine';
import type { ContentTypeKey } from '@/lib/design-system/tokens';
import type { PublicCatalogBaseDTO, ReaderFormat } from '@/lib/design-system/types';

function formatClock(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export interface DetailActionsIslandProps {
  readonly id: string;
  readonly contentType: ContentTypeKey;
  readonly title: string;
  readonly urlSlug: string;
  readonly currency: string;
  readonly buyPrice: number;
  readonly listPrice: number;
  readonly hasSamplePdf: boolean;
  readonly hasSampleMarkdown: boolean;
  readonly hasFullPdf: boolean;
  readonly hasFullMarkdown: boolean;
  readonly totalMocktest: number;
  readonly firstSampleMockId: string | null;
}

/**
 * Atomic interactive leaf island for Detail Pages.
 * Accepts ONLY minimal primitive props (never `fullDescription`) to keep RSC hydration payloads tiny.
 */
export function DetailActionsIsland({
  id,
  contentType,
  title,
  urlSlug,
  currency,
  buyPrice,
  listPrice,
  hasSamplePdf,
  hasSampleMarkdown,
  hasFullPdf,
  hasFullMarkdown,
  totalMocktest,
  firstSampleMockId,
}: DetailActionsIslandProps) {
  const router = useRouter();
  const {
    user,
    checkoutBusy,
    checkoutError,
    setCartOpen,
    addToCart,
    isInCart,
    getPurchase,
    buyItemNow,
    saveReadingProgress,
    getReadingProgress,
  } = useAppSession();

  const [activeReader, setActiveReader] = useState<{
    format: ReaderFormat;
    mode: 'sample' | 'full';
  } | null>(null);
  const [sampleAttempt, setSampleAttempt] = useState<ExamAttemptSummary | null>(null);

  useEffect(() => {
    if (contentType !== 'exams' || !firstSampleMockId) return;
    let active = true;
    const refresh = () => {
      void import('@/core/exam/storage')
        .then((mod) => mod.loadAllExamAttemptSummaries())
        .then((list) => {
          if (!active) return;
          const match =
            list.find(
              (s) =>
                s.examPackId === id &&
                s.mode === 'sample' &&
                (s.examSetId === firstSampleMockId || s.examSetId === 'exam_set_1')
            ) ?? null;
          setSampleAttempt(match);
        })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener('examdash:attempt-updated', refresh);
    return () => {
      active = false;
      window.removeEventListener('examdash:attempt-updated', refresh);
    };
  }, [contentType, firstSampleMockId, id]);

  const isBook = contentType === 'books';
  const isExam = contentType === 'exams';
  const added = isInCart(contentType, id);
  const purchaseRecord = getPurchase(contentType, id);
  const owned = purchaseRecord !== null;

  const cartItemPayload: PublicCatalogBaseDTO = {
    id,
    contentType,
    title,
    urlSlug,
    seoDescription: '',
    fullDescription: '',
    type: '',
    language: '',
    publisher: '',
    authorName: '',
    tags: [],
    currency,
    listPrice,
    buyPrice,
    createdAt: null,
    updatedAt: null,
    publishAt: null,
  };

  const handleBuyNow = async () => {
    const receipt = await buyItemNow(cartItemPayload);
    if (receipt) {
      setActiveReader(null);
      router.push(`/purchased?order=${encodeURIComponent(receipt.orderId)}`);
    }
  };

  return (
    <>
      {owned ? (
        <section
          aria-label="Full edition access"
          data-nosnippet=""
          className="space-y-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <CheckCircle2 className="h-4 w-4 text-[var(--semantic-discount)]" aria-hidden="true" />
              <span>Purchased — Full Edition Unlocked</span>
            </div>
            <Link
              href="/purchased"
              rel="nofollow"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] underline underline-offset-4 hover:opacity-75"
            >
              <Library className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Manage in Purchased Library</span>
            </Link>
          </div>

          {isBook && (
            <div className="flex flex-wrap items-center gap-2.5">
              {hasFullPdf && (
                <button
                  type="button"
                  onClick={() => setActiveReader({ format: 'pdf', mode: 'full' })}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--brand-ink)] px-4 py-2.5 text-sm font-medium text-white whitespace-nowrap transition-colors hover:bg-[var(--brand-ink-hover)]"
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  <span>Read Full PDF</span>
                </button>
              )}

              {hasFullMarkdown && (
                <button
                  type="button"
                  onClick={() => setActiveReader({ format: 'markdown', mode: 'full' })}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  <span>Read Full Markdown</span>
                </button>
              )}
            </div>
          )}

          {isExam && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[var(--text-secondary)]">
                All {totalMocktest} mock test sets are unlocked in your Purchased Library.
              </p>
              <Link
                href="/purchased"
                rel="nofollow"
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
          aria-label="Pricing and study actions"
          className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
            <div>
              {buyPrice > 0 && (
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Full Digital Edition
                </p>
              )}
              <PriceDisplay buyPrice={buyPrice} listPrice={listPrice} currency={currency} size="lg" />
              <p data-nosnippet="" className="mt-1 text-xs text-[var(--text-muted)]">
                {isBook
                  ? buyPrice > 0
                    ? 'Paid full PDF & Markdown editions unlock in your Purchased Library after checkout. Preview free samples below.'
                    : 'Full PDF & Markdown editions available to read online.'
                  : 'All included mock test sets unlock in your Purchased Library after checkout.'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleBuyNow()}
              disabled={checkoutBusy}
              data-nosnippet=""
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

          <div data-nosnippet="" className="flex flex-wrap items-center gap-2.5">
            {isBook && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveReader({ format: 'pdf', mode: 'sample' })}
                  disabled={!hasSamplePdf}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  <span>Free Sample PDF</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveReader({ format: 'markdown', mode: 'sample' })}
                  disabled={!hasSampleMarkdown}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  <span>Free Sample Markdown</span>
                </button>
              </>
            )}

            {isExam && firstSampleMockId && (
              <Link
                href={`/exams/${urlSlug}/attempt?mode=sample&set=${encodeURIComponent(firstSampleMockId)}`}
                rel="nofollow"
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
                      Resume Free Sample ({formatClock(sampleAttempt.remainingMs)})
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
              onClick={() => {
                if (added) {
                  setCartOpen(true);
                } else {
                  void addToCart(cartItemPayload);
                }
              }}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--brand-ink)] bg-[var(--surface-canvas)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] whitespace-nowrap transition-colors hover:bg-[var(--brand-ink)] hover:text-white"
            >
              {added ? (
                <>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <span>In cart · Checkout</span>
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
              data-nosnippet=""
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
            >
              {checkoutError}
            </p>
          )}
        </section>
      )}

      {/* Inline PDF Viewer (Sample or Full without leaving page) */}
      {isBook && activeReader?.format === 'pdf' && (
        <DynamicPdfReader
          bookId={id}
          bookTitle={title}
          mode={activeReader.mode}
          buyPrice={buyPrice}
          currency={currency}
          userEmail={user?.email ?? null}
          entitlementProof={purchaseRecord?.entitlementProof ?? null}
          getAuthToken={user ? () => user.getIdToken() : null}
          initialProgress={getReadingProgress(id, 'pdf')}
          isInCart={added}
          checkoutBusy={checkoutBusy}
          onSaveProgress={(rec) => void saveReadingProgress(rec)}
          onAddToCart={() => void addToCart(cartItemPayload)}
          onBuyNow={() => void handleBuyNow()}
          onClose={() => setActiveReader(null)}
        />
      )}

      {/* Inline Markdown Viewer (Sample or Full without leaving page) */}
      {isBook && activeReader?.format === 'markdown' && (
        <DynamicMarkdownReader
          bookId={id}
          bookTitle={title}
          mode={activeReader.mode}
          buyPrice={buyPrice}
          currency={currency}
          entitlementProof={purchaseRecord?.entitlementProof ?? null}
          getAuthToken={user ? () => user.getIdToken() : null}
          initialProgress={getReadingProgress(id, 'markdown')}
          isInCart={added}
          checkoutBusy={checkoutBusy}
          onSaveProgress={(rec) => void saveReadingProgress(rec)}
          onAddToCart={() => void addToCart(cartItemPayload)}
          onBuyNow={() => void handleBuyNow()}
          onClose={() => setActiveReader(null)}
        />
      )}
    </>
  );
}
