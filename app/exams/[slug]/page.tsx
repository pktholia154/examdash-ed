import React from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { DetailPageServerShell } from '@/components/templates/DetailPageServerShell';
import { fetchPublishedExams, lookupExamBySlug } from '@/lib/firebase/server-catalog';
import { escapeJsonLd } from '@/lib/design-system/formatters';
import { buildCleanMetaDescription } from '@/lib/seo/overview-markdown';
import { buildExamDetailGraph, getCanonicalBaseUrl } from '@/lib/seo/structured-data';

export const revalidate = 120;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await lookupExamBySlug(slug);
  if (lookup.status !== 'found') {
    return {
      title: 'Exam Pack Not Found',
      robots: { index: false, follow: false },
    };
  }

  const exam = lookup.item;
  const description = buildCleanMetaDescription(
    exam.seoDescription,
    exam.fullDescription,
    exam.title,
    160
  );
  const canonicalPath = `/exams/${exam.urlSlug}`;

  return {
    title: exam.title,
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
      type: 'website',
      title: exam.title,
      description,
      url: canonicalPath,
    },
    twitter: {
      card: 'summary_large_image',
      title: exam.title,
      description,
    },
  };
}

export default async function ExamDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const lookup = await lookupExamBySlug(slug);
  if (lookup.status !== 'found') {
    notFound();
  }

  // Enforce single-hop canonical slug redirect (lowercase / ID -> canonical urlSlug)
  if (lookup.needsCanonicalRedirect) {
    permanentRedirect(`/exams/${lookup.item.urlSlug}`);
  }

  const exam = lookup.item;
  const allExams = await fetchPublishedExams();
  const relatedExams = allExams.filter((e) => e.id !== exam.id).slice(0, 3);
  const graph = buildExamDetailGraph(getCanonicalBaseUrl(), exam);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: escapeJsonLd(graph) }}
      />
      <DetailPageServerShell item={exam} relatedItems={relatedExams} />
    </>
  );
}
