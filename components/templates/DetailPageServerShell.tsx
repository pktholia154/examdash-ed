import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { SiteChromeShell } from '@/components/organisms/SiteChromeShell';
import { DetailActionsIsland } from '@/components/organisms/DetailActionsIsland';
import { ExamMockActionLeaf } from '@/components/organisms/ExamMockActionLeaf';
import { MonogramThumbnail } from '@/components/atoms/MonogramThumbnail';
import { PriceDisplay } from '@/components/atoms/PriceDisplay';
import { getContentTypeConfig } from '@/lib/design-system/content-types';
import { renderOverviewMarkdownToHtml } from '@/lib/seo/overview-markdown';
import { normalizeIsoTimestamp } from '@/lib/seo/sitemap-builder';
import type { PublicBookDTO, PublicExamPackDTO } from '@/lib/design-system/types';

export interface DetailPageServerShellProps {
  readonly item: PublicBookDTO | PublicExamPackDTO;
  readonly relatedItems?: readonly (PublicBookDTO | PublicExamPackDTO)[];
}

function formatReadableDate(iso: string | null): string | null {
  const normalized = normalizeIsoTimestamp(iso);
  if (!normalized) return null;
  try {
    return new Intl.DateTimeFormat('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(normalized));
  } catch {
    return null;
  }
}

function formatCategoryLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^[A-Z0-9_]+$/.test(trimmed) && trimmed.includes('_')) {
    return trimmed
      .toLowerCase()
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  return trimmed;
}

/**
 * 100% Server-Rendered SEO Detail Page Template for Books and Exam Packs.
 *
 * Zero-JS Crawl Guarantees:
 * - Single `<h1>` for the item title
 * - Answer-first plain-text `seoDescription` rendered cleanly BEFORE Overview
 * - `Overview` renders `fullDescription` Markdown (including literal `\n` escapes) into
 *   semantic server HTML (`<h3>`, `<p>`, `<ul>`, `<ol>`, `<li>`, `<strong>`, `<hr>`)
 * - Zero repetitive boilerplate, zero fake reviews/ratings, zero fabricated FAQ blocks
 * - Interactive actions isolated in thin client leaf islands receiving primitive props only
 */
