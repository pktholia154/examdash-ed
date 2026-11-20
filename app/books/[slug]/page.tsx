import React from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { DetailPageServerShell } from '@/components/templates/DetailPageServerShell';
import {
  fetchPublishedBooks,
  fetchPublishedExams,
  lookupBookBySlug,
} from '@/lib/firebase/server-catalog';
import { fetchProductReviewsAndSummary } from '@/lib/firebase/server-reviews';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildCleanMetaDescription } from '@/lib/seo/overview-markdown';
import { selectRelatedCatalogItems } from '@/lib/seo/related-items';
import {
  buildBookDetailGraph,
  filterConflictingPriceTags,
  getCanonicalBaseUrl,
  getCatalogThumbnailUrl,
} from '@/lib/seo/structured-data';

export const revalidate = 120;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await lookupBookBySlug(slug);
  if (lookup.status !== 'found') {
    return {
      title: 'Book Not Found',
      robots: { index: false, follow: false },
    };
  }

  const book = lookup.item;
  const baseUrl = getCanonicalBaseUrl();
  const description = buildCleanMetaDescription(
    book.seoDescription,
    book.fullDescription,
    book.title,
    160
  );
  const canonicalPath = `/books/${book.urlSlug}`;
  const thumbnailUrl = getCatalogThumbnailUrl(baseUrl, 'books', book.urlSlug);
  const alignedTags = filterConflictingPriceTags(book.tags, book.buyPrice);

  return {
    title: book.title,
    description,
    alternates: { canonical: canonicalPath },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      },
    },
    openGraph: {
      type: 'book',
      title: book.title,
      description,
      url: canonicalPath,
      authors: book.authorName.trim() ? [book.authorName.trim()] : undefined,
      tags: alignedTags.length > 0 ? alignedTags : undefined,
      images: [
        {
          url: thumbnailUrl,
          width: 1200,
          height: 630,
          type: 'image/png',
          alt: book.title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: book.title,
      description,
      images: [thumbnailUrl],
    },
  };
}

export default async function BookDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const lookup = await lookupBookBySlug(slug);
  if (lookup.status !== 'found') {
    notFound();
  }

  // Enforce single-hop canonical slug redirect (lowercase / ID -> canonical urlSlug)
  if (lookup.needsCanonicalRedirect) {
    permanentRedirect(`/books/${lookup.item.urlSlug}`);
  }

  const book = lookup.item;
  const [allBooks, allExams, reviewBundle] = await Promise.all([
    fetchPublishedBooks(),
    fetchPublishedExams(),
    fetchProductReviewsAndSummary('books', book.id),
  ]);
  const relatedItems = selectRelatedCatalogItems(book, allBooks, allExams, 6);
  const graph = buildBookDetailGraph(getCanonicalBaseUrl(), book, reviewBundle);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: escapeJsonLd(graph) }}
      />
      <DetailPageServerShell
        item={book}
        relatedItems={relatedItems}
        reviews={reviewBundle.reviews}
        ratingSummary={reviewBundle.summary}
      />
    </>
  );
}
