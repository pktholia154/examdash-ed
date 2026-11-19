import React from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { DetailPageServerShell } from '@/components/templates/DetailPageServerShell';
import { fetchPublishedBooks, lookupBookBySlug } from '@/lib/firebase/server-catalog';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildCleanMetaDescription } from '@/lib/seo/overview-markdown';
import { buildBookDetailGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

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
  const description = buildCleanMetaDescription(
    book.seoDescription,
    book.fullDescription,
    book.title,
    160
  );
  const canonicalPath = `/books/${book.urlSlug}`;

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
      tags: book.tags.length > 0 ? [...book.tags] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: book.title,
      description,
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
  const allBooks = await fetchPublishedBooks();
  const relatedBooks = allBooks.filter((b) => b.id !== book.id).slice(0, 3);
  const graph = buildBookDetailGraph(getCanonicalBaseUrl(), book);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: escapeJsonLd(graph) }}
      />
      <DetailPageServerShell item={book} relatedItems={relatedBooks} />
    </>
  );
}