export function DetailPageServerShell({
  item,
  relatedItems = [],
}: DetailPageServerShellProps) {
  const config = getContentTypeConfig(item.contentType);
  const isBook = item.contentType === 'books';
  const isExam = item.contentType === 'exams';

  const displayType = formatCategoryLabel(item.type);
  const seoDescription = item.seoDescription.trim();
  const overviewHtml = renderOverviewMarkdownToHtml(item.fullDescription);
  const publishedDate = formatReadableDate(item.publishAt);
  const updatedDate = formatReadableDate(item.updatedAt);

  const firstSampleMockId =
    isExam && (item.mocktestTitles.length > 0 || item.sampleJsonStoragePath)
      ? item.mocktestTitles[0]?.id ?? 'exam_set_1'
      : null;

  // Build strictly factual, item-specific publication specs (omitting any missing field)
  const specRows: Array<{ label: string; value: string; dateTime?: string }> = [];
  if (displayType) {
    specRows.push({ label: 'Category', value: displayType });
  }
  if (item.language.trim()) {
    specRows.push({ label: 'Language', value: item.language.trim() });
  }
  if (item.authorName.trim()) {
    specRows.push({ label: 'Author', value: item.authorName.trim() });
  }
  if (item.publisher.trim()) {
    specRows.push({ label: 'Publisher', value: item.publisher.trim() });
  }
  if (isBook) {
    const formats: string[] = [];
    if (item.hasFullPdf || item.samplePdfUrl) formats.push('PDF');
    if (item.hasFullMarkdown || item.sampleMarkdownUrl) formats.push('Reflowable Markdown');
    if (formats.length > 0) {
      specRows.push({ label: 'Digital Formats', value: formats.join(' · ') });
    }
  }
  if (isExam && item.totalMocktest > 0) {
    specRows.push({
      label: 'Included Tests',
      value: item.totalMocktest === 1 ? '1 Mock Test' : `${item.totalMocktest} Mock Tests`,
    });
  }
  if (publishedDate && item.publishAt) {
    specRows.push({
      label: 'Published',
      value: publishedDate,
      dateTime: normalizeIsoTimestamp(item.publishAt) ?? undefined,
    });
  }
  if (updatedDate && item.updatedAt) {
    specRows.push({
      label: 'Last Updated',
      value: updatedDate,
      dateTime: normalizeIsoTimestamp(item.updatedAt) ?? undefined,
    });
  }

  return (
    <SiteChromeShell>
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-10 px-4 py-8 sm:px-6 lg:px-8">
        {/* Real Semantic Breadcrumb Trail linking to indexable Hub URLs */}
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <li className="inline-flex items-center">
              <Link
                href="/"
                className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Home</span>
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href={config.routePrefix} className="hover:text-[var(--text-primary)]">
                {config.label}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li
              aria-current="page"
              className="max-w-[260px] truncate text-[var(--text-primary)] sm:max-w-md"
            >
              {item.title}
            </li>
          </ol>
        </nav>

        <article className="grid grid-cols-1 gap-8 md:grid-cols-[auto_1fr] md:items-start">
          <MonogramThumbnail title={item.title} contentType={item.contentType} size="hero" />

          <div className="min-w-0 space-y-6">
            {/* Title, Author/Publisher & Answer-First Plain-Text seoDescription BEFORE Overview */}
            <header className="space-y-3">
              <p className="text-xs font-medium text-[var(--text-muted)]">
                {[config.singularLabel, displayType, item.language].filter(Boolean).join(' · ')}
              </p>

              <h1 className="text-balance text-2xl font-bold leading-tight text-[var(--text-primary)] sm:text-3xl">
                {item.title}
              </h1>

              {(item.authorName.trim() || item.publisher.trim()) && (
                <p className="text-sm text-[var(--text-secondary)]">
                  {item.authorName.trim() ? `By ${item.authorName.trim()}` : ''}
                  {item.authorName.trim() && item.publisher.trim() ? ' · ' : ''}
                  {item.publisher.trim() ? `Published by ${item.publisher.trim()}` : ''}
                </p>
              )}

              {seoDescription && (
                <p
                  data-testid="detail-seo-description"
                  className="max-w-prose text-base leading-relaxed text-[var(--text-secondary)]"
                >
                  {seoDescription}
                </p>
              )}
            </header>

            {/* Interactive Price + Sample/Purchase Actions Island (Strictly Before Overview) */}
            <DetailActionsIsland
              id={item.id}
              contentType={item.contentType}
              title={item.title}
              urlSlug={item.urlSlug}
              currency={item.currency}
              buyPrice={item.buyPrice}
              listPrice={item.listPrice}
              hasSamplePdf={isBook && Boolean(item.samplePdfUrl)}
              hasSampleMarkdown={isBook && Boolean(item.sampleMarkdownUrl)}
              hasFullPdf={isBook && Boolean(item.hasFullPdf)}
              hasFullMarkdown={isBook && Boolean(item.hasFullMarkdown)}
              totalMocktest={isExam ? item.totalMocktest : 0}
              firstSampleMockId={firstSampleMockId}
            />

            {/* Overview Section: Server-Compiled Markdown from fullDescription */}
            {overviewHtml && (
              <section
                aria-labelledby="detail-overview-heading"
                className="space-y-3 border-t border-[var(--border-subtle)] pt-6"
              >
                <h2
                  id="detail-overview-heading"
                  className="text-lg font-bold text-[var(--text-primary)]"
                >
                  Overview
                </h2>
                <div
                  data-testid="detail-overview-markdown"
                  className="seo-overview-prose"
                  dangerouslySetInnerHTML={{ __html: overviewHtml }}
                />
                {item.tags.length > 0 && (
                  <p className="pt-2 text-xs text-[var(--text-muted)]">
                    Topics: {item.tags.join(' · ')}
                  </p>
                )}
              </section>
            )}

            {!overviewHtml && item.tags.length > 0 && (
              <p className="text-xs text-[var(--text-muted)]">Topics: {item.tags.join(' · ')}</p>
            )}

            {/* Item-Specific Factual Publication Details (Zero Boilerplate) */}
            {specRows.length > 0 && (
              <section
                aria-labelledby="detail-specs-heading"
                className="border-t border-[var(--border-subtle)] pt-6"
              >
                <h2
                  id="detail-specs-heading"
                  className="text-base font-bold text-[var(--text-primary)]"
                >
                  Details
                </h2>
                <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                  {specRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-baseline justify-between gap-4 border-b border-[var(--border-subtle)] pb-2"
                    >
                      <dt className="text-xs font-medium text-[var(--text-muted)]">{row.label}</dt>
                      <dd className="text-right font-medium text-[var(--text-primary)]">
                        {row.dateTime ? <time dateTime={row.dateTime}>{row.value}</time> : row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {/* Server-Rendered Mock Test Syllabus List (Exams Only) */}
            {isExam && item.mocktestTitles.length > 0 && (
              <section
                aria-labelledby="exam-syllabus-heading"
                className="border-t border-[var(--border-subtle)] pt-6"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2
                    id="exam-syllabus-heading"
                    className="text-base font-bold text-[var(--text-primary)]"
                  >
                    Included Mock Tests ({item.totalMocktest})
                  </h2>
                </div>
                <ul className="mt-3 divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)]">
                  {item.mocktestTitles.map((mock, idx) => (
                    <li
                      key={mock.id}
                      className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs font-medium text-[var(--text-muted)]">
                          Set {String(idx + 1).padStart(2, '0')}
                        </p>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                          {mock.title}
                        </h3>
                        <p className="font-mono-tabular text-xs text-[var(--text-muted)]">
                          {mock.totalQuestions} Qs · {mock.totalMarks} Marks · {mock.duration} min
                        </p>
                      </div>

                      <div className="shrink-0">
                        <ExamMockActionLeaf
                          examPackId={item.id}
                          examSlug={item.urlSlug}
                          mockId={mock.id}
                          isFirstSample={idx === 0}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </article>

        {/* Shallow Internal Link Graph: Real Published Related Items Only */}
        {relatedItems.length > 0 && (
          <section
            aria-labelledby="related-items-heading"
            className="border-t border-[var(--border-subtle)] pt-8"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2
                id="related-items-heading"
                className="text-lg font-bold text-[var(--text-primary)]"
              >
                More {config.label}
              </h2>
              <Link
                href={config.routePrefix}
                className="text-xs font-semibold text-[var(--brand-accent)] hover:underline"
              >
                View all {config.label.toLowerCase()}
              </Link>
            </div>
            <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {relatedItems.map((rel) => {
                const relConfig = getContentTypeConfig(rel.contentType);
                return (
                  <li key={rel.id}>
                    <Link
                      href={`${relConfig.routePrefix}/${rel.urlSlug}`}
                      className="flex items-start gap-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-4 transition-colors hover:border-[var(--border-strong)]"
                    >
                      <MonogramThumbnail
                        title={rel.title}
                        contentType={rel.contentType}
                        size="compact"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="line-clamp-2 text-sm font-semibold text-[var(--text-primary)]">
                          {rel.title}
                        </p>
                        <PriceDisplay
                          buyPrice={rel.buyPrice}
                          listPrice={rel.listPrice}
                          currency={rel.currency}
                          size="sm"
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
    </SiteChromeShell>
  );
}
