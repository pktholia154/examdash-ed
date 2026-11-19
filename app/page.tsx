import React from 'react';
import type { Metadata } from 'next';
import { HomeDashboardTemplate } from '@/components/templates/HomeDashboardTemplate';
import { fetchHomeCatalog } from '@/lib/firebase/server-catalog';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildHomeCollectionGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

export const revalidate = 120;

export const metadata: Metadata = {
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: '/',
    title: 'ExamDash (ed) — Study Books & Online Exam Packs',
    description:
      'Discover curated digital study books, MCQ question banks, and online competitive exam mock test series on ExamDash (ed).',
  },
};

export default async function HomePage() {
  const catalog = await fetchHomeCatalog();
  const baseUrl = getCanonicalBaseUrl();
  const homeGraph = buildHomeCollectionGraph(baseUrl, catalog.books, catalog.exams);

  // Strip long-form editorial fullDescription before crossing the Server -> Client boundary
  const compactBooks = catalog.books.map((b) => ({ ...b, fullDescription: '' }));
  const compactExams = catalog.exams.map((e) => ({ ...e, fullDescription: '' }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: escapeJsonLd(homeGraph) }}
      />
      <HomeDashboardTemplate
        books={compactBooks}
        exams={compactExams}
        catalogError={catalog.error}
      />
    </>
  );
}
