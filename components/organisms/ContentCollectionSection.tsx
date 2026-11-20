'use client';

import React from 'react';
import Link from 'next/link';
import { CatalogItemCard } from '@/components/molecules/CatalogItemCard';
import { getContentTypeConfig } from '@/lib/design-system/content-types';
import type { ContentTypeKey, ViewMode } from '@/lib/design-system/tokens';
import type { PublicCatalogBaseDTO } from '@/lib/design-system/types';

export interface ContentCollectionSectionItem {
  readonly dto: PublicCatalogBaseDTO;
  readonly subtitle: string;
  readonly ratingValue?: number;
  readonly ratingCount?: number;
}

export interface ContentCollectionSectionProps {
  readonly contentType: ContentTypeKey;
  readonly items: readonly ContentCollectionSectionItem[];
  readonly totalInCollection: number;
  readonly searchQuery: string;
  readonly viewMode: ViewMode;
  readonly isInCart: (contentType: string, itemId: string) => boolean;
  readonly onAddToCart: (item: PublicCatalogBaseDTO) => void;
}

const SWATCH_CLASSES: Record<ContentTypeKey, string> = {
  books: 'bg-[var(--ct-books-bg)]',
  exams: 'bg-[var(--ct-exams-bg)]',
  quizbooks: 'bg-[var(--ct-quizbooks-bg)]',
};

export function ContentCollectionSection({
  contentType,
  items,
  totalInCollection,
  searchQuery,
  viewMode,
  isInCart,
  onAddToCart,
}: ContentCollectionSectionProps) {
  const config = getContentTypeConfig(contentType);
  const countLabel =
    items.length === 1
      ? `1 ${config.singularLabel.toLowerCase()}`
      : `${items.length} ${config.label.toLowerCase()}`;

  return (
    <section
      id={contentType}
      aria-labelledby={`section-heading-${contentType}`}
      className="scroll-mt-20 space-y-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-subtle)] pb-3.5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={`h-3 w-3 shrink-0 rounded-[3px] ${SWATCH_CLASSES[contentType]}`}
            />
            <h2
              id={`section-heading-${contentType}`}
              className="text-section font-bold text-[var(--text-primary)]"
            >
              <Link href={config.routePrefix} className="hover:text-[var(--brand-accent)]">
                {config.label}
              </Link>
            </h2>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">{config.description}</p>
        </div>

        <div className="flex items-center gap-4">
          <p className="font-mono-tabular text-xs font-medium text-[var(--text-muted)]">
            {searchQuery.trim()
              ? `${items.length} of ${totalInCollection} matching`
              : countLabel}
          </p>
          {totalInCollection > 0 && (
            <Link
              href={config.routePrefix}
              className="text-xs font-semibold text-[var(--brand-accent)] hover:underline whitespace-nowrap"
            >
              View all {config.label.toLowerCase()}
            </Link>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-subtle)] px-6 py-10 text-center">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {searchQuery.trim()
              ? `No ${config.label.toLowerCase()} match "${searchQuery.trim()}".`
              : `No published ${config.label.toLowerCase()} found in Firebase yet.`}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {searchQuery.trim()
              ? 'Try another keyword or clear your search filter.'
              : `Items published to the ${config.collectionName} collection will appear here automatically.`}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div
          data-testid={`collection-grid-${contentType}`}
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {items.map(({ dto, subtitle, ratingValue, ratingCount }) => (
            <CatalogItemCard
              key={dto.id}
              id={dto.id}
              contentType={dto.contentType}
              title={dto.title}
              urlSlug={dto.urlSlug}
              subtitle={subtitle}
              buyPrice={dto.buyPrice}
              listPrice={dto.listPrice}
              currency={dto.currency}
              ratingValue={ratingValue}
              ratingCount={ratingCount}
              viewMode="grid"
              inCart={isInCart(dto.contentType, dto.id)}
              onAddToCart={() => onAddToCart(dto)}
            />
          ))}
        </div>
      ) : (
        <div
          data-testid={`collection-list-${contentType}`}
          className="flex flex-col gap-3"
        >
          {items.map(({ dto, subtitle, ratingValue, ratingCount }) => (
            <CatalogItemCard
              key={dto.id}
              id={dto.id}
              contentType={dto.contentType}
              title={dto.title}
              urlSlug={dto.urlSlug}
              subtitle={subtitle}
              buyPrice={dto.buyPrice}
              listPrice={dto.listPrice}
              currency={dto.currency}
              ratingValue={ratingValue}
              ratingCount={ratingCount}
              viewMode="list"
              inCart={isInCart(dto.contentType, dto.id)}
              onAddToCart={() => onAddToCart(dto)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
