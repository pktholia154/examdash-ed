import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DetailPageTemplate } from '@/components/templates/DetailPageTemplate';
import { fetchBookBySlug } from '@/lib/firebase/server-catalog';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildBookDetailGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

export const revalidate = 120;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const book = await fetchBookBySlug(slug);
  if (!book) {
    return {
      title: 'Book Not Found',
      robots: { index: false, follow: false },
    };
  }

  return {
    title: book.title,
    description: book.seoDescription || book.fullDescription || book.title,
    alternates: { canonical: `/books/${book.urlSlug}` },
    openGraph: {
      type: 'book',
      title: book.title,
      description: book.seoDescription || book.fullDescription || book.title,
      url: `/books/${book.urlSlug}`,
    },
  };
}

export default async function BookDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const book = await fetchBookBySlug(slug);
  if (!book) {
    notFound();
  }

  const graph = buildBookDetailGraph(getCanonicalBaseUrl(), book);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: escapeJsonLd(graph) }}
      />
      <DetailPageTemplate item={book} />
    </>
  );
}
