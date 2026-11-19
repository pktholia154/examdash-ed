import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CollectionHubServerShell } from '@/components/templates/CollectionHubServerShell';
import { fetchPublishedExams } from '@/lib/firebase/server-catalog';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildHubCollectionGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

export const revalidate = 120;

const HUB_TITLE = 'Online Exam Packs & Mock Test Series';
const HUB_DESCRIPTION =
  'Explore published online competitive exam packs, timed CBT mock test series, and free sample tests on ExamDash (ed).';

export async function generateMetadata(): Promise<Metadata> {
  const exams = await fetchPublishedExams();
  // Anti-Soft-404 Gate (Pillar 3): never emit an indexable empty hub
  if (exams.length === 0) {
    return {
      title: HUB_TITLE,
      robots: { index: false, follow: true },
    };
  }

  return {
    title: HUB_TITLE,
    description: HUB_DESCRIPTION,
    alternates: { canonical: '/exams' },
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
      url: '/exams',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${HUB_TITLE} | ExamDash (ed)`,
      description: HUB_DESCRIPTION,
    },
  };
}

export default async function ExamsHubPage() {
  const exams = await fetchPublishedExams();
  // Anti-Soft-404 Gate: return genuine HTTP 404 when 0 published exams exist
  if (exams.length === 0) {
    notFound();
  }

  const graph = buildHubCollectionGraph(getCanonicalBaseUrl(), {
    path: '/exams',
    name: 'Exams',
    description: HUB_DESCRIPTION,
    items: exams.map((e) => ({ title: e.title, urlSlug: e.urlSlug })),
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: escapeJsonLd(graph) }}
      />
      <CollectionHubServerShell
        contentType="exams"
        heading={HUB_TITLE}
        intro={HUB_DESCRIPTION}
        items={exams}
      />
    </>
  );
}
