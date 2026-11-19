import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CollectionHubServerShell } from '@/components/templates/CollectionHubServerShell';
import { fetchPublishedBooks } from '@/lib/firebase/server-catalog';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildHubCollectionGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

export const revalidate = 120;

const HUB_TITLE = 'Study Books & MCQ Question Banks';
const HUB_DESCRIPTION =
  'Browse published digital study books, MCQ question banks, and free PDF and Markdown samples on ExamDash (ed).';

export async function generateMetadata(): Promise<Metadata> {
  const books = await fetchPublishedBooks();
  // Anti-Soft-404 Gate (Pillar 3): never emit an indexable empty hub
  if (books.length === 0) {
    return {
      title: HUB_TITLE,
      robots: { index: false, follow: true },
    };
  }

  return {
    title: HUB_TITLE,
    description: HUB_DESCRIPTION,
    alternates: { canonical: '/books' },
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
      type: 'website',
      title: `${HUB_TITLE} | ExamDash (ed)`,
      description: HUB_DESCRIPTION,
      url: '/books',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${HUB_TITLE} | ExamDash (ed)`,
      description: HUB_DESCRIPTION,
    },
  };
}

export default async function BooksHubPage() {
  const books = await fetchPublishedBooks();
  // Anti-Soft-404 Gate: return genuine HTTP 404 when 0 published books exist
  if (books.length === 0) {
    notFound();
  }

  const graph = buildHubCollectionGraph(getCanonicalBaseUrl(), {
    path: '/books',
    name: 'Books',
    description: HUB_DESCRIPTION,
    items: books.map((b) => ({ title: b.title, urlSlug: b.urlSlug })),
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: escapeJsonLd(graph) }}
      />
      <CollectionHubServerShell
        contentType="books"
        heading={HUB_TITLE}
        intro={HUB_DESCRIPTION}
        items={books}
      />
    </>
  );
}
