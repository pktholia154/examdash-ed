'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TopHeader } from '@/components/organisms/TopHeader';
import { OfflineBanner } from '@/components/organisms/OfflineBanner';
import { CartDrawer } from '@/components/organisms/CartDrawer';
import { SearchInputBar, type ContentFilterOption } from '@/components/molecules/SearchInputBar';
import { PwaInstallBanner } from '@/components/molecules/PwaInstallBanner';
import { UserAnalyticsStrip } from '@/components/organisms/UserAnalyticsStrip';
import {
  ContentCollectionSection,
  type ContentCollectionSectionItem,
} from '@/components/organisms/ContentCollectionSection';
import { SiteFooter } from '@/components/organisms/SiteFooter';
import { useAppSession } from '@/components/providers/AppSessionProvider';
import { filterCatalogItems } from '@/lib/design-system/formatters';
import type { ViewMode } from '@/lib/design-system/tokens';
import type { PublicBookDTO, PublicExamPackDTO } from '@/lib/design-system/types';
import type { ProductRatingSummary } from '@/core/reviews/schema';

export interface HomeDashboardTemplateProps {
  readonly books: readonly PublicBookDTO[];
  readonly exams: readonly PublicExamPackDTO[];
  readonly ratingSummaries?: Readonly<Record<string, ProductRatingSummary>>;
  readonly catalogError: string | null;
}

function formatBookSubtitle(book: PublicBookDTO): string {
  const parts = [book.type, book.language, book.publisher].filter((p) => p && p.trim().length > 0);
  return parts.join(' · ');
}

function formatExamSubtitle(exam: PublicExamPackDTO): string {
  const mockLabel =
    exam.totalMocktest === 1 ? '1 Mock Test' : `${exam.totalMocktest} Mock Tests`;
  const parts = [mockLabel, exam.language, exam.publisher].filter((p) => p && p.trim().length > 0);
  return parts.join(' · ');
}

export function HomeDashboardTemplate({
  books,
  exams,
  ratingSummaries,
  catalogError,
}: HomeDashboardTemplateProps) {
  const router = useRouter();
  const {
    user,
    authReady,
    authBusy,
    authError,
    analytics,
    cartItems,
    cartTotals,
    cartOpen,
    setCartOpen,
    purchasedItems,
    checkoutBusy,
    checkoutError,
    pendingOrder,
    reconcileBusy,
    reconcileMessage,
    signIn,
    signOut,
    addToCart,
    removeFromCart,
    updateCartQuantity,
    clearCart,
    isInCart,
    checkoutCart,
    reconcileOrder,
  } = useAppSession();

  const handleCartCheckout = async () => {
    const receipt = await checkoutCart();
    if (receipt) {
      router.push(`/purchased?order=${encodeURIComponent(receipt.orderId)}`);
    }
  };

  const handleReconcile = async () => {
    const res = await reconcileOrder();
    if (res?.status === 'completed') {
      setCartOpen(false);
      router.push(`/purchased?order=${encodeURIComponent(res.orderId)}`);
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<ContentFilterOption>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const filteredBooks = useMemo<ContentCollectionSectionItem[]>(
    () =>
      filterCatalogItems(books, searchQuery).map((dto) => {
        const rating = ratingSummaries?.[`books:${dto.id}`];
        return {
          dto,
          subtitle: formatBookSubtitle(dto),
          ratingValue: rating?.ratingValue,
          ratingCount: rating?.ratingCount,
        };
      }),
    [books, ratingSummaries, searchQuery]
  );

  const filteredExams = useMemo<ContentCollectionSectionItem[]>(
    () =>
      filterCatalogItems(exams, searchQuery).map((dto) => {
        const rating = ratingSummaries?.[`exams:${dto.id}`];
        return {
          dto,
          subtitle: formatExamSubtitle(dto),
          ratingValue: rating?.ratingValue,
          ratingCount: rating?.ratingCount,
        };
      }),
    [exams, ratingSummaries, searchQuery]
  );

  const showBooks = activeFilter === 'all' || activeFilter === 'books';
  const showExams = activeFilter === 'all' || activeFilter === 'exams';

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

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:space-y-7 sm:px-6 lg:px-8">
        {/* Answer-First Editorial Heading + Cross-Collection Search */}
        <section aria-labelledby="home-hero-heading" className="space-y-4">
          <div className="max-w-3xl space-y-1.5">
            <h1
              id="home-hero-heading"
              className="text-balance text-hero font-bold text-[var(--text-primary)]"
            >
              Study books and online exam packs
            </h1>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">
              Browse curated study books, MCQ question banks, and timed online competitive exam mock test series.
            </p>
          </div>

          <SearchInputBar
            query={searchQuery}
            onQueryChange={setSearchQuery}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            booksCount={filteredBooks.length}
            examsCount={filteredExams.length}
          />

          {authError && (
            <p
              role="alert"
              data-nosnippet=""
              className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800"
            >
              {authError}
            </p>
          )}
        </section>

        {/* Add / Install Web App Banner */}
        <PwaInstallBanner />

        {/* Quick User Dashboard with Real Analytics */}
        <UserAnalyticsStrip
          isSignedIn={Boolean(user)}
          userName={user?.displayName ?? user?.email ?? null}
          analytics={analytics}
          publishedBooksCount={books.length}
          publishedExamsCount={exams.length}
          cartItemCount={cartTotals.itemCount}
          cartSavings={cartTotals.totalSavings}
          cartCurrency={cartTotals.currency}
          onSignIn={() => void signIn()}
        />

        {/* Catalog Connection Error State */}
        {catalogError && (
          <div
            role="alert"
            data-nosnippet=""
            className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-900"
          >
            Unable to load catalog items right now. Please refresh to retry.
          </div>
        )}

        {/* Separate Collection Sections */}
        <div className="space-y-10 pt-1">
          {showBooks && (
            <ContentCollectionSection
              contentType="books"
              items={filteredBooks}
              totalInCollection={books.length}
              searchQuery={searchQuery}
              viewMode={viewMode}
              isInCart={isInCart}
              onAddToCart={(item) => void addToCart(item)}
            />
          )}

          {showExams && (
            <ContentCollectionSection
              contentType="exams"
              items={filteredExams}
              totalInCollection={exams.length}
              searchQuery={searchQuery}
              viewMode={viewMode}
              isInCart={isInCart}
              onAddToCart={(item) => void addToCart(item)}
            />
          )}
        </div>
      </main>

      <SiteFooter />

      {cartOpen && (
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
          onReconcilePendingOrder={() => void handleReconcile()}
        />
      )}
    </div>
  );
}
