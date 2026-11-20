'use client';

import React from 'react';
import Link from 'next/link';
import { Check, ShoppingCart } from 'lucide-react';
import { MonogramThumbnail } from '@/components/atoms/MonogramThumbnail';
import { PriceDisplay } from '@/components/atoms/PriceDisplay';
import { StarRatingDisplay } from '@/components/atoms/StarRatingDisplay';
import { getContentTypeConfig } from '@/lib/design-system/content-types';
import type { ContentTypeKey, ViewMode } from '@/lib/design-system/tokens';

export interface CatalogItemCardProps {
  readonly id: string;
  readonly contentType: ContentTypeKey;
  readonly title: string;
  readonly urlSlug: string;
  readonly subtitle: string;
  readonly buyPrice: number;
  readonly listPrice: number;
  readonly currency: string;
  readonly ratingValue?: number;
  readonly ratingCount?: number;
  readonly viewMode: ViewMode;
  readonly inCart: boolean;
  readonly onAddToCart: () => void;
}

/**
 * Polymorphic, stateless catalog item card strictly supporting Grid (vertical)
 * and List (horizontal side-by-side) views.
 */
export function CatalogItemCard({
  contentType,
  title,
  urlSlug,
  subtitle,
  buyPrice,
  listPrice,
  currency,
  ratingValue = 0,
  ratingCount = 0,
  viewMode,
  inCart,
  onAddToCart,
}: CatalogItemCardProps) {
  const config = getContentTypeConfig(contentType);
  const href = `${config.routePrefix}/${urlSlug}`;
  const hasGenuineRating = ratingCount > 0 && ratingValue >= 1;

  if (viewMode === 'list') {
    return (
      <article className="group flex items-start gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-4 transition-transform duration-150 ease-out hover:-translate-y-0.5 hover:border-[var(--border-strong)] sm:items-center sm:gap-5">
        <Link href={href} className="shrink-0 focus-visible:rounded-xl" aria-label={`View ${title}`}>
          <MonogramThumbnail title={title} contentType={contentType} size="list" />
        </Link>

        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold leading-snug text-[var(--text-primary)] transition-colors group-hover:text-[var(--brand-accent)]">
              <Link href={href} className="line-clamp-2">
                {title}
              </Link>
            </h3>
            {subtitle && (
              <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{subtitle}</p>
            )}
            {hasGenuineRating && (
              <div className="mt-1.5">
                <StarRatingDisplay
                  rating={ratingValue}
                  size="xs"
                  showNumeric
                  count={ratingCount}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 pt-1 sm:shrink-0 sm:justify-end sm:pt-0">
            <PriceDisplay buyPrice={buyPrice} listPrice={listPrice} currency={currency} />
            <button
              type="button"
              onClick={onAddToCart}
              aria-label={inCart ? `${title} is in cart` : `Add ${title} to cart`}
              title={inCart ? 'In cart' : 'Add to cart'}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150 ${
                inCart
                  ? 'border-[var(--brand-ink)] bg-[var(--brand-ink)] text-white hover:bg-[var(--brand-ink-hover)]'
                  : 'border-[var(--border-strong)] bg-[var(--surface-canvas)] text-[var(--text-primary)] hover:border-[var(--brand-ink)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {inCart ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ShoppingCart className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </article>
    );
  }

  // Grid View: Thumbnail stacked vertically above info block
  return (
    <article className="group flex h-full flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-4 transition-transform duration-150 ease-out hover:-translate-y-0.5 hover:border-[var(--border-strong)]">
      <Link href={href} className="block focus-visible:rounded-xl" aria-label={`View ${title}`}>
        <MonogramThumbnail title={title} contentType={contentType} size="grid" />
      </Link>

      <div className="mt-4 flex flex-1 flex-col justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-snug text-[var(--text-primary)] transition-colors group-hover:text-[var(--brand-accent)]">
            <Link href={href} className="line-clamp-2">
              {title}
            </Link>
          </h3>
          {subtitle && (
            <p className="mt-1.5 truncate text-xs text-[var(--text-muted)]">{subtitle}</p>
          )}
          {hasGenuineRating && (
            <div className="mt-2">
              <StarRatingDisplay
                rating={ratingValue}
                size="xs"
                showNumeric
                count={ratingCount}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
          <PriceDisplay buyPrice={buyPrice} listPrice={listPrice} currency={currency} />
          <button
            type="button"
            onClick={onAddToCart}
            aria-label={inCart ? `${title} is in cart` : `Add ${title} to cart`}
            title={inCart ? 'In cart' : 'Add to cart'}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150 ${
              inCart
                ? 'border-[var(--brand-ink)] bg-[var(--brand-ink)] text-white hover:bg-[var(--brand-ink-hover)]'
                : 'border-[var(--border-strong)] bg-[var(--surface-canvas)] text-[var(--text-primary)] hover:border-[var(--brand-ink)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            {inCart ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
