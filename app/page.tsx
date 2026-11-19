import React from 'react';
import { HomeDashboardTemplate } from '@/components/templates/HomeDashboardTemplate';
import { fetchHomeCatalog } from '@/lib/firebase/server-catalog';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildHomeCollectionGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

export const revalidate = 120;

export default async function HomePage() {
  const catalog = await fetchHomeCatalog();
  const baseUrl = getCanonicalBaseUrl();
  const homeGraph = buildHomeCollectionGraph(baseUrl, catalog.books, catalog.exams);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: escapeJsonLd(homeGraph) }}
      />
      <HomeDashboardTemplate
        books={catalog.books}
        exams={catalog.exams}
        catalogError={catalog.error}
      />
    </>
  );
}
