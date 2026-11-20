import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { SiteChromeShell } from '@/components/organisms/SiteChromeShell';
import { MonogramThumbnail } from '@/components/atoms/MonogramThumbnail';
import { PriceDisplay } from '@/components/atoms/PriceDisplay';
import { StarRatingDisplay } from '@/components/atoms/StarRatingDisplay';
import { AddToCartButtonLeaf } from '@/components/atoms/AddToCartButtonLeaf';
import { getContentTypeConfig } from '@/lib/design-system/content-types';
import type { ProductRatingSummary } from '@/core/reviews/schema';
import type { ContentTypeKey } from '@/lib/design-system/tokens';
import type { PublicBookDTO, PublicExamPackDTO } from '@/lib/design-system/types';

export interface CollectionHubServerShellProps {
  readonly contentType: ContentTypeKey;
  readonly heading: string;
  readonly intro: string;
  readonly items: readonly (PublicBookDTO | PublicExamPackDTO)[];
  readonly ratingSummaries?: Readonly<Record<string, ProductRatingSummary>>;
}

function buildSubtitle(item: PublicBookDTO | PublicExamPackDTO): string {
  if (item.contentType === 'exams') {
    const mockLabel =
      item.totalMocktest === 1 ? '1 Mock Test' : `${item.totalMocktest} Mock Tests`;
    return [mockLabel, item.language, item.publisher].filter((p) => p && p.trim().length > 0).join(' · ');
  }
  return [item.type, item.language, item.publisher].filter((p) => p && p.trim().length > 0).join(' · ');
}

/**
 * 100% Server-Rendered Catalog Hub Template (`/books`, `/exams`).
 * Zero-JS crawlable `<a href>` links, semantic breadcrumbs, single `<h1>`, and
 * minimal interactive hydration strictly on Add-to-Cart leaf buttons.
 */
export function CollectionHubServerShell({
  contentType,
  heading,
  intro,
  items,
  ratingSummaries,
}: CollectionHubServerShellProps) {
  const config = getContentTypeConfig(contentType);

  return (
    <SiteChromeShell>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <li>
              <Link
                href="/"
                className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Home</span>
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-[var(--text-primary)]">
              {config.label}
            </li>
          </ol>
        </nav>

        <header className="max-w-3xl space-y-2 border-b border-[var(--border-subtle)] pb-6">
          <h1 className="text-balance text-hero font-bold text-[var(--text-primary)]">
            {heading}
          </h1>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">
            {intro}
          </p>
          <p className="font-mono-tabular text-xs font-medium text-[var(--text-muted)]">
            {items.length === 1
              ? `1 published ${config.singularLabel.toLowerCase()}`
              : `${items.length} published ${config.label.toLowerCase()}`}
          </p>
        </header>

        <section aria-label={`${config.label} catalog`}>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => {
              const href = `${config.routePrefix}/${item.urlSlug}`;
              const subtitle = buildSubtitle(item);
              const rating = ratingSummaries?.[`${item.contentType}:${item.id}`];
              return (
                <article
                  key={item.id}
                  className="group flex h-full flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-4 transition-transform duration-150 ease-out hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
                >
                  <Link href={href} className="block focus-visible:rounded-xl" aria-label={`View ${item.title}`}>
                    <MonogramThumbnail title={item.title} contentType={item.contentType} size="grid" />
                  </Link>

                  <div className="mt-4 flex flex-1 flex-col justify-between gap-4">
                    <div className="min-w-0 space-y-1.5">
                      <h2 className="text-base font-semibold leading-snug text-[var(--text-primary)] transition-colors group-hover:text-[var(--brand-accent)]">
                        <Link href={href} className="line-clamp-2">
                          {item.title}
                        </Link>
                      </h2>
                      {subtitle && (
                        <p className="truncate text-xs text-[var(--text-muted)]">{subtitle}</p>
                      )}
                      {rating && rating.ratingCount > 0 && (
                        <StarRatingDisplay
                          rating={rating.ratingValue}
                          size="xs"
                          showNumeric
                          count={rating.ratingCount}
                        />
                      )}
                      {item.seoDescription && (
                        <p className="line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                          {item.seoDescription}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
                      <PriceDisplay
                        buyPrice={item.buyPrice}
                        listPrice={item.listPrice}
                        currency={item.currency}
                      />
                      <AddToCartButtonLeaf
                        id={item.id}
                        contentType={item.contentType}
                        title={item.title}
                        urlSlug={item.urlSlug}
                        currency={item.currency}
                        buyPrice={item.buyPrice}
                        listPrice={item.listPrice}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </SiteChromeShell>
  );
}
